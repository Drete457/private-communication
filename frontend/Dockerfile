# =====================================================
# Frontend Dockerfile - Multi-stage build for PWA
# =====================================================

# Stage 1: Build
FROM node:alpine AS builder

WORKDIR /app

# Copy workspace manifests first for Docker layer reuse
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
COPY packages/pcbk-core/package.json ./packages/pcbk-core/package.json

# Install dependencies
RUN npm ci

# Copy workspace source code
COPY frontend ./frontend
COPY packages/pcbk-core ./packages/pcbk-core

# Build for production
RUN npm run build:frontend

# Stage 2: Production (Nginx static files)
# Note: In docker-compose, we mount dist directly to nginx
FROM nginx:alpine AS production

# Copy built files
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
