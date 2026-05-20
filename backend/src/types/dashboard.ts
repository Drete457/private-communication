export type DashboardStatus = 'healthy' | 'degraded' | 'failed' | 'unknown' | 'not_applicable';

export type DashboardSeverity = 'info' | 'warning' | 'error' | 'critical';

export type DashboardAlertStatus = 'firing' | 'pending';

export interface DashboardRiskSignal {
  id: string;
  label: string;
  status: DashboardStatus;
  summary: string;
}

export interface DashboardServiceContainer {
  name: string | null;
  state: string | null;
  health: string | null;
  restartCount: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DashboardProbe {
  path: string;
  status: DashboardStatus;
  latencyMs: number | null;
  lastCheckedAt: string | null;
  httpStatus: number | null;
}

export interface DashboardService {
  id: string;
  label: string;
  kind: 'runtime' | 'container' | 'probe';
  status: DashboardStatus;
  summary: string;
  container: DashboardServiceContainer | null;
  probe: DashboardProbe | null;
  lastFailureAt: string | null;
  source: string;
}

export interface DashboardAlert {
  id: string;
  status: DashboardAlertStatus;
  severity: DashboardSeverity;
  source: string;
  title: string;
  summary: string;
  startedAt: string;
  serviceId: string | null;
}

export interface DashboardEvent {
  id: string;
  severity: DashboardSeverity;
  source: string;
  category: 'runtime' | 'logs';
  serviceId: string | null;
  occurredAt: string;
  title: string;
  summary: string;
  excerpt: string | null;
}

export interface DashboardSummaryResponse {
  environment: string;
  overallStatus: DashboardStatus;
  generatedAt: string;
  lastCollectionAt: string;
  lastSuccessfulRefreshAt: string | null;
  stale: boolean;
  refreshIntervalMs: number;
  firingAlerts: number;
  pendingAlerts: number;
  topAlerts: string[];
  serviceCounts: {
    total: number;
    healthy: number;
    degraded: number;
    failed: number;
    unknown: number;
    notApplicable: number;
  };
  riskSignals: DashboardRiskSignal[];
}

export interface DashboardServicesResponse {
  generatedAt: string;
  services: DashboardService[];
}

export interface DashboardAlertsResponse {
  generatedAt: string;
  provider: 'internal' | 'none';
  firingCount: number;
  pendingCount: number;
  alerts: DashboardAlert[];
}

export interface DashboardSystemResponse {
  generatedAt: string;
  host: {
    cpuPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    memoryPercent: number | null;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
    diskPercent: number | null;
    loadAverage1m: number | null;
    temperatureC: number | null;
  };
}

export interface DashboardApplicationMetric {
  id: string;
  label: string;
  displayValue: string;
  numericValue: number | null;
  summary: string;
  status: DashboardStatus | null;
}

export interface DashboardApplicationResponse {
  generatedAt: string;
  windowMinutes: number;
  metrics: DashboardApplicationMetric[];
}

export interface DashboardRiskMetric {
  id: string;
  label: string;
  displayValue: string;
  numericValue: number | null;
  summary: string;
  status: DashboardStatus | null;
}

export interface DashboardRiskResponse {
  generatedAt: string;
  metrics: DashboardRiskMetric[];
}

export interface DashboardEventsResponse {
  generatedAt: string;
  events: DashboardEvent[];
}