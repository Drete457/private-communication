import { getRedis } from './redis';

const READINESS_REDIS_TIMEOUT_MS = Math.max(100, Number(process.env['READINESS_REDIS_TIMEOUT_MS'] ?? 1_000));

export interface BasicHealthPayload {
  status: 'healthy';
  timestamp: string;
  uptime: number;
}

export interface ReadinessHealthPayload {
  status: 'ready' | 'unhealthy';
  timestamp: string;
  dependencies?: {
    redis: 'healthy';
  };
  error?: string;
}

export interface HealthCheckResult<TPayload> {
  ok: boolean;
  httpStatus: number;
  payload: TPayload;
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(`${label} failed`));
      });
  });
};

export const getBasicHealthCheck = (): HealthCheckResult<BasicHealthPayload> => {
  return {
    ok: true,
    httpStatus: 200,
    payload: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  };
};

export const getReadinessHealthCheck = async (): Promise<HealthCheckResult<ReadinessHealthPayload>> => {
  try {
    const redis = getRedis();
    if (redis.status !== 'ready') 
      throw new Error(`Redis client not ready: ${redis.status}`);

    await withTimeout(redis.ping(), READINESS_REDIS_TIMEOUT_MS, 'Redis ping');

    return {
      ok: true,
      httpStatus: 200,
      payload: {
        status: 'ready',
        timestamp: new Date().toISOString(),
        dependencies: {
          redis: 'healthy'
        }
      }
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: 503,
      payload: {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
};