FROM node:18-alpine as deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM node:18-alpine as builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3030

# Install Python and dependencies for forecasting tool
RUN apk add --no-cache python3 py3-pip && \
    python3 -m pip install --no-cache-dir pandas numpy python-dateutil

# Force rebuild - Dynamic MCP capabilities v3.1.1 with OpenAPI + Python forecasting
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi.json ./openapi.json
EXPOSE 3030
CMD ["node","dist/main.js"]

