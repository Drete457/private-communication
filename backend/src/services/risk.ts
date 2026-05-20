import { X509Certificate } from 'crypto';
import { connect as createTlsConnection } from 'tls';

import { logger } from '../utils/logger';

import { getAttachmentStorageStats, isAttachmentsEnabled } from './attachments';
import { getDashboardServices } from './dashboard';
import {
  recordDashboardProbeFailureObservation,
  recordDashboardQueueGrowthSample
} from './dashboard-history';
import { getQueuedMessageCount, getQueuedReceiptCount, getRedisMemoryStats } from './redis';

import type { DashboardQueueGrowthSample } from './dashboard-history';
import type { DashboardRiskMetric, DashboardRiskResponse, DashboardService, DashboardStatus } from '../types/dashboard';

const DASHBOARD_RISK_PROBE_STREAK_WARNING = 2;
const DASHBOARD_RISK_PROBE_STREAK_CRITICAL = 4;
const DASHBOARD_QUEUE_GROWTH_WINDOW_MS = 900_000;
const DASHBOARD_QUEUE_GROWTH_WARNING_DELTA = 10;
const DASHBOARD_QUEUE_GROWTH_CRITICAL_DELTA = 50;
const DASHBOARD_REDIS_MEMORY_WARNING_PERCENT = 75;
const DASHBOARD_REDIS_MEMORY_CRITICAL_PERCENT = 90;
const DASHBOARD_ATTACHMENT_STORAGE_WARNING_BYTES = 536_870_912;
const DASHBOARD_ATTACHMENT_STORAGE_CRITICAL_BYTES = 2_147_483_648;
const DASHBOARD_CERT_WARNING_DAYS = 30;
const DASHBOARD_CERT_CRITICAL_DAYS = 7;
const DASHBOARD_TLS_TARGET_PORT = 443;
const DASHBOARD_TLS_TARGET_TIMEOUT_MS = 5_000;
const MAX_BYTE_UNIT_INDEX = 4;

type TlsProbeTarget = {
  host: string;
  port: number;
  servername: string;
  label: string;
};

const probeFailureStreaks = new Map<string, number>();
let queueGrowthSamples: DashboardQueueGrowthSample[] = [];
let certificateProbeParseFailureLogged = false;
let lastRiskObservationToken: string | null = null;

const formatBytes = (value: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) 
    return 'n/a';

  let scaledValue = value;
  let unitIndex = 0;

  while (scaledValue >= 1024 && unitIndex < MAX_BYTE_UNIT_INDEX) {
    scaledValue /= 1024;
    unitIndex += 1;
  }

  const unit = (() => {
    switch (unitIndex) {
      case 1:
        return 'KB';
      case 2:
        return 'MB';
      case 3:
        return 'GB';
      case 4:
        return 'TB';
      default:
        return 'B';
    }
  })();
  return `${scaledValue.toFixed(scaledValue >= 10 || unitIndex === 0 ? 0 : 1)} ${unit}`;
};

const formatPercent = (value: number | null): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) 
    return 'n/a';

  return `${value.toFixed(1)}%`;
};

const getTlsProbeTarget = (): TlsProbeTarget => {
  const host = process.env['NODE_ENV'] === 'development' ? 'nginx-dev' : 'nginx';

  return {
    host,
    port: DASHBOARD_TLS_TARGET_PORT,
    servername: host,
    label: `${host}:${DASHBOARD_TLS_TARGET_PORT}`
  };
};

const createRiskMetric = (
  id: string,
  label: string,
  displayValue: string,
  summary: string,
  status: DashboardStatus | null,
  numericValue: number | null = null
): DashboardRiskMetric => ({
  id,
  label,
  displayValue,
  summary,
  status,
  numericValue
});

const pruneQueueGrowthSamples = (nowMs: number): void => {
  queueGrowthSamples = queueGrowthSamples.filter((sample) => sample.observedAtMs >= nowMs - DASHBOARD_QUEUE_GROWTH_WINDOW_MS);
};

const recordRiskObservation = async (
  observationToken: string,
  services: DashboardService[],
  totalQueuedItems: number
): Promise<{
  probeFailureStreaks: Map<string, number>;
  queueGrowthSamples: DashboardQueueGrowthSample[];
}> => {
  const observedAtMs = Number.isNaN(Date.parse(observationToken)) ? Date.now() : Date.parse(observationToken);

  if (observationToken !== lastRiskObservationToken) {
    for (const service of services.filter((candidate) => candidate.kind === 'probe')) {
      const currentStreak = probeFailureStreaks.get(service.id) ?? 0;
      probeFailureStreaks.set(service.id, service.status === 'failed' ? currentStreak + 1 : 0);
    }

    queueGrowthSamples.push({
      observedAtMs,
      totalCount: totalQueuedItems
    });
    pruneQueueGrowthSamples(Date.now());
    lastRiskObservationToken = observationToken;
  }

  const [persistedProbeFailureStreaks, persistedQueueGrowthSamples] = await Promise.all([
    recordDashboardProbeFailureObservation(observationToken, services),
    recordDashboardQueueGrowthSample({ observedAtMs, totalCount: totalQueuedItems }, DASHBOARD_QUEUE_GROWTH_WINDOW_MS)
  ]);

  return {
    probeFailureStreaks: persistedProbeFailureStreaks ?? probeFailureStreaks,
    queueGrowthSamples: persistedQueueGrowthSamples ?? queueGrowthSamples
  };
};

const buildProbeFailureMetric = (services: DashboardService[], streaks: Map<string, number>): DashboardRiskMetric => {
  const failedProbes = services.filter((service) => service.kind === 'probe' && service.status === 'failed');
  const maxStreak = [...streaks.values()].reduce((currentMax, streak) => Math.max(currentMax, streak), 0);
  const status: DashboardStatus = maxStreak >= DASHBOARD_RISK_PROBE_STREAK_CRITICAL
    ? 'failed'
    : maxStreak >= DASHBOARD_RISK_PROBE_STREAK_WARNING
      ? 'degraded'
      : failedProbes.some((service) => service.status === 'unknown')
        ? 'unknown'
        : 'healthy';

  if (maxStreak === 0) {
    return createRiskMetric(
      'probe-failure-signal',
      'Probe failure signal',
      'Stable',
      'No repeated health or readiness probe failures observed.',
      status,
      0
    );
  }

  const failingLabels = failedProbes.map((service) => service.label).join(', ');
  return createRiskMetric(
    'probe-failure-signal',
    'Probe failure signal',
    `${maxStreak}x`,
    failingLabels.length > 0
      ? `${failingLabels} currently failing. Max consecutive failed checks: ${maxStreak}.`
      : `Recent repeated probe failures observed. Max consecutive failed checks: ${maxStreak}.`,
    status,
    maxStreak
  );
};

const buildQueueGrowthMetric = (totalQueuedItems: number, samples: DashboardQueueGrowthSample[]): DashboardRiskMetric => {
  const oldestSample = samples[0] ?? null;
  const latestSample = samples[samples.length - 1] ?? null;
  const recentSamples = samples.slice(-3);
  const [firstRecentSample, secondRecentSample, thirdRecentSample] = recentSamples;
  const growthDelta = oldestSample && latestSample
    ? latestSample.totalCount - oldestSample.totalCount
    : 0;
  const sustainedGrowth = recentSamples.length >= 3
    && firstRecentSample !== undefined
    && secondRecentSample !== undefined
    && thirdRecentSample !== undefined
    && firstRecentSample.totalCount < secondRecentSample.totalCount
    && secondRecentSample.totalCount < thirdRecentSample.totalCount;
  const status: DashboardStatus = sustainedGrowth && growthDelta >= DASHBOARD_QUEUE_GROWTH_CRITICAL_DELTA
    ? 'failed'
    : sustainedGrowth && growthDelta >= DASHBOARD_QUEUE_GROWTH_WARNING_DELTA
      ? 'degraded'
      : 'healthy';

  if (!sustainedGrowth || growthDelta <= 0) {
    return createRiskMetric(
      'queue-growth-signal',
      'Queue growth signal',
      'Stable',
      `Current queued items: ${totalQueuedItems}. No sustained queue growth observed.`,
      status,
      totalQueuedItems
    );
  }

  return createRiskMetric(
    'queue-growth-signal',
    'Queue growth signal',
    `+${growthDelta}`,
    `Queued items grew by ${growthDelta} over the recent observation window. Current queued items: ${totalQueuedItems}.`,
    status,
    growthDelta
  );
};

const buildRedisMemoryMetric = async (): Promise<DashboardRiskMetric> => {
  const redisMemory = await getRedisMemoryStats();
  if (redisMemory.maxMemoryBytes === null || redisMemory.maxMemoryBytes <= 0 || redisMemory.memoryPressurePercent === null) {
    return createRiskMetric(
      'redis-memory-pressure',
      'Redis memory',
      formatBytes(redisMemory.usedMemoryBytes),
      redisMemory.usedMemoryBytes === null
        ? 'Redis memory stats unavailable.'
        : 'Redis has no maxmemory limit configured, so pressure cannot be scored.',
      'unknown',
      redisMemory.usedMemoryBytes
    );
  }

  const status: DashboardStatus = redisMemory.memoryPressurePercent >= DASHBOARD_REDIS_MEMORY_CRITICAL_PERCENT
    ? 'failed'
    : redisMemory.memoryPressurePercent >= DASHBOARD_REDIS_MEMORY_WARNING_PERCENT
      ? 'degraded'
      : 'healthy';

  return createRiskMetric(
    'redis-memory-pressure',
    'Redis memory',
    formatPercent(redisMemory.memoryPressurePercent),
    `${formatBytes(redisMemory.usedMemoryBytes)} used of ${formatBytes(redisMemory.maxMemoryBytes)} configured maxmemory.`,
    status,
    redisMemory.memoryPressurePercent
  );
};

const buildStorageGrowthMetric = async (): Promise<DashboardRiskMetric> => {
  if (!isAttachmentsEnabled()) {
    return createRiskMetric(
      'attachment-storage-growth',
      'Attachment storage',
      'Off',
      'Attachments are disabled in this environment.',
      'not_applicable',
      null
    );
  }

  const storageStats = await getAttachmentStorageStats();
  const status: DashboardStatus = storageStats.totalBytes >= DASHBOARD_ATTACHMENT_STORAGE_CRITICAL_BYTES
    ? 'failed'
    : storageStats.totalBytes >= DASHBOARD_ATTACHMENT_STORAGE_WARNING_BYTES
      ? 'degraded'
      : 'healthy';

  return createRiskMetric(
    'attachment-storage-growth',
    'Attachment storage',
    formatBytes(storageStats.totalBytes),
    `${storageStats.fileCount} files under attachment storage root ${storageStats.rootPath}.`,
    status,
    storageStats.totalBytes
  );
};

const readCertificateDaysRemainingFromTarget = async (
  target: TlsProbeTarget
): Promise<{ daysRemaining: number | null; certificateSource: string | null }> => new Promise((resolve) => {
  let settled = false;

  const socket = createTlsConnection({
    host: target.host,
    port: target.port,
    servername: target.servername,
    rejectUnauthorized: false
  });

  const finish = (result: { daysRemaining: number | null; certificateSource: string | null }): void => {
    if (settled) 
      return;

    settled = true;
    socket.destroy();
    resolve(result);
  };

  socket.setTimeout(DASHBOARD_TLS_TARGET_TIMEOUT_MS);
  socket.once('secureConnect', () => {
    try {
      const peerCertificate = socket.getPeerCertificate();
      if (!Buffer.isBuffer(peerCertificate.raw) || peerCertificate.raw.length === 0) {
        finish({
          daysRemaining: null,
          certificateSource: null
        });
        return;
      }

      const certificate = new X509Certificate(peerCertificate.raw);
      const expiresAt = Date.parse(certificate.validTo);
      if (Number.isNaN(expiresAt)) {
        finish({
          daysRemaining: null,
          certificateSource: null
        });
        return;
      }

      finish({
        daysRemaining: Math.ceil((expiresAt - Date.now()) / 86_400_000),
        certificateSource: target.label
      });
    } catch (error) {
      if (!certificateProbeParseFailureLogged) {
        certificateProbeParseFailureLogged = true;
        logger.warn('Dashboard certificate probe could not parse peer certificate', {
          target: target.label,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      finish({
        daysRemaining: null,
        certificateSource: null
      });
    }
  });
  socket.once('timeout', () => {
    finish({
      daysRemaining: null,
      certificateSource: null
    });
  });
  socket.once('error', () => {
    finish({
      daysRemaining: null,
      certificateSource: null
    });
  });
});

const readCertificateDaysRemaining = async (): Promise<{ daysRemaining: number | null; certificateSource: string | null }> => {
  const certificateInfo = await readCertificateDaysRemainingFromTarget(getTlsProbeTarget());
  if (certificateInfo.daysRemaining !== null) 
    return certificateInfo;

  return {
    daysRemaining: null,
    certificateSource: null
  };
};

const buildCertificateExpiryMetric = async (): Promise<DashboardRiskMetric> => {
  const certificateInfo = await readCertificateDaysRemaining();
  if (certificateInfo.daysRemaining === null) {
    return createRiskMetric(
      'certificate-expiry-window',
      'Certificate expiry',
      'Unknown',
      'The internal nginx TLS endpoint is not reachable for certificate inspection.',
      'unknown',
      null
    );
  }

  const status: DashboardStatus = certificateInfo.daysRemaining <= DASHBOARD_CERT_CRITICAL_DAYS
    ? 'failed'
    : certificateInfo.daysRemaining <= DASHBOARD_CERT_WARNING_DAYS
      ? 'degraded'
      : 'healthy';

  return createRiskMetric(
    'certificate-expiry-window',
    'Certificate expiry',
    `${certificateInfo.daysRemaining}d`,
    `TLS certificate served by ${certificateInfo.certificateSource ?? 'internal nginx TLS endpoint'} expires in ${certificateInfo.daysRemaining} days.`,
    status,
    certificateInfo.daysRemaining
  );
};

export const getDashboardRisk = async (): Promise<DashboardRiskResponse> => {
  const [servicesResponse, queuedMessageCount, queuedReceiptCount, redisMetric, storageMetric, certificateMetric] = await Promise.all([
    getDashboardServices(),
    getQueuedMessageCount(),
    getQueuedReceiptCount(),
    buildRedisMemoryMetric(),
    buildStorageGrowthMetric(),
    buildCertificateExpiryMetric()
  ]);

  const totalQueuedItems = queuedMessageCount + queuedReceiptCount;
  const riskHistory = await recordRiskObservation(servicesResponse.generatedAt, servicesResponse.services, totalQueuedItems);

  return {
    generatedAt: new Date().toISOString(),
    metrics: [
      redisMetric,
      storageMetric,
      certificateMetric,
      buildProbeFailureMetric(servicesResponse.services, riskHistory.probeFailureStreaks),
      buildQueueGrowthMetric(totalQueuedItems, riskHistory.queueGrowthSamples)
    ]
  };
};