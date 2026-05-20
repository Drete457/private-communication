import { request as httpRequest } from 'http';

import { logger } from '../utils/logger';

import { getBasicHealthCheck, getReadinessHealthCheck } from './health';

import type {
  DashboardAlert,
  DashboardAlertsResponse,
  DashboardEvent,
  DashboardEventsResponse,
  DashboardProbe,
  DashboardService,
  DashboardServicesResponse,
  DashboardSeverity,
  DashboardStatus,
  DashboardSummaryResponse
} from '../types/dashboard';
import type { ClientRequest, IncomingMessage } from 'http';

const DASHBOARD_REFRESH_INTERVAL_MS = 5_000;
const DASHBOARD_CACHE_TTL_MS = 2_000;
const DASHBOARD_EVENT_LOOKBACK_SECONDS = 3_600;
const DASHBOARD_LOG_TAIL_LINES = 20;
const DASHBOARD_DOCKER_BASE_URL = new URL('http://docker-socket-proxy:2375');
const DEFAULT_EVENT_LIMIT = 12;
const MAX_EVENT_LIMIT = 50;

type DashboardServiceTarget = {
  id: string;
  label: string;
  composeServices: string[];
  containerNames: string[];
  optional: boolean;
};

type DockerContainerSummary = {
  Id: string;
  Names: string[];
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
};

type DockerContainerInspect = {
  Id: string;
  Name?: string;
  State?: {
    Status?: string;
    Running?: boolean;
    Restarting?: boolean;
    Paused?: boolean;
    Dead?: boolean;
    ExitCode?: number;
    Error?: string;
    StartedAt?: string;
    FinishedAt?: string;
    RestartCount?: number;
    Health?: {
      Status?: string;
    };
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{
      HostIp?: string;
      HostPort?: string;
    }> | null>;
  };
};

type DockerEventRecord = {
  Action?: string;
  Actor?: {
    ID?: string;
    Attributes?: Record<string, string>;
  };
  Type?: string;
  time?: number;
  timeNano?: number;
};

type MatchedContainer = {
  target: DashboardServiceTarget;
  summary: DockerContainerSummary | null;
  inspect: DockerContainerInspect | null;
};

type DashboardSnapshot = {
  generatedAt: string;
  lastCollectionAt: string;
  dockerReachable: boolean;
  services: DashboardService[];
  alerts: DashboardAlert[];
  events: DashboardEvent[];
};

type ProbeTarget = {
  id: 'health-probe' | 'readiness-probe';
  label: string;
  path: '/health' | '/health/ready';
};

const SERVICE_TARGETS: DashboardServiceTarget[] = [
  {
    id: 'backend',
    label: 'Backend',
    composeServices: ['app', 'app-dev'],
    containerNames: ['private-comm-app'],
    optional: false
  },
  {
    id: 'nginx',
    label: 'Nginx',
    composeServices: ['nginx', 'nginx-dev'],
    containerNames: ['private-comm-nginx', 'private-comm-nginx-dev'],
    optional: false
  },
  {
    id: 'redis',
    label: 'Redis',
    composeServices: ['redis'],
    containerNames: ['private-comm-redis'],
    optional: false
  },
  {
    id: 'coturn',
    label: 'Coturn',
    composeServices: ['coturn'],
    containerNames: ['private-comm-coturn'],
    optional: true
  },
  {
    id: 'certbot',
    label: 'Certbot',
    composeServices: ['certbot'],
    containerNames: ['private-comm-certbot'],
    optional: true
  }
];

const PROBE_TARGETS: ProbeTarget[] = [
  {
    id: 'health-probe',
    label: 'Health probe',
    path: '/health'
  },
  {
    id: 'readiness-probe',
    label: 'Readiness probe',
    path: '/health/ready'
  }
];

let cachedSnapshot: DashboardSnapshot | null = null;
let cachedSnapshotAt = 0;
let inflightSnapshot: Promise<DashboardSnapshot> | null = null;
let lastSuccessfulCollectionAt: string | null = null;

const cleanContainerName = (name: string): string => name.startsWith('/') ? name.slice(1) : name;

const normalizeTimestamp = (value: string | undefined): string | null => {
  if (!value || value.startsWith('0001-01-01'))
    return null;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};

const stripAnsi = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '');

const sanitizeText = (value: string, maxLength: number): string => {
  const sanitized = stripAnsi(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (sanitized.length <= maxLength)
    return sanitized;

  return `${sanitized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const createIsoTimestamp = (): string => new Date().toISOString();

const createDockerHttpRequest = (path: string, callback: (res: IncomingMessage) => void) => {
  return httpRequest(new URL(path, DASHBOARD_DOCKER_BASE_URL), {
    method: 'GET'
  }, callback);
};

const isRequiredService = (serviceId: string): boolean => {
  const target = SERVICE_TARGETS.find((candidate) => candidate.id === serviceId);
  return target ? !target.optional : false;
};

const isRequiredProbe = (serviceId: string): boolean => PROBE_TARGETS.some((target) => target.id === serviceId);

const detectSeverityFromMessage = (message: string): DashboardSeverity => {
  const normalized = message.toLowerCase();
  if (/(fatal|panic|unhandled|critical)/.test(normalized))
    return 'critical';

  if (/(error|failed|exception|unhealthy|denied)/.test(normalized))
    return 'error';

  if (/(warn|warning|restart|timeout)/.test(normalized))
    return 'warning';

  return 'info';
};

const clampEventLimit = (value: number | undefined): number => {
  if (!value || !Number.isFinite(value))
    return DEFAULT_EVENT_LIMIT;


  return Math.max(1, Math.min(MAX_EVENT_LIMIT, Math.floor(value)));
};

const createMeasuredResult = async <T>(factory: () => Promise<T> | T): Promise<{ result: T; latencyMs: number }> => {
  const startedAt = Date.now();
  const result = await factory();
  return {
    result,
    latencyMs: Math.max(0, Date.now() - startedAt)
  };
};

const formatProbeSummary = (probe: DashboardProbe, fallbackSummary: string): string => {
  const latencySuffix = typeof probe.latencyMs === 'number' ? ` in ${probe.latencyMs} ms` : '';
  if (probe.status === 'healthy')
    return `${fallbackSummary}${latencySuffix}`;

  if (probe.httpStatus)
    return `${fallbackSummary} (HTTP ${probe.httpStatus})${latencySuffix}`;

  return `${fallbackSummary}${latencySuffix}`;
};

const createProbeService = (target: ProbeTarget, probe: DashboardProbe, summary: string): DashboardService => {
  return {
    id: target.id,
    label: target.label,
    kind: 'probe',
    status: probe.status,
    summary,
    container: null,
    probe,
    lastFailureAt: probe.status === 'failed' ? probe.lastCheckedAt : null,
    source: 'backend'
  };
};

const collectProbeServices = async (): Promise<DashboardService[]> => {
  const healthProbeTarget = PROBE_TARGETS.find((target) => target.id === 'health-probe');
  const readinessProbeTarget = PROBE_TARGETS.find((target) => target.id === 'readiness-probe');
  if (!healthProbeTarget || !readinessProbeTarget) {
    throw new Error('Dashboard probe targets are not configured');
  }

  const healthMeasured = await createMeasuredResult(() => getBasicHealthCheck());
  const healthProbe: DashboardProbe = {
    path: '/health',
    status: healthMeasured.result.ok ? 'healthy' : 'failed',
    latencyMs: healthMeasured.latencyMs,
    lastCheckedAt: healthMeasured.result.payload.timestamp,
    httpStatus: healthMeasured.result.httpStatus
  };

  const readinessMeasured = await createMeasuredResult(() => getReadinessHealthCheck());
  const readinessProbe: DashboardProbe = {
    path: '/health/ready',
    status: readinessMeasured.result.ok ? 'healthy' : 'failed',
    latencyMs: readinessMeasured.latencyMs,
    lastCheckedAt: readinessMeasured.result.payload.timestamp,
    httpStatus: readinessMeasured.result.httpStatus
  };

  return [
    createProbeService(
      healthProbeTarget,
      healthProbe,
      formatProbeSummary(healthProbe, healthMeasured.result.ok ? 'Probe responded healthy' : 'Probe returned unhealthy')
    ),
    createProbeService(
      readinessProbeTarget,
      readinessProbe,
      formatProbeSummary(readinessProbe, readinessMeasured.result.ok ? 'Readiness probe returned ready' : 'Readiness probe returned unhealthy')
    )
  ];
};

const buildAlertFromService = (service: DashboardService, severity: DashboardSeverity, title: string): DashboardAlert => {
  return {
    id: `alert:${service.id}:${service.status}`,
    status: 'firing',
    severity,
    source: service.source,
    title,
    summary: service.summary,
    startedAt: service.lastFailureAt ?? service.probe?.lastCheckedAt ?? service.container?.finishedAt ?? service.container?.startedAt ?? createIsoTimestamp(),
    serviceId: service.id
  };
};

const buildInternalAlerts = (services: DashboardService[]): DashboardAlert[] => {
  const dockerService = services.find((service) => service.id === 'docker');
  if (dockerService?.status === 'failed') {
    return [buildAlertFromService(dockerService, 'critical', 'Docker runtime unavailable')];
  }

  return services.flatMap((service) => {
    if (service.id === 'docker' || service.status === 'healthy' || service.status === 'not_applicable' || service.status === 'unknown')
      return [];

    if (service.kind === 'probe') {
      const severity: DashboardSeverity = service.id === 'health-probe' ? 'critical' : 'error';
      return [buildAlertFromService(service, severity, `${service.label} failed`)];
    }

    if (service.status === 'failed') {
      return [buildAlertFromService(
        service,
        isRequiredService(service.id) ? 'critical' : 'warning',
        `${service.label} failed`
      )];
    }

    return [buildAlertFromService(service, 'warning', `${service.label} degraded`)];
  });
};

const parseDockerLogTimestamp = (line: string): { occurredAt: string | null; message: string } => {
  const trimmedLine = line.trim();
  if (trimmedLine.length === 0)
    return { occurredAt: null, message: '' };

  const firstSpaceIndex = trimmedLine.indexOf(' ');
  if (firstSpaceIndex === -1)
    return { occurredAt: null, message: trimmedLine };


  const candidateTimestamp = trimmedLine.slice(0, firstSpaceIndex);
  const parsedTimestamp = normalizeTimestamp(candidateTimestamp);
  if (!parsedTimestamp)
    return { occurredAt: null, message: trimmedLine };

  return {
    occurredAt: parsedTimestamp,
    message: trimmedLine.slice(firstSpaceIndex + 1).trim()
  };
};

const decodeDockerLogBuffer = (buffer: Buffer): string => {
  if (buffer.length < 8)
    return buffer.toString('utf8');

  const firstFrameLooksValid = (buffer[0] === 0 || buffer[0] === 1 || buffer[0] === 2)
    && buffer[1] === 0
    && buffer[2] === 0
    && buffer[3] === 0;

  if (!firstFrameLooksValid)
    return buffer.toString('utf8');

  let offset = 0;
  let output = '';
  while (offset + 8 <= buffer.length) {
    const payloadLength = buffer.readUInt32BE(offset + 4);
    const frameStart = offset + 8;
    const frameEnd = frameStart + payloadLength;

    if (frameEnd > buffer.length)
      return buffer.toString('utf8');

    output += buffer.subarray(frameStart, frameEnd).toString('utf8');
    offset = frameEnd;
  }

  if (offset < buffer.length)
    output += buffer.subarray(offset).toString('utf8');

  return output;
};

const dockerGet = async (path: string): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    let req: ClientRequest;
    try {
      req = createDockerHttpRequest(path, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer | string) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });

        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const statusCode = res.statusCode ?? 500;
          if (statusCode >= 200 && statusCode < 300) {
            resolve(body);
            return;
          }

          reject(new Error(`Docker API ${path} failed with ${statusCode}: ${sanitizeText(body.toString('utf8'), 220)}`));
        });
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error('Docker request creation failed'));
      return;
    }

    req.setTimeout(4_000, () => {
      req.destroy(new Error(`Docker API ${path} timed out`));
    });
    req.on('error', reject);
    req.end();
  });
};

const dockerGetJson = async <T>(path: string): Promise<T> => {
  const buffer = await dockerGet(path);
  return JSON.parse(buffer.toString('utf8')) as T;
};

const listContainers = async (): Promise<DockerContainerSummary[]> => {
  return dockerGetJson<DockerContainerSummary[]>('/containers/json?all=1');
};

const inspectContainer = async (containerId: string): Promise<DockerContainerInspect> => {
  return dockerGetJson<DockerContainerInspect>(`/containers/${encodeURIComponent(containerId)}/json`);
};

const listRecentContainerEvents = async (containerIds: string[]): Promise<DockerEventRecord[]> => {
  if (containerIds.length === 0) {
    return [];
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const filters = encodeURIComponent(JSON.stringify({
    container: containerIds,
    type: ['container']
  }));
  const buffer = await dockerGet(`/events?since=${nowSeconds - DASHBOARD_EVENT_LOOKBACK_SECONDS}&until=${nowSeconds}&filters=${filters}`);
  const body = buffer.toString('utf8').trim();
  if (body.length === 0)
    return [];

  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as DockerEventRecord)
    .filter((eventRecord) => eventRecord.Type === 'container');
};

const getContainerLogs = async (containerId: string): Promise<string> => {
  const buffer = await dockerGet(`/containers/${encodeURIComponent(containerId)}/logs?stdout=1&stderr=1&tail=${DASHBOARD_LOG_TAIL_LINES}&timestamps=1`);
  return decodeDockerLogBuffer(buffer);
};

const matchTargetContainer = (target: DashboardServiceTarget, containers: DockerContainerSummary[]): DockerContainerSummary | null => {
  const matchingContainers = containers.filter((container) => {
    const composeService = container.Labels?.['com.docker.compose.service'];
    if (composeService && target.composeServices.includes(composeService))
      return true;

    return container.Names.some((name) => target.containerNames.includes(cleanContainerName(name)));
  });

  if (matchingContainers.length === 0)
    return null;

  matchingContainers.sort((left, right) => {
    const leftRunning = left.State === 'running' ? 1 : 0;
    const rightRunning = right.State === 'running' ? 1 : 0;
    return rightRunning - leftRunning;
  });

  return matchingContainers[0] ?? null;
};

const resolveServiceStatus = (inspect: DockerContainerInspect | null): DashboardStatus => {
  const state = inspect?.State?.Status;
  const health = inspect?.State?.Health?.Status;
  if (!inspect)
    return 'unknown';

  if (state !== 'running')
    return 'failed';

  if (health === 'unhealthy')
    return 'failed';

  if (health === 'starting' || inspect.State?.Restarting || inspect.State?.Paused)
    return 'degraded';

  return 'healthy';
};

const resolveServiceSummary = (target: DashboardServiceTarget, inspect: DockerContainerInspect | null): string => {
  if (!inspect)
    return target.optional ? 'Service not part of this environment' : 'Container not found';

  const state = inspect.State?.Status ?? 'unknown';
  const health = inspect.State?.Health?.Status;
  if (state !== 'running') {
    const errorSuffix = inspect.State?.Error ? `: ${sanitizeText(inspect.State.Error, 120)}` : '';
    return `Container ${state}${errorSuffix}`;
  }
  if (health === 'unhealthy')
    return 'Running but healthcheck failed';

  if (health === 'starting')
    return 'Running, healthcheck still starting';

  if (health === 'healthy')
    return 'Running and healthy';

  return 'Running';
};

const hasPublishedHostPorts = (inspect: DockerContainerInspect | null): boolean => {
  const portBindings = inspect?.NetworkSettings?.Ports;
  if (!portBindings)
    return false;

  return Object.values(portBindings).some((bindings) => {
    if (!Array.isArray(bindings))
      return false;

    return bindings.some((binding) => typeof binding.HostPort === 'string' && binding.HostPort.length > 0);
  });
};

const shouldSuppressContainerLogSignal = (matchedContainer: MatchedContainer, message: string): boolean => {
  if (matchedContainer.target.id !== 'redis')
    return false;

  if (!/Redis does not require authentication and is not protected by network restrictions/i.test(message))
    return false;

  return !hasPublishedHostPorts(matchedContainer.inspect);
};

const buildDashboardService = (matchedContainer: MatchedContainer): DashboardService => {
  const { target, summary, inspect } = matchedContainer;
  if (!summary || !inspect) {
    return {
      id: target.id,
      label: target.label,
      kind: 'container',
      status: target.optional ? 'not_applicable' : 'failed',
      summary: resolveServiceSummary(target, inspect),
      container: null,
      probe: null,
      lastFailureAt: null,
      source: 'docker'
    };
  }

  const state = inspect.State?.Status ?? summary.State ?? null;
  const startedAt = normalizeTimestamp(inspect.State?.StartedAt);
  const finishedAt = normalizeTimestamp(inspect.State?.FinishedAt);
  const status = resolveServiceStatus(inspect);
  const lastFailureAt = status === 'failed' ? finishedAt ?? startedAt : null;

  return {
    id: target.id,
    label: target.label,
    kind: 'container',
    status,
    summary: resolveServiceSummary(target, inspect),
    container: {
      name: cleanContainerName(inspect.Name ?? summary.Names[0] ?? target.label),
      state,
      health: inspect.State?.Health?.Status ?? null,
      restartCount: typeof inspect.State?.RestartCount === 'number' ? inspect.State.RestartCount : null,
      startedAt,
      finishedAt
    },
    probe: null,
    lastFailureAt,
    source: 'docker'
  };
};

const buildFallbackServices = (occurredAt: string, errorMessage: string): DashboardService[] => {
  const fallbackServices: DashboardService[] = [
    {
      id: 'docker',
      label: 'Docker runtime',
      kind: 'runtime',
      status: 'failed',
      summary: errorMessage,
      container: null,
      probe: null,
      lastFailureAt: occurredAt,
      source: 'docker'
    }
  ];

  for (const target of SERVICE_TARGETS) {
    fallbackServices.push({
      id: target.id,
      label: target.label,
      kind: 'container',
      status: 'unknown',
      summary: 'Docker runtime unavailable',
      container: null,
      probe: null,
      lastFailureAt: null,
      source: 'docker'
    });
  }

  for (const target of PROBE_TARGETS) {
    fallbackServices.push({
      id: target.id,
      label: target.label,
      kind: 'probe',
      status: 'unknown',
      summary: 'Probe status unavailable',
      container: null,
      probe: {
        path: target.path,
        status: 'unknown',
        latencyMs: null,
        lastCheckedAt: occurredAt,
        httpStatus: null
      },
      lastFailureAt: null,
      source: 'backend'
    });
  }

  return fallbackServices;
};

const buildRuntimeEvent = (
  id: string,
  severity: DashboardSeverity,
  serviceId: string | null,
  occurredAt: string,
  title: string,
  summary: string,
  excerpt: string | null,
  category: 'runtime' | 'logs'
): DashboardEvent => ({
  id,
  severity,
  source: 'docker',
  category,
  serviceId,
  occurredAt,
  title,
  summary,
  excerpt
});

const buildDockerEvents = (
  dockerEvents: DockerEventRecord[],
  matchedContainersById: Map<string, MatchedContainer>
): DashboardEvent[] => {
  return dockerEvents
    .map((eventRecord) => {
      const containerId = eventRecord.Actor?.ID ?? null;
      if (!containerId)
        return null;


      const matchedContainer = matchedContainersById.get(containerId);
      if (!matchedContainer)
        return null;


      const action = eventRecord.Action ?? 'unknown';
      const eventTime = typeof eventRecord.time === 'number'
        ? new Date(eventRecord.time * 1_000).toISOString()
        : new Date().toISOString();
      const attributes = eventRecord.Actor?.Attributes ?? {};
      const label = matchedContainer.target.label;
      const normalizedAction = action.toLowerCase();

      if (normalizedAction === 'start') {
        return buildRuntimeEvent(
          `docker:${matchedContainer.target.id}:start:${eventTime}`,
          'info',
          matchedContainer.target.id,
          eventTime,
          `${label} container started`,
          'Container entered the running state',
          null,
          'runtime'
        );
      }

      if (normalizedAction === 'restart') {
        return buildRuntimeEvent(
          `docker:${matchedContainer.target.id}:restart:${eventTime}`,
          'warning',
          matchedContainer.target.id,
          eventTime,
          `${label} container restarted`,
          'Container restarted recently',
          null,
          'runtime'
        );
      }

      if (normalizedAction === 'die') {
        const exitCode = attributes['exitCode'];
        const exitSummary = typeof exitCode === 'string' ? `Exited with code ${exitCode}` : 'Container exited';
        return buildRuntimeEvent(
          `docker:${matchedContainer.target.id}:die:${eventTime}`,
          'error',
          matchedContainer.target.id,
          eventTime,
          `${label} container exited`,
          exitSummary,
          attributes['signal'] ? `signal=${attributes['signal']}` : null,
          'runtime'
        );
      }

      if (normalizedAction.startsWith('health_status:')) {
        const healthStatus = normalizedAction.slice('health_status:'.length).trim();
        const severity: DashboardSeverity = healthStatus === 'healthy' ? 'info' : healthStatus === 'starting' ? 'warning' : 'error';
        return buildRuntimeEvent(
          `docker:${matchedContainer.target.id}:health:${healthStatus}:${eventTime}`,
          severity,
          matchedContainer.target.id,
          eventTime,
          `${label} health status changed`,
          `Health status is now ${healthStatus}`,
          null,
          'runtime'
        );
      }

      return null;
    })
    .filter((event): event is DashboardEvent => event !== null);
};

const buildLogEvents = async (matchedContainers: MatchedContainer[]): Promise<DashboardEvent[]> => {
  const logEvents = await Promise.all(matchedContainers.map(async (matchedContainer) => {
    const containerId = matchedContainer.inspect?.Id;
    if (!containerId)
      return [] as DashboardEvent[];

    try {
      const logs = await getContainerLogs(containerId);
      return logs
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line, index) => ({ line, index }))
        .reverse()
        .map(({ line, index }) => {
          const parsedLine = parseDockerLogTimestamp(line);
          const sanitizedMessage = sanitizeText(parsedLine.message, 220);
          if (sanitizedMessage.length === 0 || !/(fatal|panic|critical|error|fail|exception|warn|timeout|refused|denied|disconnect)/i.test(sanitizedMessage))
            return null;


          if (shouldSuppressContainerLogSignal(matchedContainer, sanitizedMessage))
            return null;

          const occurredAt = parsedLine.occurredAt ?? matchedContainer.inspect?.State?.StartedAt ?? new Date().toISOString();
          return buildRuntimeEvent(
            `docker:${matchedContainer.target.id}:log:${Date.parse(occurredAt)}:${index}`,
            detectSeverityFromMessage(sanitizedMessage),
            matchedContainer.target.id,
            normalizeTimestamp(occurredAt) ?? new Date().toISOString(),
            `${matchedContainer.target.label} log signal`,
            sanitizedMessage,
            sanitizedMessage,
            'logs'
          );
        })
        .filter((event): event is DashboardEvent => event !== null)
        .slice(0, 2);
    } catch (error) {
      logger.warn('Dashboard log collection failed', {
        serviceId: matchedContainer.target.id,
        error: getErrorMessage(error)
      });
      return [] as DashboardEvent[];
    }
  }));

  return logEvents.flat();
};

const buildSynthesizedServiceEvents = (services: DashboardService[]): DashboardEvent[] => {
  return services
    .filter((service) => service.id !== 'docker')
    .flatMap((service) => {
      if (service.status === 'failed' && service.container?.state && service.container.state !== 'running') {
        const occurredAt = service.lastFailureAt ?? service.container.finishedAt ?? new Date().toISOString();
        return [buildRuntimeEvent(
          `service:${service.id}:state:${occurredAt}`,
          'error',
          service.id,
          occurredAt,
          `${service.label} is down`,
          service.summary,
          service.container.name,
          'runtime'
        )];
      }

      if (service.status === 'failed' && service.container?.health === 'unhealthy') {
        return [buildRuntimeEvent(
          `service:${service.id}:health:${service.container.health}:${service.container.startedAt ?? new Date().toISOString()}`,
          'error',
          service.id,
          service.container.startedAt ?? new Date().toISOString(),
          `${service.label} healthcheck failed`,
          service.summary,
          service.container.name,
          'runtime'
        )];
      }

      return [];
    });
};

const dedupeAndSortEvents = (events: DashboardEvent[]): DashboardEvent[] => {
  const uniqueEvents = new Map<string, DashboardEvent>();
  for (const event of events) {
    if (!uniqueEvents.has(event.id))
      uniqueEvents.set(event.id, event);
  }

  return [...uniqueEvents.values()].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
};

const collectDashboardSnapshot = async (): Promise<DashboardSnapshot> => {
  const collectedAt = new Date().toISOString();
  const probeServices = await collectProbeServices();

  try {
    const containers = await listContainers();
    const matchedContainers = await Promise.all(SERVICE_TARGETS.map(async (target) => {
      const summary = matchTargetContainer(target, containers);
      const inspect = summary ? await inspectContainer(summary.Id) : null;
      return {
        target,
        summary,
        inspect
      } satisfies MatchedContainer;
    }));

    const services = [
      {
        id: 'docker',
        label: 'Docker runtime',
        kind: 'runtime',
        status: 'healthy',
        summary: 'Docker Engine reachable',
        container: null,
        probe: null,
        lastFailureAt: null,
        source: 'docker'
      } satisfies DashboardService,
      ...matchedContainers.map(buildDashboardService),
      ...probeServices
    ];

    const matchedContainersById = new Map<string, MatchedContainer>();
    for (const matchedContainer of matchedContainers) {
      if (matchedContainer.inspect?.Id)
        matchedContainersById.set(matchedContainer.inspect.Id, matchedContainer);
    }

    const dockerEvents = buildDockerEvents(
      await listRecentContainerEvents([...matchedContainersById.keys()]),
      matchedContainersById
    );
    const logEvents = await buildLogEvents(matchedContainers);
    const synthesizedEvents = buildSynthesizedServiceEvents(services);
    const alerts = buildInternalAlerts(services);

    lastSuccessfulCollectionAt = collectedAt;
    return {
      generatedAt: collectedAt,
      lastCollectionAt: collectedAt,
      dockerReachable: true,
      services,
      alerts,
      events: dedupeAndSortEvents([...dockerEvents, ...logEvents, ...synthesizedEvents])
    };
  } catch (error) {
    const errorMessage = sanitizeText(getErrorMessage(error), 220);
    logger.warn('Dashboard Docker collection failed', { error: errorMessage });
    const services = buildFallbackServices(collectedAt, errorMessage);
    const alerts = buildInternalAlerts(services);
    lastSuccessfulCollectionAt = collectedAt;

    return {
      generatedAt: collectedAt,
      lastCollectionAt: collectedAt,
      dockerReachable: false,
      services,
      alerts,
      events: [buildRuntimeEvent(
        `docker:runtime:unavailable:${collectedAt}`,
        'error',
        'docker',
        collectedAt,
        'Docker runtime unavailable',
        errorMessage,
        null,
        'runtime'
      )]
    };
  }
};

const getDashboardSnapshot = async (): Promise<DashboardSnapshot> => {
  const now = Date.now();
  if (cachedSnapshot && now - cachedSnapshotAt < DASHBOARD_CACHE_TTL_MS)
    return cachedSnapshot;

  if (inflightSnapshot)
    return inflightSnapshot;

  inflightSnapshot = collectDashboardSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cachedSnapshotAt = Date.now();
      return snapshot;
    })
    .finally(() => {
      inflightSnapshot = null;
    });

  return inflightSnapshot;
};

const getOverallStatus = (services: DashboardService[]): DashboardStatus => {
  const dockerService = services.find((service) => service.id === 'docker');
  if (dockerService?.status === 'failed')
    return 'failed';

  const probeServices = services.filter((service) => isRequiredProbe(service.id));
  if (probeServices.some((service) => service.status === 'failed'))
    return 'failed';

  if (probeServices.some((service) => service.status === 'unknown'))
    return 'unknown';

  const serviceFailures = services.filter((service) => service.id !== 'docker');
  if (serviceFailures.some((service) => isRequiredService(service.id) && service.status === 'failed'))
    return 'failed';

  if (serviceFailures.some((service) => service.status === 'degraded' || (!isRequiredService(service.id) && service.status === 'failed')))
    return 'degraded';

  if (serviceFailures.some((service) => service.status === 'unknown'))
    return 'unknown';

  return 'healthy';
};

export const getDashboardSummary = async (): Promise<DashboardSummaryResponse> => {
  const snapshot = await getDashboardSnapshot();
  const lastSuccessfulTimestamp = lastSuccessfulCollectionAt;
  const stale = !lastSuccessfulTimestamp
    || (Date.now() - Date.parse(lastSuccessfulTimestamp)) > DASHBOARD_REFRESH_INTERVAL_MS * 2;
  const firingAlerts = snapshot.alerts.filter((alert) => alert.status === 'firing');
  const pendingAlerts = snapshot.alerts.filter((alert) => alert.status === 'pending');

  const counts = snapshot.services.reduce((totals, service) => {
    totals.total += 1;

    if (service.status === 'healthy') {
      totals.healthy += 1;
    } else if (service.status === 'degraded') {
      totals.degraded += 1;
    } else if (service.status === 'failed') {
      totals.failed += 1;
    } else if (service.status === 'unknown') {
      totals.unknown += 1;
    } else {
      totals.notApplicable += 1;
    }

    return totals;
  }, {
    total: 0,
    healthy: 0,
    degraded: 0,
    failed: 0,
    unknown: 0,
    notApplicable: 0
  });

  return {
    environment: process.env['NODE_ENV'] ?? 'development',
    overallStatus: getOverallStatus(snapshot.services),
    generatedAt: snapshot.generatedAt,
    lastCollectionAt: snapshot.lastCollectionAt,
    lastSuccessfulRefreshAt: lastSuccessfulTimestamp,
    stale,
    refreshIntervalMs: DASHBOARD_REFRESH_INTERVAL_MS,
    firingAlerts: firingAlerts.length,
    pendingAlerts: pendingAlerts.length,
    topAlerts: firingAlerts.slice(0, 3).map((alert) => alert.title),
    serviceCounts: counts,
    riskSignals: []
  };
};

export const getDashboardServices = async (): Promise<DashboardServicesResponse> => {
  const snapshot = await getDashboardSnapshot();
  return {
    generatedAt: snapshot.generatedAt,
    services: snapshot.services
  };
};

export const getDashboardAlerts = async (): Promise<DashboardAlertsResponse> => {
  const snapshot = await getDashboardSnapshot();
  const firingAlerts = snapshot.alerts.filter((alert) => alert.status === 'firing');
  const pendingAlerts = snapshot.alerts.filter((alert) => alert.status === 'pending');

  return {
    generatedAt: snapshot.generatedAt,
    provider: snapshot.alerts.length > 0 ? 'internal' : 'none',
    firingCount: firingAlerts.length,
    pendingCount: pendingAlerts.length,
    alerts: snapshot.alerts
  };
};

export const getDashboardEvents = async (options?: {
  limit?: number;
  serviceId?: string;
}): Promise<DashboardEventsResponse> => {
  const snapshot = await getDashboardSnapshot();
  const filteredEvents = snapshot.events.filter((event) => {
    if (options?.serviceId && event.serviceId !== options.serviceId)
      return false;

    return true;
  });

  return {
    generatedAt: snapshot.generatedAt,
    events: filteredEvents.slice(0, clampEventLimit(options?.limit))
  };
};