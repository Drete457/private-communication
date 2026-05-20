const apiBase = (() => {
  const params = new URLSearchParams(window.location.search);
  const queryApiBase = params.get('apiBase');
  if (queryApiBase) {
    return queryApiBase.replace(/\/$/, '');
  }

  if (window.location.protocol.startsWith('http')) {
    return `${window.location.origin}/api/dashboard`;
  }

  return 'http://localhost:8080/api/dashboard';
})();

const serviceOrder = ['docker', 'backend', 'nginx', 'redis', 'health-probe', 'readiness-probe', 'coturn', 'certbot'];
const navGroups = [
  { groupId: 'overview', targetSectionId: 'summary-section' },
  { groupId: 'runtime', targetSectionId: 'services-section' },
  { groupId: 'application', targetSectionId: 'application-section' },
  { groupId: 'events', targetSectionId: 'events-section' }
];
const NAV_SIDE_STORAGE_KEY = 'dashboard-nav-side';
const statusLabels = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  failed: 'Failed',
  unknown: 'Unknown',
  not_applicable: 'Not in this environment'
};
const alertStatusLabels = {
  firing: 'Firing',
  pending: 'Pending'
};
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

const refs = {
  dashboardShell: document.querySelector('.dashboard-shell'),
  navSideToggle: document.querySelector('#nav-side-toggle'),
  navLinks: [...document.querySelectorAll('.board-nav-link')],
  overallStatus: document.querySelector('#overall-status'),
  staleBanner: document.querySelector('#stale-banner'),
  environmentValue: document.querySelector('#environment-value'),
  lastRefreshValue: document.querySelector('#last-refresh-value'),
  lastSuccessValue: document.querySelector('#last-success-value'),
  serviceCountsValue: document.querySelector('#service-counts-value'),
  alertsFiringValue: document.querySelector('#alerts-firing-value'),
  alertsPendingValue: document.querySelector('#alerts-pending-value'),
  alertsTopList: document.querySelector('#alerts-top-list'),
  viewAlertsButton: document.querySelector('#view-alerts-button'),
  serviceGrid: document.querySelector('#service-grid'),
  systemCpuValue: document.querySelector('#system-cpu-value'),
  systemCpuDetail: document.querySelector('#system-cpu-detail'),
  systemMemoryValue: document.querySelector('#system-memory-value'),
  systemMemoryDetail: document.querySelector('#system-memory-detail'),
  systemDiskValue: document.querySelector('#system-disk-value'),
  systemDiskDetail: document.querySelector('#system-disk-detail'),
  systemLoadValue: document.querySelector('#system-load-value'),
  systemLoadDetail: document.querySelector('#system-load-detail'),
  applicationGrid: document.querySelector('#application-grid'),
  riskGrid: document.querySelector('#risk-grid'),
  eventsList: document.querySelector('#events-list'),
  viewEventsButton: document.querySelector('#view-events-button'),
  detailLayer: document.querySelector('#detail-layer'),
  detailBackdrop: document.querySelector('#detail-backdrop'),
  detailDrawer: document.querySelector('#detail-drawer'),
  detailKicker: document.querySelector('#detail-kicker'),
  detailTitle: document.querySelector('#detail-title'),
  detailStatus: document.querySelector('#detail-status'),
  detailSummary: document.querySelector('#detail-summary'),
  detailBody: document.querySelector('#detail-body'),
  detailCloseButton: document.querySelector('#detail-close-button'),
  detailBackButton: document.querySelector('#detail-back-button'),
  errorBanner: document.querySelector('#error-banner'),
  refreshButton: document.querySelector('#refresh-button')
};

const dashboardState = {
  summary: null,
  alerts: null,
  services: null,
  system: null,
  application: null,
  risk: null,
  events: null
};

let refreshTimer = null;
let refreshIntervalMs = 5000;
let hasLoadedAtLeastOnce = false;
let detailBackAction = null;
let detailViewKey = null;
let previousFocusedElement = null;

const getFocusableElements = (container) => [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
  .filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.getClientRects().length > 0);

const escapeHtml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const formatTimestamp = (value) => {
  if (!value)
    return 'n/a';

  const parsedValue = new Date(value);
  if (Number.isNaN(parsedValue.getTime()))
    return 'n/a';

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(parsedValue);
};

const formatPercent = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return 'n/a';


  return `${value.toFixed(1)}%`;
};

const formatBytes = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return 'n/a';


  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let scaledValue = value;
  let unitIndex = 0;

  while (scaledValue >= 1024 && unitIndex < units.length - 1) {
    scaledValue /= 1024;
    unitIndex += 1;
  }

  return `${scaledValue.toFixed(scaledValue >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const buildStatusChip = (status) => {
  if (typeof status !== 'string' || !statusLabels[status])
    return '';


  return `<span class="service-status" data-status="${escapeHtml(status)}">${escapeHtml(statusLabels[status])}</span>`;
};

const buildKeyValueList = (entries, className) => {
  if (!entries.length)
    return `<p class="detail-empty">No extra detail available.</p>`;


  return `
    <ul class="${className}">
      ${entries.map(([label, value]) => `
        <li>
          <span>${escapeHtml(label)}</span>
          <span>${escapeHtml(value)}</span>
        </li>
      `).join('')}
    </ul>
  `;
};

const buildEventQuery = (options = {}) => {
  const params = new URLSearchParams();
  if (typeof options.limit === 'number' && options.limit > 0)
    params.set('limit', String(options.limit));

  if (typeof options.serviceId === 'string' && options.serviceId.length > 0)
    params.set('serviceId', options.serviceId);


  return params.toString();
};

const getServiceById = (serviceId) => {
  const services = Array.isArray(dashboardState.services?.services) ? dashboardState.services.services : [];
  return services.find((service) => service.id === serviceId) || null;
};

const getAlertById = (alertId) => {
  const alerts = Array.isArray(dashboardState.alerts?.alerts) ? dashboardState.alerts.alerts : [];
  return alerts.find((alert) => alert.id === alertId) || null;
};

const getEventById = (eventId) => {
  const events = Array.isArray(dashboardState.events?.events) ? dashboardState.events.events : [];
  return events.find((event) => event.id === eventId) || null;
};

const buildServiceCountsLabel = (serviceCounts) => {
  const total = typeof serviceCounts?.total === 'number'
    ? serviceCounts.total
    : (serviceCounts?.healthy ?? 0) + (serviceCounts?.degraded ?? 0) + (serviceCounts?.failed ?? 0) + (serviceCounts?.unknown ?? 0) + (serviceCounts?.notApplicable ?? 0);

  return [
    `${total} total`,
    `${serviceCounts?.healthy ?? 0} healthy`,
    `${serviceCounts?.degraded ?? 0} degraded`,
    `${serviceCounts?.failed ?? 0} failed`,
    `${serviceCounts?.unknown ?? 0} unknown`,
    `${serviceCounts?.notApplicable ?? 0} not in this environment`
  ].join(' | ');
};

const readStoredNavSide = () => {
  try {
    return window.localStorage.getItem(NAV_SIDE_STORAGE_KEY) === 'right' ? 'right' : 'left';
  } catch {
    return 'left';
  }
};

const applyNavSide = (side) => {
  const normalizedSide = side === 'right' ? 'right' : 'left';
  refs.dashboardShell.dataset.navSide = normalizedSide;
  refs.navSideToggle.textContent = normalizedSide === 'left' ? 'Move right' : 'Move left';
  refs.navSideToggle.setAttribute('aria-pressed', normalizedSide === 'right' ? 'true' : 'false');
};

const toggleNavSide = () => {
  const nextSide = refs.dashboardShell.dataset.navSide === 'right' ? 'left' : 'right';
  applyNavSide(nextSide);

  try {
    window.localStorage.setItem(NAV_SIDE_STORAGE_KEY, nextSide);
  } catch {
    return;
  }
};

const getNavSectionAnchor = (section) => {
  const headingId = section.getAttribute('aria-labelledby');
  if (typeof headingId === 'string' && headingId.length > 0) {
    const heading = document.getElementById(headingId);
    if (heading instanceof HTMLElement)
      return heading;
  }

  return section;
};

const setActiveNavGroup = (activeGroupId) => {
  refs.navLinks.forEach((link) => {
    const isActive = link.dataset.navGroup === activeGroupId;
    link.classList.toggle('is-active', isActive);

    if (isActive)
      link.setAttribute('aria-current', 'location');
    else
      link.removeAttribute('aria-current');

  });
};

const syncActiveNavGroupFromLocation = () => {
  const currentHash = window.location.hash;
  const matchingLink = refs.navLinks.find((link) => link.getAttribute('href') === currentHash)
    ?? refs.navLinks[0]
    ?? null;

  if (!(matchingLink instanceof HTMLElement))
    return;


  const groupId = matchingLink.dataset.navGroup;
  if (typeof groupId === 'string' && groupId.length > 0)
    setActiveNavGroup(groupId);

};

const navSections = navGroups
  .map(({ groupId, targetSectionId }) => {
    const section = document.getElementById(targetSectionId);
    if (!(section instanceof HTMLElement))
      return null;

    return { groupId, section };
  })
  .filter((entry) => entry !== null);

let navScrollSyncFrame = null;

const syncActiveNavGroupFromScroll = () => {
  navScrollSyncFrame = null;

  const [firstSection] = navSections;
  if (!firstSection)
    return;

  const threshold = Math.min(window.innerHeight * 0.3, 220);
  let activeGroupId = firstSection.groupId;

  navSections.forEach(({ groupId, section }) => {
    if (section.getBoundingClientRect().top <= threshold)
      activeGroupId = groupId;
  });

  setActiveNavGroup(activeGroupId);
};

const scheduleNavScrollSync = () => {
  if (navScrollSyncFrame !== null)
    return;

  navScrollSyncFrame = window.requestAnimationFrame(() => {
    syncActiveNavGroupFromScroll();
  });
};

const buildServiceMetaEntries = (service) => {
  const entries = [];
  if (service.container?.name)
    entries.push(['Container', service.container.name]);

  if (service.container?.state)
    entries.push(['State', service.container.state]);

  if (service.container?.health)
    entries.push(['Health', service.container.health]);

  if (typeof service.container?.restartCount === 'number')
    entries.push(['Restarts', String(service.container.restartCount)]);

  if (service.lastFailureAt)
    entries.push(['Last failure', formatTimestamp(service.lastFailureAt)]);

  if (service.probe?.path)
    entries.push(['Path', service.probe.path]);

  if (typeof service.probe?.latencyMs === 'number')
    entries.push(['Latency', `${service.probe.latencyMs} ms`]);

  if (typeof service.probe?.httpStatus === 'number')
    entries.push(['HTTP', String(service.probe.httpStatus)]);

  if (service.probe?.lastCheckedAt)
    entries.push(['Last checked', formatTimestamp(service.probe.lastCheckedAt)]);

  entries.push(['Source', service.source || 'unknown']);

  return entries;
};

const buildServiceMeta = (service) => {
  return buildServiceMetaEntries(service)
    .map(([label, value]) => `<li><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></li>`)
    .join('');
};

const setDetailBackAction = (action, label = 'Back') => {
  detailBackAction = typeof action === 'function' ? action : null;
  refs.detailBackButton.hidden = detailBackAction === null;
  refs.detailBackButton.textContent = label;
};

const openDetailDrawer = () => {
  if (refs.detailLayer.hidden)
    previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  refs.detailLayer.hidden = false;
  document.body.classList.add('detail-open');

  window.requestAnimationFrame(() => {
    const primaryAction = !refs.detailBackButton.hidden ? refs.detailBackButton : refs.detailCloseButton;
    primaryAction.focus();
  });
};

const closeDetailDrawer = () => {
  refs.detailLayer.hidden = true;
  refs.detailBody.innerHTML = '';
  detailViewKey = null;
  setDetailBackAction(null);
  document.body.classList.remove('detail-open');

  if (previousFocusedElement instanceof HTMLElement) {
    previousFocusedElement.focus();
    previousFocusedElement = null;
  }
};

const setDetailContent = ({ key, kicker, title, summary, status, bodyHtml, backAction = null, backLabel = 'Back' }) => {
  detailViewKey = key;
  refs.detailKicker.textContent = kicker;
  refs.detailTitle.textContent = title;
  refs.detailSummary.textContent = summary;

  if (typeof status === 'string' && statusLabels[status]) {
    refs.detailStatus.hidden = false;
    refs.detailStatus.dataset.status = status;
    refs.detailStatus.textContent = statusLabels[status];
  } else {
    refs.detailStatus.hidden = true;
    refs.detailStatus.dataset.status = 'unknown';
    refs.detailStatus.textContent = 'Unknown';
  }

  refs.detailBody.innerHTML = bodyHtml;
  setDetailBackAction(backAction, backLabel);
  openDetailDrawer();
};

const setDetailLoading = ({ key, kicker, title, summary, status, backAction = null, backLabel = 'Back' }) => {
  setDetailContent({
    key,
    kicker,
    title,
    summary,
    status,
    bodyHtml: '<p class="detail-loading">Loading detail…</p>',
    backAction,
    backLabel
  });
};

const renderStaleBanner = (summary) => {
  if (!summary?.stale) {
    refs.staleBanner.hidden = true;
    refs.staleBanner.textContent = '';
    return;
  }

  refs.staleBanner.hidden = false;
  refs.staleBanner.textContent = `Dashboard data is stale. Last successful refresh: ${formatTimestamp(summary.lastSuccessfulRefreshAt)}.`;
};

const renderSummary = (summary) => {
  refs.overallStatus.textContent = summary.stale
    ? `${statusLabels[summary.overallStatus] || 'Unknown'} stale`
    : (statusLabels[summary.overallStatus] || 'Unknown');
  refs.overallStatus.dataset.status = summary.overallStatus || 'unknown';
  refs.environmentValue.textContent = summary.environment || 'unknown';
  refs.lastRefreshValue.textContent = formatTimestamp(summary.lastCollectionAt);
  refs.lastSuccessValue.textContent = formatTimestamp(summary.lastSuccessfulRefreshAt);
  refs.serviceCountsValue.textContent = buildServiceCountsLabel(summary.serviceCounts);
  renderStaleBanner(summary);

  if (typeof summary.refreshIntervalMs === 'number' && summary.refreshIntervalMs > 0) {
    refreshIntervalMs = summary.refreshIntervalMs;
  }
};

const renderAlerts = (summary, payload) => {
  const firingCount = typeof payload?.firingCount === 'number' ? payload.firingCount : summary.firingAlerts;
  const pendingCount = typeof payload?.pendingCount === 'number' ? payload.pendingCount : summary.pendingAlerts;
  const firingAlerts = Array.isArray(payload?.alerts)
    ? payload.alerts.filter((alert) => alert.status === 'firing').slice(0, 3)
    : [];

  refs.alertsFiringValue.textContent = String(firingCount ?? 0);
  refs.alertsPendingValue.textContent = String(pendingCount ?? 0);

  if (!firingAlerts.length) {
    const topAlerts = Array.isArray(summary.topAlerts) ? summary.topAlerts : [];
    refs.alertsTopList.innerHTML = topAlerts.length
      ? topAlerts.map((title) => `<span class="alert-pill" data-severity="warning">${escapeHtml(title)}</span>`).join('')
      : '<span class="alert-empty">No active alerts</span>';
    return;
  }

  refs.alertsTopList.innerHTML = firingAlerts.map((alert) => `
    <button class="alert-pill alert-pill-button" type="button" data-alert-id="${escapeHtml(alert.id)}" data-severity="${escapeHtml(alert.severity)}">${escapeHtml(alert.title)}</button>
  `).join('');
};

const renderServices = (payload) => {
  const getServiceRank = (serviceId) => {
    const rank = serviceOrder.indexOf(serviceId);
    return rank === -1 ? serviceOrder.length : rank;
  };

  const services = [...payload.services].sort((left, right) => {
    return getServiceRank(left.id) - getServiceRank(right.id);
  });

  if (services.length === 0) {
    refs.serviceGrid.innerHTML = '<article class="empty-state"><p>No runtime data available yet.</p></article>';
    return;
  }

  refs.serviceGrid.innerHTML = services.map((service) => {
    const statusLabel = statusLabels[service.status] || 'Unknown';
    return `
      <button class="service-card service-card-button" type="button" role="listitem" data-service-id="${escapeHtml(service.id)}">
        <header>
          <div>
            <p class="summary-label">${escapeHtml(service.kind)}</p>
            <h3>${escapeHtml(service.label)}</h3>
          </div>
          <span class="service-status" data-status="${escapeHtml(service.status)}">${escapeHtml(statusLabel)}</span>
        </header>
        <p class="service-summary">${escapeHtml(service.summary || 'No detail available.')}</p>
        <ul class="service-meta">${buildServiceMeta(service)}</ul>
      </button>
    `;
  }).join('');
};

const renderSystem = (payload) => {
  const host = payload?.host ?? {};
  const memoryHasTotals = typeof host.memoryUsedBytes === 'number' && typeof host.memoryTotalBytes === 'number';
  const diskHasTotals = typeof host.diskUsedBytes === 'number' && typeof host.diskTotalBytes === 'number';

  refs.systemCpuValue.textContent = formatPercent(host.cpuPercent);
  refs.systemCpuDetail.textContent = typeof host.cpuPercent === 'number'
    ? 'Rolling sample from recent collector reads.'
    : 'CPU metrics unavailable in this runtime.';

  refs.systemMemoryValue.textContent = formatPercent(host.memoryPercent);
  refs.systemMemoryDetail.textContent = memoryHasTotals
    ? `${formatBytes(host.memoryUsedBytes)} used of ${formatBytes(host.memoryTotalBytes)}`
    : 'Memory metrics unavailable in this runtime.';

  refs.systemDiskValue.textContent = formatPercent(host.diskPercent);
  refs.systemDiskDetail.textContent = diskHasTotals
    ? `${formatBytes(host.diskUsedBytes)} used of ${formatBytes(host.diskTotalBytes)}`
    : 'Disk metrics unavailable for the configured path.';

  refs.systemLoadValue.textContent = typeof host.loadAverage1m === 'number' && Number.isFinite(host.loadAverage1m)
    ? host.loadAverage1m.toFixed(2)
    : 'n/a';
  refs.systemLoadDetail.textContent = typeof host.temperatureC === 'number' && Number.isFinite(host.temperatureC)
    ? `One-minute host load average. Temperature: ${host.temperatureC.toFixed(1)} C`
    : 'One-minute host load average. Temperature telemetry not wired yet.';
};

const renderApplication = (payload) => {
  const metrics = Array.isArray(payload?.metrics) ? payload.metrics : [];

  if (metrics.length === 0) {
    refs.applicationGrid.innerHTML = '<article class="empty-state"><p>No application health data available yet.</p></article>';
    return;
  }

  refs.applicationGrid.innerHTML = metrics.map((metric) => {
    const status = typeof metric.status === 'string' ? metric.status : null;
    const statusLabel = status ? (statusLabels[status] || 'Unknown') : null;

    return `
      <article class="application-card" role="listitem">
        <header>
          <p class="summary-label">${escapeHtml(metric.label || 'Metric')}</p>
          ${status && statusLabel ? `<span class="service-status" data-status="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>` : ''}
        </header>
        <p class="application-value">${escapeHtml(metric.displayValue || 'n/a')}</p>
        <p class="application-detail">${escapeHtml(metric.summary || 'No detail available.')}</p>
      </article>
    `;
  }).join('');
};

const renderRisk = (payload) => {
  const metrics = Array.isArray(payload?.metrics) ? payload.metrics : [];

  if (metrics.length === 0) {
    refs.riskGrid.innerHTML = '<article class="empty-state"><p>No risk and capacity data available yet.</p></article>';
    return;
  }

  refs.riskGrid.innerHTML = metrics.map((metric) => {
    const status = typeof metric.status === 'string' ? metric.status : null;
    const statusLabel = status ? (statusLabels[status] || 'Unknown') : null;

    return `
      <article class="risk-card" role="listitem">
        <header>
          <p class="summary-label">${escapeHtml(metric.label || 'Metric')}</p>
          ${status && statusLabel ? `<span class="service-status" data-status="${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>` : ''}
        </header>
        <p class="risk-value">${escapeHtml(metric.displayValue || 'n/a')}</p>
        <p class="risk-detail">${escapeHtml(metric.summary || 'No detail available.')}</p>
      </article>
    `;
  }).join('');
};

const renderEvents = (payload) => {
  if (!payload.events.length) {
    refs.eventsList.innerHTML = '<li class="empty-state"><p>No recent critical events.</p></li>';
    return;
  }

  refs.eventsList.innerHTML = payload.events.map((event) => `
    <li>
      <button class="event-item event-item-button" type="button" data-event-id="${escapeHtml(event.id)}">
        <div class="event-topline">
          <h3>${escapeHtml(event.title)}</h3>
          <span class="event-time">${escapeHtml(formatTimestamp(event.occurredAt))}</span>
        </div>
        <p class="event-summary">${escapeHtml(event.summary)}</p>
        ${event.excerpt ? `<p class="event-excerpt">${escapeHtml(event.excerpt)}</p>` : ''}
      </button>
    </li>
  `).join('');
};

const renderError = (message) => {
  refs.errorBanner.hidden = false;
  refs.errorBanner.textContent = message;
};

const clearError = () => {
  refs.errorBanner.hidden = true;
  refs.errorBanner.textContent = '';
};

const renderInitialState = () => {
  refs.alertsFiringValue.textContent = '0';
  refs.alertsPendingValue.textContent = '0';
  refs.alertsTopList.innerHTML = '<span class="alert-empty">Waiting for alert data</span>';
  refs.staleBanner.hidden = true;
  refs.staleBanner.textContent = '';
  refs.serviceGrid.innerHTML = '<article class="empty-state"><p>Waiting for runtime data.</p></article>';
  refs.systemCpuValue.textContent = 'Waiting for data';
  refs.systemCpuDetail.textContent = 'Rolling sample not loaded yet.';
  refs.systemMemoryValue.textContent = 'Waiting for data';
  refs.systemMemoryDetail.textContent = 'Memory metrics not loaded yet.';
  refs.systemDiskValue.textContent = 'Waiting for data';
  refs.systemDiskDetail.textContent = 'Disk metrics not loaded yet.';
  refs.systemLoadValue.textContent = 'Waiting for data';
  refs.systemLoadDetail.textContent = 'One-minute host load average. Temperature metrics optional.';
  refs.applicationGrid.innerHTML = '<article class="empty-state"><p>Waiting for application health data.</p></article>';
  refs.riskGrid.innerHTML = '<article class="empty-state"><p>Waiting for risk and capacity data.</p></article>';
  refs.eventsList.innerHTML = '<li class="empty-state"><p>Waiting for container events.</p></li>';
};

const fetchJson = async (path) => {
  const response = await fetch(`${apiBase}/${path}`, {
    headers: {
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok)
    throw new Error(`Dashboard request failed for ${path}: ${response.status}`);

  return response.json();
};

const fetchEventsForDetail = async (options = {}) => {
  const query = buildEventQuery(options);
  return fetchJson(`events${query ? `?${query}` : ''}`);
};

const buildAlertListMarkup = (alerts) => {
  if (!alerts.length)
    return '<p class="detail-empty">No active alerts in the current snapshot.</p>';

  return `
    <div class="detail-list">
      ${alerts.map((alert) => `
        <button class="detail-list-button" type="button" data-alert-id="${escapeHtml(alert.id)}">
          <div class="detail-item-topline">
            <div>
              <h3 class="detail-item-title">${escapeHtml(alert.title)}</h3>
              <p class="detail-item-meta">${escapeHtml(alertStatusLabels[alert.status] || alert.status)} | ${escapeHtml(alert.severity)} | ${escapeHtml(formatTimestamp(alert.startedAt))}</p>
            </div>
            <span class="alert-pill" data-severity="${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span>
          </div>
          <p class="detail-item-summary">${escapeHtml(alert.summary || 'No detail available.')}</p>
        </button>
      `).join('')}
    </div>
  `;
};

const buildEventsListMarkup = (events) => {
  if (!events.length) {
    return '<p class="detail-empty">No recent high-signal events available.</p>';
  }

  return `
    <div class="detail-list">
      ${events.map((event) => `
        <button class="detail-list-button" type="button" data-event-id="${escapeHtml(event.id)}">
          <div class="detail-item-topline">
            <div>
              <h3 class="detail-item-title">${escapeHtml(event.title)}</h3>
              <p class="detail-item-meta">${escapeHtml(event.category)} | ${escapeHtml(event.source)} | ${escapeHtml(formatTimestamp(event.occurredAt))}</p>
            </div>
            <span class="alert-pill" data-severity="${escapeHtml(event.severity)}">${escapeHtml(event.severity)}</span>
          </div>
          <p class="detail-item-summary">${escapeHtml(event.summary)}</p>
          ${event.excerpt ? `<p class="detail-item-excerpt">${escapeHtml(event.excerpt)}</p>` : ''}
        </button>
      `).join('')}
    </div>
  `;
};

const showAlertsOverview = () => {
  const alerts = Array.isArray(dashboardState.alerts?.alerts) ? dashboardState.alerts.alerts : [];
  const firingCount = dashboardState.alerts?.firingCount ?? 0;
  const pendingCount = dashboardState.alerts?.pendingCount ?? 0;

  setDetailContent({
    key: 'alerts:overview',
    kicker: 'Alert detail',
    title: 'Current alerts',
    summary: `${firingCount} firing and ${pendingCount} pending alerts in the current dashboard snapshot.`,
    status: firingCount > 0 ? 'failed' : pendingCount > 0 ? 'degraded' : 'healthy',
    bodyHtml: buildAlertListMarkup(alerts)
  });
};

const showEventDetail = (eventId, backAction = null, backLabel = 'Back') => {
  const event = getEventById(eventId);
  if (!event) {
    renderError('Requested event detail is no longer available.');
    return;
  }

  const relatedService = event.serviceId ? getServiceById(event.serviceId) : null;
  const bodyHtml = [
    '<section class="detail-section">',
    '<h3 class="detail-section-title">Event metadata</h3>',
    buildKeyValueList([
      ['Occurred at', formatTimestamp(event.occurredAt)],
      ['Severity', event.severity],
      ['Category', event.category],
      ['Source', event.source],
      ['Service', relatedService?.label ?? event.serviceId ?? 'n/a']
    ], 'detail-key-value'),
    '</section>',
    '<section class="detail-section">',
    '<h3 class="detail-section-title">Summary</h3>',
    `<p class="detail-note">${escapeHtml(event.summary)}</p>`,
    event.excerpt ? `<p class="detail-item-excerpt">${escapeHtml(event.excerpt)}</p>` : '',
    relatedService ? `<button class="section-button detail-link-button" type="button" data-service-id="${escapeHtml(relatedService.id)}">Open ${escapeHtml(relatedService.label)} service detail</button>` : '',
    '</section>'
  ].join('');

  setDetailContent({
    key: `event:${event.id}`,
    kicker: 'Recent event',
    title: event.title,
    summary: event.summary,
    bodyHtml,
    backAction,
    backLabel
  });
};

const showEventsOverview = async () => {
  setDetailLoading({
    key: 'events:overview',
    kicker: 'Recent events',
    title: 'Recent high-signal events',
    summary: 'Loading the extended recent-events slice for drill-down.',
    status: null
  });

  try {
    const payload = await fetchEventsForDetail({ limit: 50 });
    if (detailViewKey !== 'events:overview') {
      return;
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];
    dashboardState.events = payload;

    setDetailContent({
      key: 'events:overview',
      kicker: 'Recent events',
      title: 'Recent high-signal events',
      summary: `${events.length} recent runtime or log events are available for drill-down.`,
      status: null,
      bodyHtml: buildEventsListMarkup(events)
    });
  } catch (error) {
    if (detailViewKey !== 'events:overview') {
      return;
    }

    setDetailContent({
      key: 'events:overview',
      kicker: 'Recent events',
      title: 'Recent high-signal events',
      summary: 'The extended recent-events slice could not be loaded.',
      status: 'unknown',
      bodyHtml: `<p class="detail-empty">${escapeHtml(error instanceof Error ? error.message : 'Failed to load recent events.')}</p>`
    });
  }
};

const showAlertDetail = async (alertId, backAction = showAlertsOverview, backLabel = 'Back to alerts') => {
  const alert = getAlertById(alertId);
  if (!alert) {
    renderError('Requested alert detail is no longer available.');
    return;
  }

  setDetailLoading({
    key: `alert:${alert.id}`,
    kicker: 'Alert detail',
    title: alert.title,
    summary: alert.summary,
    status: alert.status === 'firing' ? 'failed' : 'degraded',
    backAction,
    backLabel
  });

  try {
    const eventsPayload = alert.serviceId ? await fetchEventsForDetail({ limit: 12, serviceId: alert.serviceId }) : { events: [] };
    if (detailViewKey !== `alert:${alert.id}`) {
      return;
    }

    const relatedService = alert.serviceId ? getServiceById(alert.serviceId) : null;
    const relatedEvents = Array.isArray(eventsPayload?.events) ? eventsPayload.events : [];
    const bodyHtml = [
      '<section class="detail-section">',
      '<h3 class="detail-section-title">Alert metadata</h3>',
      buildKeyValueList([
        ['Status', alertStatusLabels[alert.status] || alert.status],
        ['Severity', alert.severity],
        ['Source', alert.source],
        ['Started', formatTimestamp(alert.startedAt)],
        ['Service', relatedService?.label ?? alert.serviceId ?? 'n/a']
      ], 'detail-key-value'),
      '</section>',
      '<section class="detail-section">',
      '<h3 class="detail-section-title">Summary</h3>',
      `<p class="detail-note">${escapeHtml(alert.summary)}</p>`,
      relatedService ? `<button class="section-button detail-link-button" type="button" data-service-id="${escapeHtml(relatedService.id)}">Open ${escapeHtml(relatedService.label)} service detail</button>` : '',
      '</section>',
      '<section class="detail-section">',
      '<h3 class="detail-section-title">Related recent events</h3>',
      buildEventsListMarkup(relatedEvents),
      '</section>'
    ].join('');

    setDetailContent({
      key: `alert:${alert.id}`,
      kicker: 'Alert detail',
      title: alert.title,
      summary: alert.summary,
      status: alert.status === 'firing' ? 'failed' : 'degraded',
      bodyHtml,
      backAction,
      backLabel
    });
  } catch (error) {
    if (detailViewKey !== `alert:${alert.id}`) {
      return;
    }

    setDetailContent({
      key: `alert:${alert.id}`,
      kicker: 'Alert detail',
      title: alert.title,
      summary: alert.summary,
      status: alert.status === 'firing' ? 'failed' : 'degraded',
      bodyHtml: `<p class="detail-empty">${escapeHtml(error instanceof Error ? error.message : 'Failed to load alert context.')}</p>`,
      backAction,
      backLabel
    });
  }
};

const showServiceDetail = async (serviceId, backAction = null, backLabel = 'Back') => {
  const service = getServiceById(serviceId);
  if (!service) {
    renderError('Requested service detail is no longer available.');
    return;
  }

  setDetailLoading({
    key: `service:${service.id}`,
    kicker: 'Service detail',
    title: service.label,
    summary: service.summary || 'No service detail available.',
    status: service.status,
    backAction,
    backLabel
  });

  try {
    const eventsPayload = await fetchEventsForDetail({ limit: 12, serviceId: service.id });
    if (detailViewKey !== `service:${service.id}`)
      return;

    const relatedAlerts = Array.isArray(dashboardState.alerts?.alerts)
      ? dashboardState.alerts.alerts.filter((alert) => alert.serviceId === service.id)
      : [];
    const relatedEvents = Array.isArray(eventsPayload?.events) ? eventsPayload.events : [];
    const bodyHtml = [
      '<section class="detail-section">',
      '<h3 class="detail-section-title">Service metadata</h3>',
      buildKeyValueList(buildServiceMetaEntries(service), 'detail-key-value'),
      '</section>',
      '<section class="detail-section">',
      '<h3 class="detail-section-title">Current related alerts</h3>',
      buildAlertListMarkup(relatedAlerts),
      '</section>',
      '<section class="detail-section">',
      '<h3 class="detail-section-title">Recent related events</h3>',
      buildEventsListMarkup(relatedEvents),
      '</section>'
    ].join('');

    setDetailContent({
      key: `service:${service.id}`,
      kicker: 'Service detail',
      title: service.label,
      summary: service.summary || 'No service detail available.',
      status: service.status,
      bodyHtml,
      backAction,
      backLabel
    });
  } catch (error) {
    if (detailViewKey !== `service:${service.id}`) {
      return;
    }

    setDetailContent({
      key: `service:${service.id}`,
      kicker: 'Service detail',
      title: service.label,
      summary: service.summary || 'No service detail available.',
      status: service.status,
      bodyHtml: [
        '<section class="detail-section">',
        '<h3 class="detail-section-title">Service metadata</h3>',
        buildKeyValueList(buildServiceMetaEntries(service), 'detail-key-value'),
        '</section>',
        `<p class="detail-empty">${escapeHtml(error instanceof Error ? error.message : 'Failed to load related service events.')}</p>`
      ].join(''),
      backAction,
      backLabel
    });
  }
};

const scheduleRefresh = () => {
  if (refreshTimer !== null)
    window.clearTimeout(refreshTimer);

  refreshTimer = window.setTimeout(() => {
    void loadDashboard();
  }, refreshIntervalMs);
};

const loadDashboard = async () => {
  refs.refreshButton.disabled = true;

  try {
    const [summary, alerts, services, system, application, risk, events] = await Promise.all([
      fetchJson('summary'),
      fetchJson('alerts'),
      fetchJson('services'),
      fetchJson('system'),
      fetchJson('application'),
      fetchJson('risk'),
      fetchJson('events?limit=12')
    ]);

    dashboardState.summary = summary;
    dashboardState.alerts = alerts;
    dashboardState.services = services;
    dashboardState.system = system;
    dashboardState.application = application;
    dashboardState.risk = risk;
    dashboardState.events = events;

    renderSummary(summary);
    renderAlerts(summary, alerts);
    renderServices(services);
    renderSystem(system);
    renderApplication(application);
    renderRisk(risk);
    renderEvents(events);
    syncActiveNavGroupFromLocation();
    clearError();
    hasLoadedAtLeastOnce = true;
  } catch (error) {
    if (!hasLoadedAtLeastOnce) {
      renderInitialState();
    }

    renderError(error instanceof Error ? error.message : 'Dashboard refresh failed.');
  } finally {
    refs.refreshButton.disabled = false;
    scheduleRefresh();
  }
};

refs.refreshButton.addEventListener('click', () => {
  void loadDashboard();
});

refs.navSideToggle.addEventListener('click', () => {
  toggleNavSide();
});

refs.navLinks.forEach((link) => {
  link.addEventListener('click', (event) => {
    const groupId = link.dataset.navGroup;
    const sectionId = link.dataset.navTarget;
    const targetSection = typeof sectionId === 'string' ? document.getElementById(sectionId) : null;
    if (!(targetSection instanceof HTMLElement))
      return;

    event.preventDefault();

    if (typeof groupId === 'string' && groupId.length > 0)
      setActiveNavGroup(groupId);

    targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    targetSection.focus({ preventScroll: true });
    window.history.replaceState(null, '', `#${sectionId}`);
  });
});

window.addEventListener('hashchange', () => {
  syncActiveNavGroupFromLocation();
});

window.addEventListener('scroll', scheduleNavScrollSync, { passive: true });
window.addEventListener('resize', scheduleNavScrollSync);

refs.viewAlertsButton.addEventListener('click', () => {
  showAlertsOverview();
});

refs.viewEventsButton.addEventListener('click', () => {
  void showEventsOverview();
});

refs.detailCloseButton.addEventListener('click', () => {
  closeDetailDrawer();
});

refs.detailBackdrop.addEventListener('click', () => {
  closeDetailDrawer();
});

refs.detailBackButton.addEventListener('click', () => {
  if (typeof detailBackAction === 'function') {
    detailBackAction();
  }
});

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target)
    return;

  const serviceButton = target.closest('[data-service-id]');
  if (serviceButton instanceof HTMLElement) {
    void showServiceDetail(serviceButton.dataset.serviceId);
    return;
  }

  const alertButton = target.closest('[data-alert-id]');
  if (alertButton instanceof HTMLElement) {
    void showAlertDetail(alertButton.dataset.alertId);
    return;
  }

  const eventButton = target.closest('[data-event-id]');
  if (eventButton instanceof HTMLElement) {
    showEventDetail(eventButton.dataset.eventId, () => {
      void showEventsOverview();
    }, 'Back to events');
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden)
    void loadDashboard();
});

document.addEventListener('keydown', (event) => {
  if (refs.detailLayer.hidden)
    return;

  if (event.key === 'Escape') {
    closeDetailDrawer();
    return;
  }

  if (event.key !== 'Tab')
    return;

  const focusableElements = getFocusableElements(refs.detailDrawer);
  if (focusableElements.length === 0) {
    event.preventDefault();
    refs.detailDrawer.focus();
    return;
  }

  const [firstElement] = focusableElements;
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (!refs.detailDrawer.contains(activeElement)) {
    event.preventDefault();
    firstElement.focus();
    return;
  }

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
});

applyNavSide(readStoredNavSide());
renderInitialState();
syncActiveNavGroupFromLocation();
syncActiveNavGroupFromScroll();
void loadDashboard();