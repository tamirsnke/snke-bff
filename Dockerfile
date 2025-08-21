# Multi-stage build for production optimization
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY src ./src

# Build application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
  adduser -S bff -u 1001

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy built application
COPY --from=builder --chown=bff:nodejs /app/dist ./dist
COPY --from=builder --chown=bff:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=bff:nodejs /app/package.json ./

# Create necessary directories
RUN mkdir -p logs certs && chown -R bff:nodejs logs certs

# Switch to non-root user
USER bff

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node dist/scripts/healthcheck.js

# Expose ports
EXPOSE 3000 9090

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/index.js"]
