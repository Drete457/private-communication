import { Router } from 'express';

import { getDashboardApplication } from '../services/application';
import { getDashboardEvents, getDashboardServices } from '../services/dashboard';
import { getDashboardAlerts, getDashboardSummary } from '../services/dashboard-overview';
import { getDashboardRisk } from '../services/risk';
import { getDashboardSystem } from '../services/system';
import { isPrivateOrLoopbackIp } from '../utils/network';

import type { NextFunction, Request, Response } from 'express';

export const dashboardRouter = Router();

const MAX_DASHBOARD_URL_LENGTH = 512;
const MAX_EVENTS_LIMIT = 50;
const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

const parseOptionalPositiveNumber = (value: unknown): { ok: true; value?: number } | { ok: false; message: string } => {
  if (value === undefined || (typeof value === 'string' && value.trim().length === 0)) 
    return { ok: true };

  if (typeof value !== 'string') 
    return { ok: false, message: 'limit must be a positive integer' };

  const normalizedValue = value.trim();
  if (!/^\d{1,6}$/.test(normalizedValue)) 
    return { ok: false, message: 'limit must be a positive integer' };

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? { ok: true, value: Math.min(MAX_EVENTS_LIMIT, parsedValue) }
    : { ok: false, message: 'limit must be a positive integer' };
};

const getSocketRemoteAddress = (req: Request): string | null => {
  return typeof req.socket.remoteAddress === 'string' && req.socket.remoteAddress.length > 0
    ? req.socket.remoteAddress
    : null;
};

const dashboardSecurityMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (req.originalUrl.length > MAX_DASHBOARD_URL_LENGTH) {
    res.status(414).json({ error: 'Dashboard request URI too long' });
    return;
  }

  const remoteAddress = getSocketRemoteAddress(req);
  if (!remoteAddress || !isPrivateOrLoopbackIp(remoteAddress)) {
    res.status(403).json({ error: 'Dashboard API is LAN only' });
    return;
  }

  next();
};

const assertAllowedQueryParams = (req: Request, res: Response, allowedKeys: string[]): boolean => {
  const allowed = new Set(allowedKeys);
  const invalidKey = Object.keys(req.query).find((key) => !allowed.has(key));
  if (!invalidKey) 
    return true;

  res.status(400).json({ error: `Unsupported dashboard query parameter: ${invalidKey}` });
  return false;
};

dashboardRouter.use(dashboardSecurityMiddleware);

dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, [])) 
      return;

    res.json(await getDashboardSummary());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/services', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, [])) 
      return;

    res.json(await getDashboardServices());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/alerts', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, [])) 
      return;

    res.json(await getDashboardAlerts());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/system', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, [])) 
      return;

    res.json(await getDashboardSystem());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/application', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, [])) 
      return;

    res.json(await getDashboardApplication());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/risk', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, [])) 
      return;

    res.json(await getDashboardRisk());
  } catch (error) {
    next(error);
  }
});

dashboardRouter.get('/events', async (req, res, next) => {
  try {
    if (!assertAllowedQueryParams(req, res, ['limit', 'serviceId'])) 
      return;

    const rawServiceId = req.query['serviceId'];
    if (rawServiceId !== undefined && typeof rawServiceId !== 'string') {
      res.status(400).json({ error: 'Invalid dashboard serviceId' });
      return;
    }

    const serviceId = typeof rawServiceId === 'string' && rawServiceId.trim().length > 0
      ? rawServiceId.trim()
      : undefined;
    if (typeof serviceId === 'string' && !SERVICE_ID_PATTERN.test(serviceId)) {
      res.status(400).json({ error: 'Invalid dashboard serviceId' });
      return;
    }

    const limit = parseOptionalPositiveNumber(req.query['limit']);
    if (!limit.ok) {
      res.status(400).json({ error: limit.message });
      return;
    }

    const options: { limit?: number; serviceId?: string } = {};

    if (typeof limit.value === 'number') 
      options.limit = limit.value;
    
    if (typeof serviceId === 'string') 
      options.serviceId = serviceId;

    res.json(await getDashboardEvents(options));
  } catch (error) {
    next(error);
  }
});