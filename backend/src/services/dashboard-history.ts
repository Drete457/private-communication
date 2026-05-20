import { randomUUID } from 'crypto';

import { logger } from '../utils/logger';

import { getRedis } from './redis';

import type { DashboardService } from '../types/dashboard';

const DASHBOARD_HISTORY_TTL_SECONDS = 604_800;
const DASHBOARD_HISTORY_TTL_MS = DASHBOARD_HISTORY_TTL_SECONDS * 1_000;

export type DashboardQueueGrowthSample = {
  observedAtMs: number;
  totalCount: number;
};

const KEYS = {
  rollingMetric: (metricId: string) => `dashboard:history:metric:${normalizeHistoryId(metricId)}`,
  queueGrowth: 'dashboard:history:queue-growth',
  probeFailureStreaks: 'dashboard:history:probe-failure-streaks',
  probeObservationToken: 'dashboard:history:last-probe-observation-token'
};

const normalizeHistoryId = (value: string): string => {
  const normalized = value.replace(/[^a-z0-9:_-]/gi, '_').slice(0, 80);
  return normalized.length > 0 ? normalized : 'unknown';
};

const getRetentionCutoff = (nowMs: number): number => nowMs - DASHBOARD_HISTORY_TTL_MS;

const logHistoryFailure = (operation: string, error: unknown): void => {
  logger.debug('Dashboard Redis history operation failed', {
    operation,
    error: error instanceof Error ? error.message : 'Unknown error'
  });
};

export const recordDashboardRollingMetricEvent = async (metricId: string, occurredAtMs = Date.now()): Promise<void> => {
  try {
    const redis = getRedis();
    const key = KEYS.rollingMetric(metricId);
    await redis.multi()
      .zadd(key, occurredAtMs, `${occurredAtMs}:${randomUUID()}`)
      .zremrangebyscore(key, 0, getRetentionCutoff(occurredAtMs))
      .expire(key, DASHBOARD_HISTORY_TTL_SECONDS)
      .exec();
  } catch (error) {
    logHistoryFailure('record rolling metric', error);
  }
};

export const countDashboardRollingMetricEvents = async (metricId: string, windowMs: number, nowMs = Date.now()): Promise<number | null> => {
  try {
    const redis = getRedis();
    const key = KEYS.rollingMetric(metricId);
    const cutoff = nowMs - windowMs;
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, getRetentionCutoff(nowMs));
    pipeline.expire(key, DASHBOARD_HISTORY_TTL_SECONDS);
    pipeline.zcount(key, cutoff, '+inf');
    const results = await pipeline.exec();
    const countResult = results?.[2]?.[1];

    return typeof countResult === 'number' && Number.isFinite(countResult) ? countResult : null;
  } catch (error) {
    logHistoryFailure('count rolling metric', error);
    return null;
  }
};

const parseQueueGrowthSample = (member: string): DashboardQueueGrowthSample | null => {
  const [observedAtValue, totalCountValue] = member.split(':');
  const observedAtMs = Number(observedAtValue);
  const totalCount = Number(totalCountValue);

  if (!Number.isFinite(observedAtMs) || !Number.isFinite(totalCount) || observedAtMs <= 0 || totalCount < 0) 
    return null;

  return {
    observedAtMs,
    totalCount
  };
};

export const recordDashboardQueueGrowthSample = async (
  sample: DashboardQueueGrowthSample,
  windowMs: number,
  nowMs = Date.now()
): Promise<DashboardQueueGrowthSample[] | null> => {
  try {
    const redis = getRedis();
    const minimumWindowMs = Math.min(windowMs, DASHBOARD_HISTORY_TTL_MS);
    const retentionCutoff = getRetentionCutoff(nowMs);
    const windowCutoff = nowMs - minimumWindowMs;
    const key = KEYS.queueGrowth;

    const pipeline = redis.pipeline();
    pipeline.zadd(key, sample.observedAtMs, `${sample.observedAtMs}:${sample.totalCount}`);
    pipeline.zremrangebyscore(key, 0, retentionCutoff);
    pipeline.expire(key, DASHBOARD_HISTORY_TTL_SECONDS);
    pipeline.zrangebyscore(key, windowCutoff, '+inf');
    const results = await pipeline.exec();
    const members = results?.[3]?.[1];

    if (!Array.isArray(members)) 
      return null;

    return members
      .filter((member): member is string => typeof member === 'string')
      .map(parseQueueGrowthSample)
      .filter((candidate): candidate is DashboardQueueGrowthSample => candidate !== null)
      .sort((left, right) => left.observedAtMs - right.observedAtMs);
  } catch (error) {
    logHistoryFailure('record queue growth sample', error);
    return null;
  }
};

export const recordDashboardProbeFailureObservation = async (
  observationToken: string,
  services: DashboardService[]
): Promise<Map<string, number> | null> => {
  try {
    const redis = getRedis();
    const lastObservationToken = await redis.get(KEYS.probeObservationToken);
    const probeServices = services.filter((service) => service.kind === 'probe');

    if (lastObservationToken !== observationToken && probeServices.length > 0) {
      const currentStreaks = await redis.hgetall(KEYS.probeFailureStreaks);
      const nextStreaks = new Map<string, number>();

      for (const service of probeServices) {
        const currentStreak = Number(currentStreaks[service.id] ?? 0);
        nextStreaks.set(service.id, service.status === 'failed' ? Math.max(0, currentStreak) + 1 : 0);
      }

      const multi = redis.multi();
      multi.set(KEYS.probeObservationToken, observationToken, 'EX', DASHBOARD_HISTORY_TTL_SECONDS);
      for (const [serviceId, streak] of nextStreaks) 
        multi.hset(KEYS.probeFailureStreaks, serviceId, String(streak));
      multi.expire(KEYS.probeFailureStreaks, DASHBOARD_HISTORY_TTL_SECONDS);
      await multi.exec();
    }

    const values = await redis.hgetall(KEYS.probeFailureStreaks);
    const streaks = new Map<string, number>();
    for (const [serviceId, streakValue] of Object.entries(values)) {
      const streak = Number(streakValue);
      if (Number.isFinite(streak) && streak >= 0) 
        streaks.set(serviceId, streak);
    }

    return streaks;
  } catch (error) {
    logHistoryFailure('record probe failure observation', error);
    return null;
  }
};