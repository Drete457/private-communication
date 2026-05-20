import {
  countDashboardRollingMetricEvents,
  recordDashboardRollingMetricEvent
} from './dashboard-history';
import {
  getActiveCallCount,
  getOnlineUserCount,
  getPendingIncomingCallCount,
  getQueuedMessageCount,
  getQueuedReceiptCount
} from './redis';
import { sessionManager } from './session-manager';

import type { DashboardApplicationMetric, DashboardApplicationResponse, DashboardStatus } from '../types/dashboard';

const DASHBOARD_APPLICATION_WINDOW_MS = 300_000;
const DASHBOARD_AUTH_FAILURE_WARNING_THRESHOLD = 3;
const DASHBOARD_AUTH_FAILURE_CRITICAL_THRESHOLD = Math.max(DASHBOARD_AUTH_FAILURE_WARNING_THRESHOLD, 10);
const DASHBOARD_RATE_LIMIT_SPIKE_THRESHOLD = 5;

type RollingMetricId = 'auth_failure' | 'rate_limit_rejection';

const rollingMetricEvents = new Map<RollingMetricId, number[]>([
  ['auth_failure', []],
  ['rate_limit_rejection', []]
]);

const getRollingMetricEvents = (metricId: RollingMetricId): number[] => {
  const events = rollingMetricEvents.get(metricId);
  if (!events) 
    throw new Error(`Unknown dashboard rolling metric: ${metricId}`);

  return events;
};

const getWindowMinutes = (): number => {
  return Math.max(1, Math.round(DASHBOARD_APPLICATION_WINDOW_MS / 60_000));
};

const pruneRollingMetric = (metricId: RollingMetricId, now: number): void => {
  const cutoff = now - DASHBOARD_APPLICATION_WINDOW_MS;
  const events = getRollingMetricEvents(metricId);
  while (events.length > 0 && (events[0] ?? 0) < cutoff) {
    events.shift();
  }
};

const recordRollingMetric = (metricId: RollingMetricId): void => {
  const now = Date.now();
  const events = getRollingMetricEvents(metricId);
  events.push(now);
  pruneRollingMetric(metricId, now);
  void recordDashboardRollingMetricEvent(metricId, now);
};

const getRollingMetricCount = async (metricId: RollingMetricId): Promise<number> => {
  const now = Date.now();
  pruneRollingMetric(metricId, now);
  const persistedCount = await countDashboardRollingMetricEvents(metricId, DASHBOARD_APPLICATION_WINDOW_MS, now);
  return persistedCount ?? getRollingMetricEvents(metricId).length;
};

const formatRatePerMinute = (count: number): string => {
  const rate = count / getWindowMinutes();
  if (!Number.isFinite(rate)) 
    return 'n/a';

  return `${rate.toFixed(rate >= 10 ? 0 : 1)}/min`;
};

const createCountMetric = (
  id: string,
  label: string,
  value: number,
  summary: string,
  status: DashboardStatus | null = null
): DashboardApplicationMetric => {
  return {
    id,
    label,
    displayValue: String(value),
    numericValue: value,
    summary,
    status
  };
};

export const recordDashboardAuthFailure = (): void => {
  recordRollingMetric('auth_failure');
};

export const recordDashboardRateLimitRejection = (): void => {
  recordRollingMetric('rate_limit_rejection');
};

export const getDashboardApplication = async (): Promise<DashboardApplicationResponse> => {
  const [
    onlineUsers,
    queuedEncryptedMessages,
    queuedReceipts,
    pendingCalls,
    activeCalls
  ] = await Promise.all([
    getOnlineUserCount(),
    getQueuedMessageCount(),
    getQueuedReceiptCount(),
    getPendingIncomingCallCount(),
    getActiveCallCount()
  ]);

  const connectedWebSocketSessions = sessionManager.getConnectedUsers().length;
  const windowMinutes = getWindowMinutes();
  const [authFailureCount, rateLimitRejectionCount] = await Promise.all([
    getRollingMetricCount('auth_failure'),
    getRollingMetricCount('rate_limit_rejection')
  ]);
  const authFailureStatus: DashboardStatus = authFailureCount >= DASHBOARD_AUTH_FAILURE_CRITICAL_THRESHOLD
    ? 'failed'
    : authFailureCount >= DASHBOARD_AUTH_FAILURE_WARNING_THRESHOLD
      ? 'degraded'
      : 'healthy';
  const hasRateLimitSpike = rateLimitRejectionCount >= DASHBOARD_RATE_LIMIT_SPIKE_THRESHOLD;
  const rateLimitStatus: DashboardStatus = hasRateLimitSpike
    ? 'failed'
    : rateLimitRejectionCount > 0
      ? 'degraded'
      : 'healthy';

  return {
    generatedAt: new Date().toISOString(),
    windowMinutes,
    metrics: [
      createCountMetric(
        'connected-websocket-sessions',
        'WebSocket sessions',
        connectedWebSocketSessions,
        'Authenticated live WebSocket sessions tracked in backend memory.'
      ),
      createCountMetric(
        'online-users',
        'Online users',
        onlineUsers,
        'Users currently marked online in Redis presence.'
      ),
      createCountMetric(
        'queued-encrypted-messages',
        'Queued messages',
        queuedEncryptedMessages,
        'Encrypted messages waiting for delivery to offline users.'
      ),
      createCountMetric(
        'queued-receipts',
        'Queued receipts',
        queuedReceipts,
        'Receipt updates waiting for delivery or ACK.'
      ),
      createCountMetric(
        'pending-calls',
        'Pending calls',
        pendingCalls,
        'Calls still ringing or waiting for an answer.'
      ),
      createCountMetric(
        'active-calls',
        'Active calls',
        activeCalls,
        'Call pairs active past the pending-offer phase.'
      ),
      {
        id: 'auth-failure-rate',
        label: 'Auth failure rate',
        displayValue: formatRatePerMinute(authFailureCount),
        numericValue: authFailureCount,
        summary: authFailureCount === 0
          ? `No auth failures in last ${windowMinutes} min.`
          : `${authFailureCount} auth failures in last ${windowMinutes} min.`,
        status: authFailureStatus
      },
      {
        id: 'rate-limit-signal',
        label: 'Rate-limit signal',
        displayValue: hasRateLimitSpike ? 'Spike' : (rateLimitRejectionCount > 0 ? 'Elevated' : 'Normal'),
        numericValue: rateLimitRejectionCount,
        summary: rateLimitRejectionCount === 0
          ? `No rate-limit rejections in last ${windowMinutes} min.`
          : `${rateLimitRejectionCount} rejections in last ${windowMinutes} min.`,
        status: rateLimitStatus
      }
    ]
  };
};