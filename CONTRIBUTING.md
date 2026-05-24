# Contributing

Thanks for contributing to Private Communication.

This project is a self-hosted, zero-knowledge communication system. Contributions
should preserve that model: plaintext message content, private keys,
passphrases, and backup secrets must stay on the client and must not be exposed
through the backend, logs, or debugging helpers.

## Before You Start

- Read [README.md](README.md) for the current architecture.
- Read [SECURITY.md](SECURITY.md) before reporting security-sensitive problems.
- Keep changes scoped. Avoid mixing refactors, feature work, and unrelated cleanup.
- Do not introduce username/password account flows.
- Do not store active private keys in `localStorage` or send them to the server.

## Repository Layout

- `backend/`: Express, WebSocket signaling, Redis-backed coordination, push, TURN, attachments, dashboard API.
- `frontend/`: React/Vite PWA, browser cryptography, chat, calls, local storage, backups.
- `packages/pcbk-core/`: PCBK backup format primitives and crypto.
- `dashboard/`: static operations UI.
- `docker/`: Nginx, Coturn, Certbot, Docker socket proxy.
- `website/`: static public project page.

## Development Setup

Prerequisites:

- Node.js 24+ for `backend/` and `packages/pcbk-core/`
- npm
- Docker and Docker Compose for full-stack testing

Install workspace dependencies from the repository root:

```bash
npm install
```

Useful workspace commands:

```bash
npm run lint:backend
npm run lint:frontend
npm run lint:pcbk-core
npm run build:frontend
npm run build:pcbk-core
npm run audit:website
```

Package-local commands:

- `backend/`: `npm install`, `npm run dev`, `npm run build`, `npm run lint`
- `frontend/`: `npm install`, `npm run dev`, `npm run build`, `npm run lint`, `npm run preview`
- `packages/pcbk-core/`: `npm install`, `npm run build`, `npm run typecheck`, `npm run test`

For the containerized stack:

```bash
docker-compose up -d
docker-compose logs -f
docker-compose down
```

## Contribution Rules

### Contribution Licensing

By submitting a contribution, you confirm that you have the right to license it under Apache License 2.0 and that the project may distribute your contribution under those terms. Do not submit code, assets, or dependencies that require additional downstream restrictions incompatible with Apache License 2.0.

### Architecture and Security

- Preserve the zero-knowledge boundary.
- Keep business logic in services/helpers, not buried inside UI components.
- Preserve signed-request auth, WebSocket challenge-response, payload limits, and origin validation.
- Keep PCBK format and backup crypto decisions inside `packages/pcbk-core/` unless the work is explicitly browser integration.
- Avoid weakening rate limits, validation, or security comments around sensitive flows.

### Code Style

- Follow the existing TypeScript style and path alias usage.
- Prefer focused changes over broad rewrites.
- Add comments only when they explain non-obvious behavior or security constraints.
- Do not introduce plaintext logging for messages, attachments, keys, backups, or passphrases.

### Tests and Validation

Run the narrowest validation that matches your change:

- backend route or service change: `npm run lint` and `npm run build` in `backend/`
- frontend UI or service change: `npm run lint` and `npm run build` in `frontend/`
- PCBK core change: `npm run typecheck` and `npm run test` in `packages/pcbk-core/`
- website change: run `npm run audit:website` from the repository root when practical

If you cannot run a relevant validation step, say so clearly in the pull request.

## Pull Requests

Open focused pull requests with a clear problem statement.

Each pull request should explain:

- what changed;
- why the change is needed;
- what risks or security boundaries are affected;
- what validation was run;
- any follow-up work that remains.

Keep screenshots or short recordings for UI changes when they materially help review.

## Reporting Bugs

Use the issue tracker for normal bugs and regressions.

For security issues, do not open a public issue. Follow [SECURITY.md](SECURITY.md)
and use GitHub's private vulnerability reporting flow when available.

## Good First Contributions

Good candidates include:

- documentation improvements;
- narrow UI polish with no storage or crypto boundary changes;
- validation and error-message improvements;
- tests for existing behavior;
- website and dashboard clarity improvements.

Larger protocol, cryptography, backup-format, and auth changes should start with
an issue or discussion of scope before implementation.