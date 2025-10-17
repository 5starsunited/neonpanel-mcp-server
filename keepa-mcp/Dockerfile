# Use Node.js 18 Alpine for smaller image size
FROM --platform=linux/amd64 node:18-alpine AS base

# Build argument to force cache invalidation
ARG BUILD_DATE
ENV BUILD_DATE=${BUILD_DATE}

# Set working directory
WORKDIR /app

# Install dependencies for building
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM base AS build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM base AS production

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs keepa

# Copy package.json and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application
COPY --from=build --chown=keepa:nodejs /app/dist ./dist

# Switch to non-root user
USER keepa

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => { process.exit(1) })"

# Start the server
CMD ["node", "dist/server.js"]
