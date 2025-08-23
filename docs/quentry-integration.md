# Quentry Authentication Integration with BFF

This document explains the key points of the integration between the BFF (Backend-for-Frontend) server and Quentry's authentication system.

## Authentication Flow

1. User signs in to Keycloak (or uses the test endpoint for development)
2. BFF uses the user's credentials to authenticate with Quentry
3. BFF stores the Quentry token in a session (Redis or memory fallback)
4. Subsequent requests to Quentry API are proxied through the BFF with the stored token

## Key Findings and Implementation Details

### Response Structure

Quentry's authentication endpoint (`/api/r8/sessions`) returns a nested data structure:

```json
{
  "data": {
    "token": "EU_xxxxxxxx",
    "userName": "username",
    "fullName": "Full Name",
    "userEmail": "email@example.com",
    "userSystemId": "user-id",
    "urlsLookup": { ... },
    // Other fields
  },
  "hasErrors": false,
  "errorCode": null,
  "errorDescription": null,
  "error": null
}
```

Our service must handle this nested structure by extracting the data object first.

### Required Headers

Quentry requires specific headers for authentication:

```
'Content-Type': 'application/json',
'VoyantClientAppName': 'Quentry',
'X-Voyant-Client-Application': 'Quentry',
'Cookie': '_ga=GA1.1.676161230.1755775053; blBrand=default',
'User-Agent': 'BFF-Integration/1.0'
```

### Session Storage

The BFF stores the Quentry session in Redis (with a memory fallback) with the following structure:

```json
{
  "token": "EU_xxxxxxxx",
  "userName": "username",
  "fullName": "Full Name",
  "userEmail": "email@example.com",
  "userSystemId": "user-id",
  "urlsLookup": { ... },
  "expires": 1755946800000  // Expiration timestamp
}
```

## Development Testing

For testing the Quentry authentication without Keycloak, use:

```
POST /quentry/test-auth
Content-Type: application/json

{
  "username": "bff.bff",
  "password": "Paris123"
}
```

This endpoint will return the user information and session ID if successful.

## Production Integration

In production, the `/quentry/login` endpoint should be used, which is protected by Keycloak authentication middleware. This endpoint follows the same pattern but extracts the user from the Keycloak session.

## Troubleshooting

If authentication fails:

1. Check that the required headers are being sent
2. Verify the credentials are correct
3. Examine the full response from Quentry to understand any error messages
4. Ensure Redis is running (if using Redis for session storage)
5. Check that the proper data structure is being parsed (data.token vs token)

## Next Steps

1. Implement token refresh mechanism
2. Add stronger error handling for network failures
3. Consider implementing a circuit breaker for Quentry API calls
