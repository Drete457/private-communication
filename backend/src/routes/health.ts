/**
 * Health check routes for container orchestration
 */

import { Router } from 'express';

import { getBasicHealthCheck, getReadinessHealthCheck } from '../services/health';

export const healthRouter = Router();

/**
 * Basic health check
 */
healthRouter.get('/', (_req, res) => {
  const result = getBasicHealthCheck();
  res.status(result.httpStatus).json(result.payload);
});

/**
 * Deep health check including dependencies
 */
healthRouter.get('/ready', async (_req, res) => {
  const result = await getReadinessHealthCheck();
  res.status(result.httpStatus).json(result.payload);
});
