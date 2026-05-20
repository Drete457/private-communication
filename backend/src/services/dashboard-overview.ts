import { getDashboardApplication } from './application';
import {
  getDashboardAlerts as getRuntimeDashboardAlerts,
  getDashboardSummary as getRuntimeDashboardSummary
} from './dashboard';
import { getDashboardRisk } from './risk';

import type {
  DashboardAlert,
  DashboardAlertsResponse,
  DashboardApplicationMetric,
  DashboardRiskMetric,
  DashboardRiskSignal,
  DashboardSeverity,
  DashboardStatus,
  DashboardSummaryResponse
} from '../types/dashboard';

type SignalSource = 'application' | 'risk';
type SignalMetric = DashboardApplicationMetric | DashboardRiskMetric;

const getStatusRank = (status: DashboardStatus): number => {
  switch (status) {
    case 'failed':
      return 4;
    case 'degraded':
      return 3;
    case 'unknown':
      return 2;
    case 'healthy':
      return 1;
    case 'not_applicable':
      return 0;
  }
};

const getSeverityRank = (severity: DashboardSeverity): number => {
  switch (severity) {
    case 'critical':
      return 4;
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
  }
};

const isActiveSignalMetric = (metric: SignalMetric): metric is SignalMetric & { status: DashboardStatus } => {
  return metric.status !== null && metric.status !== 'healthy' && metric.status !== 'not_applicable';
};

const getWorstStatus = (statuses: DashboardStatus[]): DashboardStatus => {
  return statuses.reduce((worstStatus, status) => {
    return getStatusRank(status) > getStatusRank(worstStatus) ? status : worstStatus;
  }, 'healthy' satisfies DashboardStatus);
};

const getSeverityForSignal = (source: SignalSource, status: DashboardStatus): DashboardSeverity => {
  if (status === 'failed') 
    return source === 'risk' ? 'critical' : 'error';

  if (status === 'degraded') 
    return 'warning';

  return 'warning';
};

const createSignalAlert = (source: SignalSource, metric: SignalMetric & { status: DashboardStatus }, generatedAt: string): DashboardAlert => {
  return {
    id: `alert:${source}:${metric.id}:${metric.status}`,
    status: 'firing',
    severity: getSeverityForSignal(source, metric.status),
    source,
    title: `${metric.label} ${metric.status}`,
    summary: metric.summary,
    startedAt: generatedAt,
    serviceId: null
  };
};

const createRiskSignal = (source: SignalSource, metric: SignalMetric & { status: DashboardStatus }): DashboardRiskSignal => {
  return {
    id: `${source}:${metric.id}`,
    label: `${source === 'application' ? 'Application' : 'Risk'}: ${metric.label}`,
    status: metric.status,
    summary: metric.summary
  };
};

const sortAlerts = (alerts: DashboardAlert[]): DashboardAlert[] => {
  return [...alerts].sort((left, right) => {
    const severityDelta = getSeverityRank(right.severity) - getSeverityRank(left.severity);
    if (severityDelta !== 0) 
      return severityDelta;

    return Date.parse(right.startedAt) - Date.parse(left.startedAt);
  });
};

const getSignalData = async (): Promise<{
  generatedAt: string;
  statuses: DashboardStatus[];
  alerts: DashboardAlert[];
  riskSignals: DashboardRiskSignal[];
}> => {
  const [application, risk] = await Promise.all([
    getDashboardApplication(),
    getDashboardRisk()
  ]);

  const applicationMetrics = application.metrics.filter(isActiveSignalMetric);
  const riskMetrics = risk.metrics.filter(isActiveSignalMetric);
  const applicationAlerts = applicationMetrics.map((metric) => createSignalAlert('application', metric, application.generatedAt));
  const riskAlerts = riskMetrics.map((metric) => createSignalAlert('risk', metric, risk.generatedAt));

  return {
    generatedAt: new Date().toISOString(),
    statuses: [...applicationMetrics, ...riskMetrics].map((metric) => metric.status),
    alerts: sortAlerts([...applicationAlerts, ...riskAlerts]),
    riskSignals: [
      ...applicationMetrics.map((metric) => createRiskSignal('application', metric)),
      ...riskMetrics.map((metric) => createRiskSignal('risk', metric))
    ]
  };
};

export const getDashboardSummary = async (): Promise<DashboardSummaryResponse> => {
  const [runtimeSummary, runtimeAlerts, signalData] = await Promise.all([
    getRuntimeDashboardSummary(),
    getRuntimeDashboardAlerts(),
    getSignalData()
  ]);
  const alerts = sortAlerts([...runtimeAlerts.alerts, ...signalData.alerts]);
  const firingAlerts = alerts.filter((alert) => alert.status === 'firing');
  const pendingAlerts = alerts.filter((alert) => alert.status === 'pending');

  return {
    ...runtimeSummary,
    generatedAt: signalData.generatedAt,
    overallStatus: getWorstStatus([runtimeSummary.overallStatus, ...signalData.statuses]),
    firingAlerts: firingAlerts.length,
    pendingAlerts: pendingAlerts.length,
    topAlerts: firingAlerts.slice(0, 3).map((alert) => alert.title),
    riskSignals: [...runtimeSummary.riskSignals, ...signalData.riskSignals]
  };
};

export const getDashboardAlerts = async (): Promise<DashboardAlertsResponse> => {
  const [runtimeAlerts, signalData] = await Promise.all([
    getRuntimeDashboardAlerts(),
    getSignalData()
  ]);
  const alerts = sortAlerts([...runtimeAlerts.alerts, ...signalData.alerts]);
  const firingAlerts = alerts.filter((alert) => alert.status === 'firing');
  const pendingAlerts = alerts.filter((alert) => alert.status === 'pending');

  return {
    generatedAt: signalData.generatedAt,
    provider: alerts.length > 0 ? 'internal' : 'none',
    firingCount: firingAlerts.length,
    pendingCount: pendingAlerts.length,
    alerts
  };
};