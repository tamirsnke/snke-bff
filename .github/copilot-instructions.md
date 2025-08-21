# BFF Project Instructions

This is a Backend-for-Frontend (BFF) project with comprehensive security, scalability, and monitoring features.

## Features

- Node.js Express with TypeScript
- Keycloak authentication with PostgreSQL integration
- Redis session management with fallback to in-memory
- SSL/TLS with custom CA
- API Gateway support for multiple apps
- Comprehensive monitoring and logging
- Production-ready configuration

## Project Status

- [x] Project structure created
- [x] Dependencies configured
- [x] Configuration completed
- [x] Docker environment ready
- [x] Monitoring stack configured
- [x] Documentation completed

## Next Steps

1. Copy `.env.example` to `.env` and configure your settings
2. Run `docker-compose up -d` to start infrastructure services
3. Configure Keycloak with myrealm and myclient
4. Run `npm install && npm run dev` to start development
5. Visit http://localhost:3000 for the application
6. Visit http://localhost:3001 for Grafana dashboards
7. Visit http://localhost:16686 for Jaeger tracing
