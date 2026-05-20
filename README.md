# Private Communication

Private Communication is a self-hosted PWA for private, end-to-end encrypted communication. The project avoids traditional accounts: each user identity is derived from cryptographic keys, and the server acts as signaling, queueing, and infrastructure glue without seeing plaintext content.

## Backend

The backend lives in [backend/](backend/) and is a Node.js/TypeScript server built with Express 5 and `ws`. Its main role is to coordinate real-time communication, temporary state, and infrastructure integrations without breaking the zero-knowledge model.

### Main Responsibilities

- Exposes the HTTP API used by the frontend for health, dashboard, previews, push, TURN, calls, and attachments.
- Runs the WebSocket signaling server at `/ws`.
- Authenticates sensitive HTTP requests with cryptographic signatures.
- Authenticates WebSocket sessions through challenge-response.
- Routes encrypted messages between online users.
- Temporarily stores encrypted messages, receipts, and call state in Redis.
- Manages online presence, public keys, push subscriptions, and call state.
- Applies payload limits, rate limits, origin validation, and proxy/IP normalization.
- Provides operational metrics for the private dashboard.

The backend does not implement username/password accounts and does not need to see messages, files, calls, passphrases, or private keys in plaintext.

### HTTP Entry Point

The main entry point is [backend/src/index.ts](backend/src/index.ts). It configures Express, Helmet, CORS, body limits, rate limits, origin validation, and the WebSocket server.

Main routes:

- `/health` and `/health/ready`: basic application health and dependency readiness, including Redis.
- `/api/dashboard`: private observability API, limited to local/private network access, with summary, services, alerts, system, application, risk, and event data.
- `/api/preview`: safe link metadata extraction, with allowlisting, local/private host blocking, and response size limits.
- `/api/push`: VAPID public key and Web Push subscription management.
- `/api/turn`: ephemeral TURN credentials for WebRTC.
- `/api/call`: recovery of pending or active calls when the app reopens.
- `/api/attachments`: attachment policy, upload creation, encrypted chunk upload, manifests, chunk download, and signed recipient ACKs.

Sensitive routes pass through HTTP signature authentication in [backend/src/middleware/request-auth.ts](backend/src/middleware/request-auth.ts). The client signs the method, path, timestamp, body, and identity; the server verifies the signature with the provided public key and confirms that the `userId` matches the hash of the encryption public key.

HTTP responses that carry structured payloads are validated before being sent through [backend/src/utils/response-validation.ts](backend/src/utils/response-validation.ts). This keeps route contracts explicit and avoids silently returning malformed API data.

### WebSocket and Signaling

The WebSocket flow is handled by [backend/src/websocket/connection-handler.ts](backend/src/websocket/connection-handler.ts). Each new connection receives a nonce; the client signs that challenge and sends its encryption and signing public keys. After validation, the session is associated with the `userId` in [backend/src/services/session-manager.ts](backend/src/services/session-manager.ts).

Once authenticated, the WebSocket channel handles:

- public key registration and updates;
- online presence and online peer lists;
- encrypted message delivery;
- queued message delivery when a user comes back online;
- delivered/read receipts and ACKs;
- WebRTC signaling for audio/video, including offer, answer, ICE candidates, and hangup;
- pending, active, expired, and interrupted call state;
- push notifications when the recipient is offline.

The backend applies per-connection and per-event rate limits, caps WebSocket message sizes, uses heartbeat checks for live sessions, and removes or refreshes state when sockets close.

### Redis

Redis is managed through [backend/src/services/redis.ts](backend/src/services/redis.ts). It stores only the data needed for coordination and delivery:

- user encryption and signing public keys;
- online presence with TTL and stale entry cleanup;
- encrypted message queues for offline users;
- delivery/read receipt queues;
- Web Push subscriptions;
- pending calls and active call sessions with expiry;
- counters and aggregate data used by the dashboard.

Queued messages remain encrypted by the client. Redis stores transport envelopes and metadata, not readable message content.

### Attachments

Attachments use a dedicated API in [backend/src/routes/attachments.ts](backend/src/routes/attachments.ts) and persistence logic in [backend/src/services/attachments.ts](backend/src/services/attachments.ts). The backend validates type, size, chunks, hashes, and manifest signatures, but uploaded bytes are already encrypted by the frontend.

The attachment flow is split into:

- file policy and per-kind limits;
- upload sessions with TTL;
- encrypted binary chunks stored on disk;
- sender-signed manifests;
- downloads authorized for sender or recipient;
- recipient-signed ACKs;
- Redis expiry cleanup and periodic orphan file sweeping.

### Dashboard and Observability

The backend produces operational dashboard data through services in [backend/src/services/](backend/src/services/). The dashboard reads metrics such as WebSocket sessions, online users, queued messages, queued receipts, pending calls, active calls, authentication failures, rate-limit rejections, service health, risk/capacity, and recent events.

The dashboard API is read-only, rejects write methods, and is restricted to private or loopback IP addresses.

Dashboard history and rolling application signals are tracked by backend services so the UI can show both current state and recent behavior. This includes service health, host resource signals, auth failure rate, rate-limit spikes, queue pressure, certificate windows, Redis pressure, and recent container events.

### Health, Logging, and Validation

The backend has two health layers: a basic uptime check and a readiness check that verifies Redis through a timed ping. Runtime logs are emitted through [backend/src/utils/logger.ts](backend/src/utils/logger.ts) with level filtering, and sensitive flows log metadata only, not plaintext payloads.

### Security Boundaries

The backend assumes that Nginx is the public HTTP/HTTPS edge while the Node application stays private on the Docker network. The backend remains responsible for application-aware validation: request signatures, WebSocket authentication, route/event limits, payload limits, origin checks, sessions, calls, and attachment authorization.

## Frontend

The frontend lives in [frontend/](frontend/) and is a React 19 + Vite + TypeScript PWA. It owns the user experience, client-side cryptography, local storage, WebSocket/WebRTC communication, and backup integration.

### Application Structure

The main entry point is [frontend/src/App.tsx](frontend/src/App.tsx). The application initializes local identity, connects to the WebSocket, loads attachment policy, resumes pending transfers, and switches between setup and the authenticated app.

Main views:

- `setup`: creates a new identity or restores one from a backup.
- `chat`: lists contacts, displays conversations, sends messages, handles replies, forwards messages, and manages attachments.
- `call`: audio/video call interface with microphone, camera, camera switching, and call recovery controls.
- `library`: local library for files, images, audio, video, GIFs, links, and cached remote media.
- `settings`: identity, QR/contact payload, PWA/push diagnostics, backups, and local data deletion.

Shared state lives in [frontend/src/store/](frontend/src/store/) with Zustand. Persisted application data uses IndexedDB through Dexie.

UI code is grouped under [frontend/src/components/](frontend/src/components/) by feature area: contact import, backup panels, chat UI, common controls, health checks, layout, library views, and share/import helpers. Shared browser logic is kept in [frontend/src/services/](frontend/src/services/), small reusable hooks live in [frontend/src/hooks/](frontend/src/hooks/), and shared TypeScript contracts live in [frontend/src/types/](frontend/src/types/).

### Identity and Cryptography

Core cryptography lives in [frontend/src/crypto/](frontend/src/crypto/). The app uses the Web Crypto API with:

- ECDH P-256 to derive shared secrets between peers;
- ECDSA P-256 for signatures;
- AES-GCM for content encryption;
- hashes/fingerprints for verifiable identity.

The `userId` is derived from the encryption public key. Active private keys are stored as `CryptoKey` objects in IndexedDB through [frontend/src/crypto/key-manager.ts](frontend/src/crypto/key-manager.ts). Private key material is exported only inside encrypted backup flows.

The frontend also keeps a local identity capsule: a protected representation of the operational identity that supports backup/restore preparation without keeping active private keys as plaintext persisted data.

### Messages

Message behavior is implemented in [frontend/src/services/message-service.ts](frontend/src/services/message-service.ts). It manages:

- message encryption and decryption;
- signing and integrity verification;
- local message history in IndexedDB;
- peers/contacts and their public keys;
- outbox retries with backoff;
- link previews;
- reply references;
- message attachments;
- cached remote media and the local library.

Message drafts are handled separately by [frontend/src/services/chat-draft-store.ts](frontend/src/services/chat-draft-store.ts) and [frontend/src/hooks/use-chat-draft.ts](frontend/src/hooks/use-chat-draft.ts). Draft text is encrypted before being stored in `localStorage`, scoped per user and peer, and removed when malformed or no longer needed.

Before a message reaches the backend, it is already encrypted and signed. The backend receives only the transport envelope needed for routing, queueing, and delivery.

### Browser WebSocket Client

The browser WebSocket client is implemented in [frontend/src/services/web-socket-service.ts](frontend/src/services/web-socket-service.ts). It opens the backend connection, answers the authentication challenge, registers event handlers, reconnects/resumes when the page becomes visible again, and syncs pending receipts.

The application suspends the connection when the page is hidden or offline and attempts to resume when the browser becomes active again. This reduces resource usage and avoids keeping unnecessary live sessions.

### WebRTC Calls

Calls use [frontend/src/services/web-rtc-service.ts](frontend/src/services/web-rtc-service.ts). WebRTC negotiation goes through the WebSocket, while media flows between browsers through WebRTC whenever possible.

The service handles:

- audio and video;
- TURN credential retrieval;
- STUN/TURN ICE servers;
- data channels;
- ICE restart;
- relay fallback when needed;
- call recovery after reload/reopen;
- local call state metrics;
- wake lock during active calls.

### Attachments, Files, and Media

On the frontend, attachments are prepared, encrypted, and split into chunks before upload. The app tracks progress, error states, transfer retries, and pending local uploads/downloads.

Attachment policy is fetched from the signed backend API and cached locally for faster validation. Attachment-related services also handle local attachment persistence, forwarding existing attachments, continuation reminders, queued uploads, and cleanup after recipient acknowledgement or expiry.

The library combines local and cached remote content: images, GIFs, video, audio, files, and links. These records live in the local message database and can be included in full backups.

### PWA, Push, and Service Worker

The service worker in [frontend/src/sw.ts](frontend/src/sw.ts) precaches the app and handles push notifications. Notifications cover messages, incoming calls, and local attachment transfer reminders. The service worker can also clear notifications when the app returns to the foreground.

The frontend includes diagnostics for PWA installation, push permission, and service worker state in the settings area. A small PWA update service applies waiting service workers on launch and reloads once the new worker takes control.

### Client Storage and Caches

The frontend uses browser storage with different sensitivity boundaries:

- IndexedDB stores operational data: active `CryptoKey` objects, peer keys, messages, link previews, outbox records, local attachments, transfer queues, and cached remote media.
- `localStorage` is used only for non-secret or separately encrypted browser state, such as encrypted chat drafts and cached attachment policy.
- `sessionStorage` is used for transient UI/runtime markers such as PWA update reload guards.
- Full `.pcbk` backups include relevant IndexedDB application state but intentionally exclude `localStorage` and `sessionStorage`.

### Frontend Backups

The frontend integrates export and restore through [frontend/src/services/backup/](frontend/src/services/backup/) and [frontend/src/services/identity-backup-service.ts](frontend/src/services/identity-backup-service.ts).

There are two backup modes:

- `identity-only`: exports only the operational identity and the manifest.
- `full`: exports identity, peer keys, messages, previews, outbox, local attachments, transfer queue, and remote media.

Full backup export is written incrementally in the browser. Large blobs are split into chunks and each record is encrypted before being written. Restore validates the prelude, header, authentication, manifest, record order, record types, and payloads before applying state. If applying restored state fails, the frontend attempts to roll back to the previous snapshot.

## PCBK Core

The [packages/pcbk-core/](packages/pcbk-core/) package contains the `.pcbk` backup format primitives, separated from UI and IndexedDB integration. It defines the cryptographic and structural layer of backups:

- format constants and types;
- canonical CBOR;
- Argon2id passphrase derivation;
- HKDF-SHA-256 subkey derivation;
- HMAC-SHA-256 header authentication;
- AES-GCM-256 content key wrapping and record encryption;
- prelude, clear header, and record headers;
- per-record nonces;
- final manifest and count/object validation;
- passphrase policy and passphrase/mnemonic generation.

The `.pcbk` file leaves only minimal metadata in cleartext, such as mode, timestamp, Argon2id parameters, and information required to open the file. Identity, messages, peers, attachments, queues, and media live inside encrypted records.

The human-readable format specification is in [docs/pcbk-format-spec.md](docs/pcbk-format-spec.md).

## Dashboard

The dashboard in [dashboard/](dashboard/) is a static UI separate from the main PWA. It consumes `/api/dashboard` and shows operational state for the system:

- general summary and data freshness;
- active or pending alerts;
- Docker service health;
- host CPU, memory, disk, and load;
- sessions, presence, queues, calls, and abuse signals;
- risk/capacity;
- recent container events.

In production, the dashboard is served by Nginx and protected for local/LAN access. Docker metadata is read through [docker/docker-socket-proxy/](docker/docker-socket-proxy/), a hardened read-only proxy that reduces Docker socket exposure.

## Docker Infrastructure and Ingress

Infrastructure lives mostly in [docker/](docker/) and in [docker-compose.yml](docker-compose.yml) plus [docker-compose.dev.yml](docker-compose.dev.yml).

Main services:

- `app`: backend Node.js service, private on the Docker network.
- `nginx`: public HTTP/HTTPS edge, TLS, static PWA files, API and WebSocket proxying, generic rate limits, and sensitive path protection.
- `redis`: queueing, presence, public keys, receipts, calls, push subscriptions, and temporary state.
- `coturn`: STUN/TURN for WebRTC NAT traversal.
- `certbot`: certificate renewal.
- `dashboard`: static operations UI.
- `docker-socket-proxy`: read-only Docker metadata proxy used by the dashboard.

The responsibility split is intentional:

- Nginx terminates TLS, serves the PWA, forwards `/api`, `/health`, `/ws`, and `/dashboard`, and applies generic edge limits.
- Backend validates identity, signatures, origins, payloads, authorization, and route/event-specific rules.
- Coturn is exposed directly on TURN/STUN ports because it is separate from HTTP/WebSocket traffic.

## Scripts

The [scripts/](scripts/) folder contains support automation for the self-hosted environment:

- initial domain, environment, Nginx, Coturn, and VAPID key configuration;
- certificate initialization and diagnostics;
- public IP updates for TURN;
- backups of operational server files.

These scripts are part of environment maintenance, but this README is only meant to describe what the project contains and how the pieces relate to each other.

## Test Coverage

The repository includes Vitest-based tests for security-sensitive and persistence-heavy code paths:

- [packages/pcbk-core/test/](packages/pcbk-core/test/) covers restore primitives such as prelude parsing, header authentication, content key unwrap, record decryption failure, manifest validation, and record header validation.
- [frontend/test/backup/restore/](frontend/test/backup/restore/) covers PCBK restore parsing and prepared restore state assembly.
- [frontend/test/services/](frontend/test/services/) covers identity backup restore behavior, rollback handling, and encrypted chat draft storage.

The backend currently focuses on runtime validation, route schemas, rate limits, and explicit service boundaries rather than a package-local test suite.

## Repository Layout

```text
private-communication/
├── backend/               # Express API, WebSocket, Redis, push, TURN, attachments, and dashboard API
├── frontend/              # React/Vite PWA, client cryptography, chat, calls, library, and backups
├── packages/pcbk-core/    # Primitives for the encrypted .pcbk backup format
├── dashboard/             # Static operational observability UI
├── docker/                # Nginx, Coturn, Certbot, and Docker socket proxy
├── docs/                  # Technical documentation, including the PCBK specification
├── scripts/               # Support automation for the self-hosted environment
├── docker-compose.yml     # Production stack
└── docker-compose.dev.yml # Local/containerized development stack
```

## Privacy Model

The project follows a practical zero-knowledge model:

- identity is based on cryptographic keys, not password accounts;
- content is encrypted on the client before it reaches the backend;
- WebRTC calls are signaled by the server, while media travels between peers/TURN;
- active private keys remain as `CryptoKey` objects in the browser;
- private keys are exported only inside encrypted backups;
- the backend is limited to routing, queues, presence, notifications, and operational metadata;
- Redis and attachment storage receive encrypted envelopes/chunks, not plaintext content;
- `.pcbk` backups encrypt functional payloads and authenticate structure to detect corruption or tampering.

In short: the server helps devices find each other, deliver data, and keep temporary state; the devices remain responsible for identity, encryption, signing, decryption, and secure restore.
