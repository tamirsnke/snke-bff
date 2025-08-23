# Quentry BFF Integration

This Backend-for-Frontend (BFF) serves as an authentication and integration layer between Keycloak and Quentry. It enables users to authenticate through Keycloak and then use their credentials to access Quentry services.

## Architecture

The BFF follows a layered architecture pattern:

1. **Authentication Layer**: Handles Keycloak authentication and session management
2. **Integration Layer**: Maps Keycloak users to Quentry users and manages Quentry sessions
3. **Proxy Layer**: Forwards authenticated requests to Quentry API with appropriate credentials

## Features

- Keycloak authentication with session management
- Quentry authentication and session caching using Redis
- Token refresh and session management
- API proxying with authentication headers
- Comprehensive monitoring and logging
- Circuit breaker pattern for resilience
- Health checks and metrics

## Configuration

Configuration is managed through environment variables:

### Core Settings

- `NODE_ENV`: Application environment (development, staging, production)
- `SERVER_PORT`: Port the BFF runs on (default: 3000)

### Keycloak Settings

- `KEYCLOAK_URL`: URL for the Keycloak server
- `KEYCLOAK_REALM`: Keycloak realm name
- `KEYCLOAK_CLIENT_ID`: Client ID for this application in Keycloak
- `KEYCLOAK_CLIENT_SECRET`: Client secret

### Quentry Settings

- `QUENTRY_BASE_URL`: Base URL for Quentry
- `QUENTRY_AUTH_ENDPOINT`: Authentication endpoint for Quentry
- `QUENTRY_COOKIES`: Any required cookies for Quentry
- `QUENTRY_SERVICE_USERNAME`: Service account username (optional)
- `QUENTRY_SERVICE_PASSWORD`: Service account password (optional)

### Redis Settings

- `REDIS_URL`: URL for Redis server
- `REDIS_PASSWORD`: Redis password (if any)
- `REDIS_TLS`: Whether to use TLS for Redis
- `SESSION_STORE`: Session storage type (redis or memory)

## API Endpoints

### Authentication

- `GET /auth/login`: Redirects to Keycloak login
- `GET /auth/callback`: OAuth callback from Keycloak
- `POST /auth/logout`: Logs out from Keycloak
- `GET /auth/status`: Gets current authentication status

### Quentry Integration

- `POST /quentry/login`: Authenticates with Quentry using provided credentials
- `POST /quentry/logout`: Logs out from Quentry
- `GET /quentry/status`: Gets Quentry session status
- `GET /quentry/api/*`: Proxy for Quentry API calls

## Flow Diagram

```
┌─────────┐     ┌───────┐     ┌─────────┐     ┌───────────┐
│ Browser │     │  BFF  │     │Keycloak │     │  Quentry  │
└────┬────┘     └───┬───┘     └────┬────┘     └─────┬─────┘
     │              │              │                │
     │  Keycloak    │              │                │
     │   Login      │              │                │
     │─────────────>│              │                │
     │              │              │                │
     │              │  Redirect    │                │
     │              │─────────────>│                │
     │              │              │                │
     │              │<─────────────│                │
     │              │   Token      │                │
     │<─────────────│              │                │
     │ Logged in    │              │                │
     │              │              │                │
     │ Quentry Login│              │                │
     │─────────────>│              │                │
     │              │  Quentry     │                │
     │              │  Login       │                │
     │              │───────────────────────────────>│
     │              │              │                │
     │              │<───────────────────────────────│
     │              │  Quentry     │                │
     │              │  Token       │                │
     │<─────────────│              │                │
     │  Success     │              │                │
     │              │              │                │
     │  API Request │              │                │
     │─────────────>│              │                │
     │              │  Proxied     │                │
     │              │  Request     │                │
     │              │───────────────────────────────>│
     │              │              │                │
     │              │<───────────────────────────────│
     │              │  Response    │                │
     │<─────────────│              │                │
     │  Response    │              │                │
```

## Angular Integration

The Angular application is configured to use the BFF for authentication and API calls:

1. Environment settings in Angular application:

   ```typescript
   // environment.ts
   export const environment = {
     production: false,
     serverUrl: '/api',
     useHash: true,
     bffBaseUrl: 'http://localhost:3000', // BFF server URL
     useBffAuth: true, // Flag to use BFF authentication
   };
   ```

2. AuthService in Angular handles BFF authentication:
   ```typescript
   // Extract from auth.service.ts
   login(loginContext: LoginDetails): Observable<any> {
     // Check if we should use BFF authentication
     if (environment.useBffAuth && !loginContext.ActivationKey) {
       // Use BFF authentication
       return this.http.post(`${environment.bffBaseUrl}/quentry/login`, {
         username: loginContext.UserName,
         password: loginContext.Password
       }, { withCredentials: true }).pipe(
         tap((response: any) => {
           // Transform the response to match the expected format
           const userData = {
             token: response.token || '',
             userName: response.user?.username || '',
             userEmail: response.user?.email || '',
             fullName: response.user?.fullName || '',
             userSystemId: response.user?.id || '',
             urlsLookup: response.urlsLookup || {}
           };
           this.setLoggedIn(userData);
         }),
         catchError((err) => this.handleError(err))
       );
     }

     // Use direct Quentry authentication
     return this.api.login(loginContext).pipe(
       tap((user) => this.setLoggedIn(user.data)),
       catchError((err) => this.handleError(err))
     );
   }
   ```

## Deployment

### Prerequisites

- Node.js 16+ (or Docker)
- Redis server
- Keycloak server
- Quentry credentials

### Production Setup

1. Copy `.env.example` to `.env` and configure
2. Set up Keycloak:
   - Create a new realm (e.g., "myrealm")
   - Create a client (e.g., "myclient") with confidential access
   - Set valid redirect URI (e.g., "https://your-domain.com/auth/callback")
   - Get client secret from Credentials tab
3. Build and deploy:
   ```bash
   npm run build
   # Using process manager like PM2
   pm2 start dist/index.js --name quentry-bff
   ```

### Docker Setup

1. Build the Docker image:
   ```bash
   docker build -t quentry-bff .
   ```
2. Run the container:
   ```bash
   docker run -p 3000:3000 --env-file .env quentry-bff
   ```

### With Kubernetes (Helm)

1. Install using Helm chart:
   ```bash
   helm install quentry-bff ./helm/quentry-bff
   ```

### Nginx Configuration

For production deployments, set up Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Angular app
    location / {
        root /path/to/angular/dist;
        try_files $uri $uri/ /index.html;
    }

    # BFF endpoints
    location /bff/ {
        proxy_pass http://localhost:3000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Troubleshooting

### Redis Connection Issues

If Redis is not available, the BFF will fall back to using in-memory session store:

```
Redis connection error, will use memory fallback: connect ECONNREFUSED 127.0.0.1:6379
⚠️ Redis initialization failed, using memory session store
```

This is fine for development but not recommended for production.

### Keycloak Connection Issues

If Keycloak is not available, authentication will fail:

```
Keycloak discovery error: Unable to connect to Keycloak server
```

Ensure Keycloak is running and configured correctly.

### Quentry Authentication Issues

If Quentry authentication fails, check:

1. Credentials are correct
2. Quentry service is available
3. No CORS issues preventing requests

## Security Considerations

1. **Transport Security**: Always use HTTPS in production
2. **Token Storage**: Tokens are stored in server-side session, not client-side
3. **CSRF Protection**: Implemented for all state-changing endpoints
4. **Rate Limiting**: Prevents brute force attacks
5. **Content Security Policy**: Restricts resource loading to trusted sources
6. **Cookie Security**: HTTP-only, Secure, SameSite flags set

## Development Notes

In development mode, you can bypass Keycloak authentication to test Quentry integration directly.
