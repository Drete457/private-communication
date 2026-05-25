# Development Guide

This document is the technical entry point for setting up the project locally
and working on it day to day. Keep [README.md](README.md) for architecture and
project overview; use this guide for local environment setup, development
commands, and validation.

## Choose A Workflow

There are two practical ways to work on this repository:

- containerized development: recommended when you want the backend, frontend,
  Redis, Nginx, and dashboard wired together quickly;
- package-local development: useful when you want to run Node processes on the
  host machine with your own editor/debugger flow.

For most feature work, the containerized workflow is the lowest-friction option.

## Prerequisites

Before starting, make sure you have:

- Node.js 24+ for host-side installs, linting, builds, and tests;
- npm;
- Docker Desktop or a compatible Docker Engine with Compose support;
- Git.

Optional but useful:

- GitHub CLI for release-related work.

## Initial Setup

Install workspace dependencies from the repository root:

```bash
npm install
```

Prepare local environment files:

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env.local
```

On macOS or Linux, use `cp` instead of `copy`.

Notes:

- `backend/.env` is used by the backend and by the development Compose stack;
- `frontend/.env.local` is mainly useful for package-local or remote-host
  testing; the development Compose stack already injects the frontend dev
  values it needs.

## Recommended Development Stack

For the full development stack without Coturn, use:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up app-dev frontend-dev redis nginx-dev dashboard-dev
```

This brings up the parts normally needed for day-to-day app work:

- `app-dev`: backend dev server;
- `frontend-dev`: Vite development server;
- `redis`: runtime store for queues, presence, and readiness checks;
- `nginx-dev`: local edge proxy;
- `dashboard-dev`: static dashboard UI.

Coturn stays out of this command on purpose. Bring it in only when you are
testing TURN-specific or call-relay scenarios.

If you want the same stack detached from the terminal, add `-d`.

## Package-Local Development

If you want to run backend and frontend directly on the host instead of inside
containers, use this workflow.

### Backend

The backend expects Redis to be reachable. When the backend runs on the host,
the `redis` hostname from `backend/.env.example` will not resolve unless the
backend is also inside Compose. For package-local development, use a
host-reachable Redis instance and set:

```dotenv
REDIS_HOST=localhost
REDIS_PORT=6379
```

One simple local Redis option is:

```bash
docker run --rm -p 6379:6379 redis:alpine
```

Then start the backend:

```bash
cd backend
npm install
npm run dev
```

### Frontend

Start the frontend from the repository root:

```bash
npm run dev:frontend
```

Or from the package directly:

```bash
cd frontend
npm install
npm run dev
```

For local package development, you can leave `VITE_SIGNALING_SERVER_URL` unset
or blank in `frontend/.env.local`. In that mode, the app uses the current dev
origin and Vite proxies `/api` and `/ws` to `http://localhost:8080`.

## How To Work In This Repository

Use these files together:

- [README.md](README.md) for architecture and repository boundaries;
- [CONTRIBUTING.md](CONTRIBUTING.md) for contribution rules and validation
  expectations;
- [SECURITY.md](SECURITY.md) for vulnerability reporting and sensitive-data
  handling.

Practical rules while working:

- keep changes scoped;
- preserve the zero-knowledge boundary;
- do not add plaintext logging for keys, passphrases, messages, attachments, or
  backups;
- keep backend/service logic in services and helpers rather than hiding it in UI
  components.

## Validation Before A Pull Request

Run the narrowest relevant checks for the area you changed.

Backend:

```bash
npm run lint --workspace backend
npm run build --workspace backend
```

Frontend:

```bash
npm run lint --workspace frontend
npm run build --workspace frontend
npm run test --workspace frontend
```

PCBK core:

```bash
npm run lint --workspace @private-communication/pcbk-core
npm run typecheck --workspace @private-communication/pcbk-core
npm run test --workspace @private-communication/pcbk-core
```

Website:

```bash
npm run audit:website
```

The CI workflow in [.github/workflows/ci.yml](.github/workflows/ci.yml) runs the
main backend, frontend, and PCBK checks on GitHub, but local targeted
validation is still the faster feedback loop.

## Troubleshooting Notes

- If the package-local backend cannot connect to Redis, check whether Redis is
  actually reachable on `localhost:6379`.
- If the frontend connects to the wrong WebSocket host, review
  `frontend/.env.local` and remove or update `VITE_SIGNALING_SERVER_URL`.
- If the dashboard reports Docker runtime problems while the backend is running
  outside Compose, that is expected unless you also expose a compatible
  `docker-socket-proxy` endpoint.
- If frontend changes seem stale, remember that the PWA/service worker can cache
  assets between runs.