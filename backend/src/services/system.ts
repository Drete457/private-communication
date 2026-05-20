import { statfs } from 'fs/promises';
import os from 'os';

import { logger } from '../utils/logger';

import type { DashboardSystemResponse } from '../types/dashboard';

const DASHBOARD_SYSTEM_DISK_PATH = '/';
const DASHBOARD_CPU_SAMPLE_WINDOW_MS = 200;

type CpuSnapshot = {
  idle: number;
  total: number;
};

let previousCpuSnapshot: CpuSnapshot | null = null;
let diskMetricsFailureLogged = false;

const delay = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const clampPercent = (value: number): number => {
  return Math.max(0, Math.min(100, value));
};

const getCpuSnapshot = (): CpuSnapshot => {
  const cpuTimes = os.cpus().reduce((totals, cpu) => {
    totals.idle += cpu.times.idle;
    totals.total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    return totals;
  }, {
    idle: 0,
    total: 0
  });

  return cpuTimes;
};

const calculateCpuPercent = (previous: CpuSnapshot, current: CpuSnapshot): number | null => {
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  if (totalDelta <= 0) {
    return null;
  }

  return clampPercent((1 - idleDelta / totalDelta) * 100);
};

const sampleCpuPercent = async (): Promise<number | null> => {
  const currentSnapshot = getCpuSnapshot();
  if (!previousCpuSnapshot) {
    previousCpuSnapshot = currentSnapshot;
    await delay(DASHBOARD_CPU_SAMPLE_WINDOW_MS);
    const sampledSnapshot = getCpuSnapshot();
    previousCpuSnapshot = sampledSnapshot;
    return calculateCpuPercent(currentSnapshot, sampledSnapshot);
  }

  const priorSnapshot = previousCpuSnapshot;
  previousCpuSnapshot = currentSnapshot;
  return calculateCpuPercent(priorSnapshot, currentSnapshot);
};

const getMemoryMetrics = (): {
  usedBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
} => {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes) || freeBytes < 0) {
    return {
      usedBytes: null,
      totalBytes: null,
      percent: null
    };
  }

  const usedBytes = Math.max(0, totalBytes - freeBytes);
  return {
    usedBytes,
    totalBytes,
    percent: clampPercent((usedBytes / totalBytes) * 100)
  };
};

const getDiskMetrics = async (): Promise<{
  usedBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
}> => {
  try {
    const stats = await statfs(DASHBOARD_SYSTEM_DISK_PATH);
    const blockSize = stats.bsize;
    const totalBlocks = stats.blocks;
    const freeBlocks = stats.bavail;
    if (!Number.isFinite(blockSize) || !Number.isFinite(totalBlocks) || !Number.isFinite(freeBlocks) || blockSize <= 0 || totalBlocks <= 0 || freeBlocks < 0) {
      return {
        usedBytes: null,
        totalBytes: null,
        percent: null
      };
    }

    const totalBytes = totalBlocks * blockSize;
    const freeBytes = freeBlocks * blockSize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);

    return {
      usedBytes,
      totalBytes,
      percent: clampPercent((usedBytes / totalBytes) * 100)
    };
  } catch (error) {
    if (!diskMetricsFailureLogged) {
      diskMetricsFailureLogged = true;
      logger.warn('Dashboard disk metrics unavailable', {
        path: DASHBOARD_SYSTEM_DISK_PATH,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return {
      usedBytes: null,
      totalBytes: null,
      percent: null
    };
  }
};

export const getDashboardSystem = async (): Promise<DashboardSystemResponse> => {
  const cpuPercent = await sampleCpuPercent();
  const memoryMetrics = getMemoryMetrics();
  const diskMetrics = await getDiskMetrics();
  const loadAverage = os.loadavg();
  const loadAverage1m = Array.isArray(loadAverage) && typeof loadAverage[0] === 'number' && Number.isFinite(loadAverage[0])
    ? loadAverage[0]
    : null;

  return {
    generatedAt: new Date().toISOString(),
    host: {
      cpuPercent,
      memoryUsedBytes: memoryMetrics.usedBytes,
      memoryTotalBytes: memoryMetrics.totalBytes,
      memoryPercent: memoryMetrics.percent,
      diskUsedBytes: diskMetrics.usedBytes,
      diskTotalBytes: diskMetrics.totalBytes,
      diskPercent: diskMetrics.percent,
      loadAverage1m,
      temperatureC: null
    }
  };
};