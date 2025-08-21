import { Issuer, Client, Strategy, TokenSet, UserinfoResponse } from 'openid-client';
import { config } from './index';
import { logger } from '../utils/logger';

interface KeycloakConfig {
  client: Client;
  issuer: Issuer;
  strategy: Strategy<any>;
  validateToken: (token: string) => Promise<UserinfoResponse>;
  refreshToken: (refreshToken: string) => Promise<TokenSet>;
  logout: (token: string) => Promise<void>;
  getAuthorizationUrl: (state: string, nonce: string) => string;
}

let keycloak: KeycloakConfig;

export async function initializeKeycloak(): Promise<void> {
  try {
    // Discover Keycloak issuer
    const issuerUrl = `${config.keycloak.url}/realms/${config.keycloak.realm}`;
    const issuer = await Issuer.discover(issuerUrl);

    logger.info('Keycloak issuer discovered', {
      issuer: issuer.issuer,
      authorizationEndpoint: issuer.authorization_endpoint,
      tokenEndpoint: issuer.token_endpoint,
      userinfoEndpoint: issuer.userinfo_endpoint,
      endSessionEndpoint: issuer.end_session_endpoint,
    });

    // Create Keycloak client
    const client = new issuer.Client({
      client_id: config.keycloak.clientId,
      client_secret: config.keycloak.clientSecret,
      redirect_uris: [
        `${config.server.ssl.enabled ? 'https' : 'http'}://${config.server.host}:${config.server.port}/auth/callback`,
      ],
      post_logout_redirect_uris: [
        `${config.server.ssl.enabled ? 'https' : 'http'}://${config.server.host}:${config.server.port}/auth/logout/callback`,
      ],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    });

    // Create OpenID Connect strategy
    const strategy = new Strategy(
      {
        client,
        params: {
          scope: 'openid profile email roles',
          response_type: 'code',
        },
      },
      (tokenSet: TokenSet, userinfo: UserinfoResponse, done: any) => {
        try {
          const user = {
            id: userinfo.sub,
            username: userinfo.preferred_username,
            email: userinfo.email,
            firstName: userinfo.given_name,
            lastName: userinfo.family_name,
            roles: (tokenSet.claims() as any)?.realm_access?.roles || [],
            accessToken: tokenSet.access_token,
            refreshToken: tokenSet.refresh_token,
            idToken: tokenSet.id_token,
            tokenSet,
          };

          logger.security.loginAttempt({
            userId: user.id,
            username: user.username,
            success: true,
          });

          return done(null, user);
        } catch (error) {
          logger.error('Error processing OIDC callback:', error);
          return done(error);
        }
      }
    );

    keycloak = {
      client,
      issuer,
      strategy,

      validateToken: async (token: string): Promise<UserinfoResponse> => {
        try {
          const userinfo = await client.userinfo(token);

          logger.security.tokenValidation({
            userId: userinfo.sub,
            tokenType: 'access_token',
            valid: true,
          });

          return userinfo;
        } catch (error) {
          logger.security.tokenValidation({
            tokenType: 'access_token',
            valid: false,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        }
      },

      refreshToken: async (refreshToken: string): Promise<TokenSet> => {
        try {
          const tokenSet = await client.refresh(refreshToken);

          logger.security.tokenValidation({
            tokenType: 'refresh_token',
            valid: true,
          });

          return tokenSet;
        } catch (error) {
          logger.security.tokenValidation({
            tokenType: 'refresh_token',
            valid: false,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });
          throw error;
        }
      },

      logout: async (token: string): Promise<void> => {
        try {
          if (issuer.end_session_endpoint) {
            await client.revoke(token);
          }

          logger.info('User logged out successfully');
        } catch (error) {
          logger.error('Error during logout:', error);
          throw error;
        }
      },

      getAuthorizationUrl: (state: string, nonce: string): string => {
        return client.authorizationUrl({
          scope: 'openid profile email roles',
          state,
          nonce,
        });
      },
    };

    logger.info('Keycloak client initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize Keycloak:', error);
    throw error;
  }
}

export function getKeycloak(): KeycloakConfig {
  if (!keycloak) {
    throw new Error('Keycloak not initialized. Call initializeKeycloak() first.');
  }
  return keycloak;
}

// Utility functions for token handling
export function extractTokenFromHeader(authHeader: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

export function isTokenExpired(tokenSet: TokenSet): boolean {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = tokenSet.expires_at;

  if (!expiresAt) {
    return false; // Assume not expired if no expiry info
  }

  // Add 5 minute buffer for token refresh
  return expiresAt - 300 <= now;
}

export function getRolesFromToken(tokenSet: TokenSet): string[] {
  try {
    const claims = tokenSet.claims() as any;
    return claims?.realm_access?.roles || [];
  } catch (error) {
    logger.error('Error extracting roles from token:', error);
    return [];
  }
}

export function hasRole(tokenSet: TokenSet, role: string): boolean {
  const roles = getRolesFromToken(tokenSet);
  return roles.includes(role);
}

export function hasAnyRole(tokenSet: TokenSet, requiredRoles: string[]): boolean {
  const userRoles = getRolesFromToken(tokenSet);
  return requiredRoles.some((role) => userRoles.includes(role));
}

export function hasAllRoles(tokenSet: TokenSet, requiredRoles: string[]): boolean {
  const userRoles = getRolesFromToken(tokenSet);
  return requiredRoles.every((role) => userRoles.includes(role));
}
