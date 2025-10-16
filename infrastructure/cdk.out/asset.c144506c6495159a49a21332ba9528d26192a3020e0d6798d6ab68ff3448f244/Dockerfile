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
# Force rebuild - Dynamic MCP capabilities v3.1.0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
EXPOSE 3030
CMD ["node","dist/server.js"]

