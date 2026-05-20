/**
 * Main entry point for the signaling server
 * 
 * Responsibilities:
 * - HTTP server for health checks
 * - WebSocket server for real-time signaling
 * - Challenge-response authentication
 * - Message queue management
 */

import { createServer } from 'http';

import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';

import { requireSignedRequest, validateOrigin } from './middleware';
import { attachmentsRouter } from './routes/attachments';
import { callRouter } from './routes/call';
import { dashboardRouter } from './routes/dashboard';
import { healthRouter } from './routes/health';
import { linkPreviewRouter } from './routes/link-preview';
import { pushRouter } from './routes/push';
import { turnRouter } from './routes/turn';
import { recordDashboardRateLimitRejection } from './services/application';
import {
  initializeAttachmentCleanupSweeper,
  initializeAttachmentExpirationCleanup
} from './services/attachments';
import { initializePush } from './services/push';
import { initializeRedis } from './services/redis';
import { LIMIT_IPV6_SUBNET, normalizeIpForRateLimit } from './utils';
import { logger } from './utils/logger';
import { handleConnection } from './websocket/connection-handler';

import type { IncomingMessage } from 'http';
import type { WebSocket } from 'ws';

dotenv.config();

const PORT = process.env['PORT'] ?? 8080;
const CORS_ORIGINS = process.env['CORS_ORIGINS']?.split(',') ?? ['http://localhost:5173'];
const HTTP_BODY_LIMIT = process.env['HTTP_BODY_LIMIT'] ?? '100kb';
const WS_MAX_PAYLOAD_BYTES = Number(process.env['WS_MAX_PAYLOAD_BYTES'] ?? 262144);
const WS_MAX_CONNECTIONS_PER_IP = Number(process.env['WS_MAX_CONNECTIONS_PER_IP'] ?? 5);
const TRUST_PROXY_HOPS = Math.max(0, Number(process.env['TRUST_PROXY_HOPS'] ?? 1));
const DASHBOARD_API_RATE_LIMIT_WINDOW_MS = 60_000;
const DASHBOARD_API_RATE_LIMIT_MAX = 600;

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const parseForwardedForHeader = (headerValue: string | string[] | undefined): string[] => {
  if (!headerValue) 
    return [];

  const combinedHeader = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  return combinedHeader
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

const getForwardedClientIp = (headerValue: string | string[] | undefined, trustedProxyHops: number): string | null => {
  if (trustedProxyHops <= 0) 
    return null;

  const forwardedAddresses = parseForwardedForHeader(headerValue);
  if (forwardedAddresses.length < trustedProxyHops) 
    return null;

  return forwardedAddresses[forwardedAddresses.length - trustedProxyHops] ?? null;
};

const getWebSocketClientIp = (request: IncomingMessage): string => {
  const remoteAddress = request.socket.remoteAddress ?? 'unknown';
  const forwardedClientIp = getForwardedClientIp(request.headers['x-forwarded-for'], TRUST_PROXY_HOPS);

  return forwardedClientIp ?? remoteAddress;
};

const getWebSocketConnectionKey = (request: IncomingMessage): string => {
  const clientIp = getWebSocketClientIp(request);
  return clientIp === 'unknown'
    ? clientIp
    : ipKeyGenerator(normalizeIpForRateLimit(clientIp), LIMIT_IPV6_SUBNET);
};

const handleDashboardRateLimitedRequest = (
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
  options: { statusCode: number; message: unknown }
): void => {
  recordDashboardRateLimitRejection();
  res.status(options.statusCode).send(options.message);
};

async function main() {
  // Initialize Redis connection
  await initializeRedis();
  initializeAttachmentExpirationCleanup();
  initializeAttachmentCleanupSweeper();
  logger.info('Redis connection established');

  initializePush();

  // Create Express app
  const app = express();

  app.set('trust proxy', TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: false
  }));
  
  // Middleware
  app.use(cors({
    origin: CORS_ORIGINS,
    credentials: true
  }));
  app.use(express.json({
    limit: HTTP_BODY_LIMIT,
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString('utf8');
    }
  }));
  const dashboardLimiter = rateLimit({
    windowMs: DASHBOARD_API_RATE_LIMIT_WINDOW_MS,
    max: DASHBOARD_API_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(
      normalizeIpForRateLimit(req.ip ?? req.socket.remoteAddress ?? 'unknown'),
      LIMIT_IPV6_SUBNET
    ),
    handler: handleDashboardRateLimitedRequest
  });

  const previewLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: handleDashboardRateLimitedRequest
  });

  const pushLimiter = rateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    handler: handleDashboardRateLimitedRequest
  });

  const turnLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    handler: handleDashboardRateLimitedRequest
  });

  // Routes
  // /health: basic health checks for uptime and dependency readiness (Redis ping).
  app.use('/health', healthRouter);
  // /api/dashboard: read-only operational dashboard endpoints backed by sanitized runtime metadata.
  app.use('/api/dashboard', dashboardLimiter, dashboardRouter);
  app.use('/api', validateOrigin(CORS_ORIGINS));
  // /api/preview: fetches page metadata (title/description/image) and proxies images for cards.
  // Signed + rate-limited to prevent abuse and SSRF.
  app.use('/api/preview', previewLimiter, requireSignedRequest(), linkPreviewRouter);
  // /api/push: returns VAPID public key and receives push subscribe/unsubscribe requests.
  // Signed + rate-limited to avoid unsolicited registrations.
  app.use('/api/push', pushLimiter, requireSignedRequest(), pushRouter);
  // /api/turn: returns ephemeral TURN credentials.
  // Signed + rate-limited to avoid abuse.
  app.use('/api/turn', turnLimiter, requireSignedRequest(), turnRouter);
  // /api/call: returns pending incoming call offers for app reopen/recover flows.
  // Signed requests required.
  app.use('/api/call', requireSignedRequest(), callRouter);
  // /api/attachments: attachment policy and transfer endpoints.
  // Signed requests required.
  app.use('/api/attachments', requireSignedRequest(), attachmentsRouter);

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket server
  const wss = new WebSocketServer({ 
    server,
    path: '/ws',
    maxPayload: WS_MAX_PAYLOAD_BYTES
  });

  const wsConnectionsByIp = new Map<string, number>();
  const wsSocketIp = new Map<WebSocket, string>();

  // Handle WebSocket connections
  wss.on('connection', (socket, request) => {
    const origin = request.headers.origin;
    if (process.env['NODE_ENV'] === 'production' && (!origin || !CORS_ORIGINS.includes(origin))) {
      logger.warn('Rejected WebSocket origin', { origin });
      socket.close(1008, 'Origin not allowed');
      return;
    }
    const clientIp = getWebSocketClientIp(request);
    const connectionKey = getWebSocketConnectionKey(request);
    const current = wsConnectionsByIp.get(connectionKey) ?? 0;
    if (current >= WS_MAX_CONNECTIONS_PER_IP) {
      recordDashboardRateLimitRejection();
      logger.warn('Rejected WebSocket connection (per-IP limit)', {
        clientIp,
        connectionKey
      });
      socket.close(1013, 'Too many connections');
      return;
    }
    wsConnectionsByIp.set(connectionKey, current + 1);
    wsSocketIp.set(socket, connectionKey);
    logger.info('New WebSocket connection', { 
      ip: clientIp,
      connectionKey,
      remoteAddress: request.socket.remoteAddress ?? 'unknown'
    });
    handleConnection(socket);
    socket.on('close', () => {
      const socketIp = wsSocketIp.get(socket);
      if (socketIp) {
        const count = wsConnectionsByIp.get(socketIp) ?? 0;
        const next = Math.max(0, count - 1);
        if (next === 0) {
          wsConnectionsByIp.delete(socketIp);
        } else {
          wsConnectionsByIp.set(socketIp, next);
        }
        wsSocketIp.delete(socket);
      }
    });
  });

  // Error handling
  wss.on('error', (error) => {
    logger.error('WebSocket server error', { error: error.message });
  });

  // Start server
  server.listen(PORT, () => {
    logger.info(`Signaling server running on port ${PORT}`);
    logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    wss.close(() => {
      server.close(() => {
        logger.info('Server closed');
      });
    });
  });
}

main().catch((error: unknown) => {
  logger.error('Failed to start server', { error: getErrorMessage(error) });
  process.exitCode = 1;
});
