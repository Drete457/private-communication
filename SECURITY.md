# Security Policy

## Supported Versions

This repository does not currently maintain multiple long-lived security branches.
Security fixes are made against the latest code on `main`, and self-hosted
deployments should upgrade to the newest supported state as quickly as practical.

| Version or deployment line | Supported | Notes |
| -------------------------- | --------- | ----- |
| `main`                     | Yes       | Primary target for security fixes, hardening, and documentation updates. |
| Latest tagged snapshot     | Best effort | If you deploy from tags, move to the latest available tag that contains the fix. |
| Older commits or forks     | No        | Rebase or upgrade before expecting a security fix or triage against outdated code. |

## Reporting a Vulnerability

Please do not open a public GitHub issue for undisclosed vulnerabilities.

Preferred reporting path:

- Use GitHub's private vulnerability reporting flow for this repository if it is available.
- If private reporting is not available, contact the maintainer privately through GitHub instead of posting details publicly.

This project follows a zero-knowledge model. High-priority reports are anything
that breaks the documented privacy or trust boundaries, including exposure of
plaintext message content, call metadata beyond the intended model, private key
material, passphrases, backup contents, or authentication/session guarantees.

Please include as much of the following as you can:

- affected area: backend, frontend, `@private-communication/pcbk-core`, deployment, or website;
- exact commit, tag, or image version you tested;
- deployment shape, such as Docker Compose, custom Nginx, LAN-only, or public internet deployment;
- attacker prerequisites and expected impact;
- clear reproduction steps or a minimal proof of concept;
- whether the issue affects confidentiality, integrity, availability, authentication, or backup recovery.

Please do not send real secrets or user data. In particular, do not include:

- real private keys, passphrases, session tokens, or VAPID keys;
- plaintext messages, attachments, or call recordings;
- raw production backups unless the smallest possible redacted sample is absolutely necessary;
- unredacted infrastructure secrets, IP allowlists, or internal hostnames when a redacted version is enough.

If you need to share logs or payloads, redact them first and keep samples to the
minimum needed to reproduce the issue.

Response expectations:

- acknowledgement target: within 72 hours;
- follow-up target: at least once every 7 days while triage is active;
- accepted fixes normally land in `main` first, with backports only when a maintained release line exists.

Reports are especially helpful when they involve:

- client-side cryptography, key storage, or backup export and restore logic;
- signed-request authentication or WebSocket authentication bypass;
- attachment policy enforcement, encrypted queue handling, or unintended plaintext handling on the server;
- PCBK parsing, rollback, integrity validation, or content-key handling;
- deployment or ingress behavior that breaks the documented boundary between Nginx, backend, Redis, TURN, and encrypted application data.

The following are usually lower priority unless you can show a concrete exploit path:

- missing hardening guidance on non-production or local development setups;
- self-hosted operator mistakes outside the documented default deployment model;
- purely theoretical cryptographic concerns without an implementation-level exploit;
- issues that already require full compromise of the user's device or browser profile.
