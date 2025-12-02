## Multi-stage Dockerfile for building and running Next.js production
FROM node:22 AS builder
WORKDIR /app/next-app
# Copy package files first to leverage layer caching for npm install
COPY next-app/package.json next-app/package-lock.json* ./
RUN npm ci --omit=dev || npm install

# Copy application source
COPY next-app/. .

# Build the Next.js app
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app/next-app
ENV NODE_ENV=production
COPY --from=builder /app/next-app/.next ./.next
COPY --from=builder /app/next-app/public ./public
COPY --from=builder /app/next-app/package.json ./package.json
COPY --from=builder /app/next-app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "run", "start"]