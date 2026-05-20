# Multi-stage build: build frontend, serve with nginx
FROM node:alpine AS build
WORKDIR /app

# Install workspace dependencies with local PCBK core package available
COPY package*.json ./
COPY frontend/package.json ./frontend/package.json
COPY packages/pcbk-core/package.json ./packages/pcbk-core/package.json
RUN npm ci

# Build assets
COPY frontend ./frontend
COPY packages/pcbk-core ./packages/pcbk-core
RUN npm run build:frontend

# Final image
FROM nginx:alpine

# Copy nginx configs
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx/conf.d /etc/nginx/conf.d

# Copy built frontend
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Default nginx entrypoint/cmd
