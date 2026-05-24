---
name: Bug report
about: Report a reproducible bug affecting the app, deployment, dashboard, website, or backup flow
title: '[Bug]: '
labels: bug
assignees: ''

---

<!--
Do not include private keys, passphrases, session tokens, plaintext messages,
attachments, or raw production backups.

If this may be a security issue, use the Security tab instead of a public issue.
-->

## Summary

Describe the bug clearly and briefly.

## Affected Area

- [ ] Backend API / WebSocket
- [ ] Frontend app
- [ ] WebRTC / calls
- [ ] Attachments / media
- [ ] Backups / restore / PCBK
- [ ] Dashboard
- [ ] Website
- [ ] Docker / Nginx / Redis / TURN / deployment
- [ ] Documentation

## Deployment Shape

Describe how you are running the project.

- [ ] Local development
- [ ] Docker Compose
- [ ] Reverse proxy with domain and TLS
- [ ] LAN-only deployment
- [ ] Public internet deployment
- [ ] Other

If relevant, add details such as custom Nginx config, TURN setup, browser PWA install state, or whether the issue happens only behind a proxy.

## Environment

- Commit, tag, or image version:
- OS:
- Browser and version:
- Device type:
- Relevant package or service (`backend`, `frontend`, `@private-communication/pcbk-core`, `website`, etc.):

## Current Behavior

What happened?

## Expected Behavior

What should have happened instead?

## Reproduction Steps

1. 
2. 
3. 
4. 

## Logs, Screenshots, or Samples

Paste only sanitized logs or screenshots that are safe to publish.

- [ ] I removed secrets and sensitive user data.
- [ ] I did not include private keys, passphrases, plaintext messages, or raw production backups.

## Privacy / Security Impact

Does this bug affect any of the following?

- confidentiality or plaintext exposure;
- authentication or signed-request verification;
- WebSocket session handling;
- attachment authorization or retention;
- backup integrity, rollback, or restore safety;
- availability or crash loops.

If none apply, say so explicitly.

## Additional Context

Add any other details that help reproduce or triage the issue.
