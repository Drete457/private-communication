# =====================================================
# Backend Dockerfile - Multi-stage build
# =====================================================

# Stage 1: Build
FROM node:alpine AS builder

WORKDIR /workspace

# Copy workspace manifests first for Docker layer reuse
COPY package*.json ./
COPY backend/package.json ./backend/package.json

# Install dependencies
RUN npm ci

# Copy backend source code
COPY backend ./backend

# Build TypeScript
RUN npm run build --workspace backend

# Stage 2: Production
FROM node:alpine AS production

WORKDIR /workspace

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
  adduser -S nodejs -u 1001

# Create writable attachment storage for the non-root runtime user
RUN mkdir -p /data/attachments

# Copy workspace manifests first so npm can use the root lockfile
COPY package*.json ./
COPY backend/package.json ./backend/package.json

# Install backend production dependencies deterministically from the workspace lockfile
RUN npm ci --omit=dev --workspace backend && rm -rf /root/.npm

# Copy built files from builder
COPY --from=builder /workspace/backend/dist ./backend/dist

WORKDIR /workspace/backend


# Change ownership
RUN chown -R nodejs:nodejs /workspace /data

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
