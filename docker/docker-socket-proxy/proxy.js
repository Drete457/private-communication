'use strict';

const http = require('node:http');

const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const PORT = Number(process.env.PORT || 2375);
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.REQUEST_TIMEOUT_MS || 4000));
const MAX_DOCKER_RESPONSE_BYTES = Math.max(262144, Number(process.env.MAX_DOCKER_RESPONSE_BYTES || 2097152));

const CONTAINER_ID_PATTERN = /^[a-f0-9]{12,64}$/i;

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
};

const getSingleParam = (url, key) => {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw new Error(`${key} must be provided once`);
  }

  return values[0] ?? null;
};

const assertNoUnexpectedParams = (url, allowedKeys) => {
  for (const key of url.searchParams.keys()) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported Docker query parameter: ${key}`);
    }
  }
};

const assertBooleanParam = (url, key) => {
  const value = getSingleParam(url, key);
  if (value !== null && value !== '0' && value !== '1' && value !== 'true' && value !== 'false') {
    throw new Error(`${key} must be boolean`);
  }
};

const assertIntegerParam = (url, key, min, max) => {
  const value = getSingleParam(url, key);
  if (value === null) {
    return;
  }

  if (!/^\d{1,10}$/.test(value)) {
    throw new Error(`${key} must be an integer`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} outside allowed range`);
  }
};

const assertEventFilters = (url) => {
  const rawFilters = getSingleParam(url, 'filters');
  if (rawFilters === null) {
    return;
  }

  if (rawFilters.length > 4096) {
    throw new Error('filters too large');
  }

  const filters = JSON.parse(rawFilters);
  const filterKeys = Object.keys(filters);
  if (filterKeys.some((key) => key !== 'container' && key !== 'type')) {
    throw new Error('Unsupported event filter');
  }

  const containers = Array.isArray(filters.container) ? filters.container : [];
  if (containers.length > 32 || containers.some((id) => typeof id !== 'string' || !CONTAINER_ID_PATTERN.test(id))) {
    throw new Error('Invalid container event filter');
  }

  const types = Array.isArray(filters.type) ? filters.type : [];
  if (types.some((type) => type !== 'container')) {
    throw new Error('Invalid event type filter');
  }
};

const validateDockerPath = (req) => {
  if (req.method !== 'GET') {
    return { statusCode: 405, error: 'Only GET is allowed' };
  }

  const url = new URL(req.url || '/', 'http://docker-socket-proxy.local');

  if (url.pathname === '/_health') {
    return { health: true };
  }

  try {
    if (url.pathname === '/containers/json') {
      assertNoUnexpectedParams(url, new Set(['all']));
      assertBooleanParam(url, 'all');
      return { path: `${url.pathname}${url.search}` };
    }

    const inspectMatch = /^\/containers\/([^/]+)\/json$/.exec(url.pathname);
    if (inspectMatch) {
      const containerId = inspectMatch[1];
      if (!CONTAINER_ID_PATTERN.test(containerId)) {
        throw new Error('Invalid container id');
      }

      assertNoUnexpectedParams(url, new Set());
      return { path: url.pathname };
    }

    const logsMatch = /^\/containers\/([^/]+)\/logs$/.exec(url.pathname);
    if (logsMatch) {
      const containerId = logsMatch[1];
      if (!CONTAINER_ID_PATTERN.test(containerId)) {
        throw new Error('Invalid container id');
      }

      assertNoUnexpectedParams(url, new Set(['stdout', 'stderr', 'tail', 'timestamps']));
      assertBooleanParam(url, 'stdout');
      assertBooleanParam(url, 'stderr');
      assertBooleanParam(url, 'timestamps');
      assertIntegerParam(url, 'tail', 1, 100);
      return { path: `${url.pathname}${url.search}` };
    }

    if (url.pathname === '/events') {
      assertNoUnexpectedParams(url, new Set(['since', 'until', 'filters']));
      assertIntegerParam(url, 'since', 0, 9999999999);
      assertIntegerParam(url, 'until', 0, 9999999999);
      assertEventFilters(url);
      return { path: `${url.pathname}${url.search}` };
    }

    return { statusCode: 403, error: 'Docker path not allowed' };
  } catch (error) {
    return { statusCode: 400, error: error instanceof Error ? error.message : 'Invalid Docker request' };
  }
};

const proxyDockerRequest = (targetPath, res) => {
  const dockerReq = http.request({
    socketPath: DOCKER_SOCKET_PATH,
    path: targetPath,
    method: 'GET',
    headers: {
      host: 'docker'
    }
  }, (dockerRes) => {
    const chunks = [];
    let byteLength = 0;
    let tooLarge = false;

    dockerRes.on('data', (chunk) => {
      byteLength += chunk.length;
      if (byteLength > MAX_DOCKER_RESPONSE_BYTES) {
        tooLarge = true;
        dockerReq.destroy(new Error('Docker response too large'));
        return;
      }

      chunks.push(chunk);
    });

    dockerRes.on('end', () => {
      if (tooLarge) {
        sendJson(res, 502, { error: 'Docker response too large' });
        return;
      }

      const body = Buffer.concat(chunks);
      res.writeHead(dockerRes.statusCode || 502, {
        'content-type': dockerRes.headers['content-type'] || 'application/octet-stream',
        'cache-control': 'no-store'
      });
      res.end(body);
    });
  });

  dockerReq.setTimeout(REQUEST_TIMEOUT_MS, () => {
    dockerReq.destroy(new Error('Docker request timed out'));
  });
  dockerReq.on('error', (error) => {
    if (!res.headersSent) {
      sendJson(res, 502, { error: error.message });
    } else {
      res.destroy(error);
    }
  });
  dockerReq.end();
};

const server = http.createServer((req, res) => {
  const validation = validateDockerPath(req);
  if (validation.health) {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!validation.path) {
    sendJson(res, validation.statusCode || 403, { error: validation.error || 'Docker request denied' });
    return;
  }

  proxyDockerRequest(validation.path, res);
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, '0.0.0.0');