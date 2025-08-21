import express from 'express';
import { Request, Response } from 'express';
import { getKeycloak } from '@/config/keycloak';
import { logger } from '@/utils/logger';
import { businessMetrics } from '@/config/monitoring';
import { config } from '@/config';

const router = express.Router();

// Login endpoint - redirect to Keycloak
router.get('/login', (req: Request, res: Response) => {
  try {
    const keycloak = getKeycloak();
    const state = generateRandomState();
    const nonce = generateRandomNonce();

    // Store state and nonce in session for validation
    (req.session as any).oauth_state = state;
    (req.session as any).oauth_nonce = nonce;

    const authUrl = keycloak.getAuthorizationUrl(state, nonce);

    console.log('User initiated login', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      redirectTo: authUrl,
    });

    res.redirect(authUrl);
  } catch (error) {
    console.error('Login initiation error:', error);
    res.status(500).json({
      error: 'Authentication service error',
      message: 'Unable to initiate login process',
    });
  }
});

// OAuth2 callback endpoint
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;

    // Debug session info at start of callback
    console.log('Callback session debug - START:', {
      sessionId: req.sessionID,
      hasSession: !!req.session,
      sessionKeys: req.session ? Object.keys(req.session) : [],
    });

    // Check for OAuth error
    if (error) {
      console.warn('OAuth callback error', {
        error,
        errorDescription: req.query.error_description,
        ip: req.ip,
      });

      businessMetrics.recordLogin(false);
      return res.redirect(`/auth/status?error=oauth_error`);
    }

    // Validate state parameter (but allow continuation if session is lost)
    const sessionState = (req.session as any).oauth_state;
    if (state && sessionState && state !== sessionState) {
      console.warn('OAuth state mismatch', {
        activity: 'oauth_state_mismatch',
        ip: req.ip,
        details: { receivedState: state, expectedState: sessionState },
      });

      businessMetrics.recordLogin(false);
      return res.redirect(`/auth/status?error=invalid_state`);
    }

    // If session is lost but we have a valid callback, continue
    if (!sessionState) {
      console.warn('Session state lost during OAuth callback, but continuing with valid callback', {
        ip: req.ip,
        hasState: !!state,
        hasCode: !!code,
      });
    }

    if (!code) {
      console.warn('OAuth callback missing code', { ip: req.ip });
      businessMetrics.recordLogin(false);
      return res.redirect('/auth/status?error=missing_code');
    }

    // Exchange code for tokens
    const keycloak = getKeycloak();

    // Use grant method instead of callback to avoid issuer validation issues
    const tokenSet = await keycloak.client.grant({
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: `${config.server.ssl.enabled ? 'https' : 'http'}://${config.server.host}:${config.server.port}/auth/callback`,
    });

    console.log('Token exchange successful:', {
      hasAccessToken: !!tokenSet.access_token,
      hasRefreshToken: !!tokenSet.refresh_token,
      expiresIn: tokenSet.expires_in,
    });

    // Get user info
    const userinfo = await keycloak.validateToken(tokenSet.access_token!);

    // Store user session
    const userData = {
      id: userinfo.sub,
      username: userinfo.preferred_username,
      email: userinfo.email,
      firstName: userinfo.given_name,
      lastName: userinfo.family_name,
      roles: (tokenSet.claims() as any)?.realm_access?.roles || [],
    };

    const tokenData = {
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      idToken: tokenSet.id_token,
      expiresAt: tokenSet.expires_at,
    };

    // Explicitly assign to session
    (req.session as any).user = userData;
    (req.session as any).tokens = tokenData;

    // Clean up OAuth state
    delete (req.session as any).oauth_state;
    delete (req.session as any).oauth_nonce;

    // Debug session data before save
    console.log('Session data before save:', {
      sessionId: req.sessionID,
      hasUser: !!(req.session as any).user,
      hasTokens: !!(req.session as any).tokens,
      userDataKeys: userData ? Object.keys(userData) : [],
      tokenDataKeys: tokenData ? Object.keys(tokenData) : [],
    });

    // Force session save and wait for completion
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          reject(err);
        } else {
          console.log('Session saved successfully:', {
            sessionId: req.sessionID,
            userId: userinfo.sub,
            hasUser: !!(req.session as any).user,
            hasTokens: !!(req.session as any).tokens,
            sessionKeys: req.session ? Object.keys(req.session) : [],
          });
          resolve();
        }
      });
    });

    console.log('User login successful', {
      userId: userinfo.sub,
      username: userinfo.preferred_username,
      ip: req.ip,
      success: true,
    });

    businessMetrics.recordLogin(true);

    // Redirect to frontend
    const redirectUrl = (req.session as any).returnTo || `/auth/status`;
    delete (req.session as any).returnTo;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('OAuth callback error:', error);
    businessMetrics.recordLogin(false);
    res.redirect('/auth/status?error=callback_error');
  }
});

// Logout endpoint
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const userId = session.user?.id;
    const accessToken = session.tokens?.accessToken;

    if (accessToken) {
      try {
        const keycloak = getKeycloak();
        await keycloak.logout(accessToken);
      } catch (error) {
        console.error('Keycloak logout error:', error);
      }
    }

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
    });

    console.log('User logged out', {
      userId,
      ip: req.ip,
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'Logout failed',
      message: 'An error occurred during logout',
    });
  }
});

// Add automatic token refresh middleware
export async function ensureValidToken(req: Request, res: Response, next: Function) {
  try {
    const session = req.session as any;
    const tokens = session?.tokens;

    if (!tokens?.accessToken) {
      return res.status(401).json({
        error: 'No access token',
        message: 'Please login again',
      });
    }

    // Check if token is expired or will expire in next 5 minutes
    const now = Math.floor(Date.now() / 1000);
    const tokenExpiresAt = tokens.expiresAt;
    const shouldRefresh = !tokenExpiresAt || tokenExpiresAt - 300 <= now;

    if (shouldRefresh && tokens.refreshToken) {
      console.log('Token expired or expiring soon, attempting refresh:', {
        userId: session.user?.id,
        expiresAt: tokenExpiresAt,
        currentTime: now,
      });

      try {
        const keycloak = getKeycloak();
        const newTokenSet = await keycloak.refreshToken(tokens.refreshToken);

        // Update session with new tokens
        session.tokens = {
          accessToken: newTokenSet.access_token,
          refreshToken: newTokenSet.refresh_token || tokens.refreshToken,
          idToken: newTokenSet.id_token,
          expiresAt: newTokenSet.expires_at,
        };

        // Force session save
        await new Promise<void>((resolve, reject) => {
          req.session.save((err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        console.log('Token refreshed automatically:', {
          userId: session.user?.id,
          newExpiresAt: newTokenSet.expires_at,
        });
      } catch (refreshError) {
        console.error('Automatic token refresh failed:', refreshError);

        // Clear session and require re-login
        req.session.destroy(() => {});

        return res.status(401).json({
          error: 'Token refresh failed',
          message: 'Please login again',
          shouldRedirectToLogin: true,
        });
      }
    }

    next();
  } catch (error) {
    console.error('Token validation error:', error);
    return res.status(500).json({
      error: 'Token validation failed',
      message: 'Internal server error',
    });
  }
}

// Get current user session
router.get('/me', ensureValidToken, (req: Request, res: Response) => {
  const session = req.session as any;
  const user = session.user;

  res.json({
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles,
    },
    tokenExpiresAt: session.tokens?.expiresAt,
  });
});

// Enhanced refresh endpoint with better error handling
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const session = req.session as any;
    const refreshToken = session.tokens?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        error: 'No refresh token',
        message: 'Please login again',
        shouldRedirectToLogin: true,
      });
    }

    const keycloak = getKeycloak();
    const newTokenSet = await keycloak.refreshToken(refreshToken);

    // Update session tokens
    session.tokens = {
      accessToken: newTokenSet.access_token,
      refreshToken: newTokenSet.refresh_token || refreshToken,
      idToken: newTokenSet.id_token,
      expiresAt: newTokenSet.expires_at,
    };

    // Force session save
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('Token refreshed manually:', {
      userId: session.user?.id,
      newExpiresAt: newTokenSet.expires_at,
    });

    res.json({
      message: 'Token refreshed successfully',
      expiresAt: newTokenSet.expires_at,
      expiresIn: newTokenSet.expires_at
        ? newTokenSet.expires_at - Math.floor(Date.now() / 1000)
        : null,
    });
  } catch (error) {
    console.error('Manual token refresh error:', error);

    // Clear invalid session
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destruction error:', err);
      }
    });

    res.status(401).json({
      error: 'Token refresh failed',
      message: 'Please login again',
      shouldRedirectToLogin: true,
    });
  }
});

// Enhanced status endpoint with token expiration info
router.get('/status', (req: Request, res: Response) => {
  const session = req.session as any;
  const tokens = session?.tokens;

  let tokenStatus = 'no_token';
  if (tokens?.expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = tokens.expiresAt - now;

    if (timeUntilExpiry <= 0) {
      tokenStatus = 'expired';
    } else if (timeUntilExpiry <= 300) {
      // 5 minutes
      tokenStatus = 'expiring_soon';
    } else {
      tokenStatus = 'valid';
    }
  }

  res.json({
    sessionId: req.sessionID,
    hasSession: !!req.session,
    sessionKeys: req.session ? Object.keys(req.session) : [],
    hasUser: !!session?.user,
    hasTokens: !!session?.tokens,
    user: session?.user || null,
    authenticated: !!(session?.user && session?.tokens),
    tokenStatus,
    tokenExpiresAt: tokens?.expiresAt,
    tokenExpiresIn: tokens?.expiresAt
      ? Math.max(0, tokens.expiresAt - Math.floor(Date.now() / 1000))
      : null,
    timestamp: new Date().toISOString(),
  });
});

function generateRandomState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function generateRandomNonce(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export default router;
