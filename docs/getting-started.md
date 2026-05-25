# Getting Started

This guide is for the first time someone downloads the project and wants to get
the self-hosted stack running from a tagged release. If the goal is local
feature work or day-to-day development, use [development-guide.md](development-guide.md)
instead.

## Choose The Right Guide

Use this guide when you want to:

- download a release of the project for the first time;
- prepare the self-hosted stack on the target machine;
- run the repository setup script;
- bring up the production-style Docker Compose stack.

Use [development-guide.md](development-guide.md) when you want to:

- work on frontend or backend code locally;
- run the development Compose stack;
- lint, build, or test before opening a pull request.

## What `setup.sh` Is For

The repository setup flow is centered on [scripts/setup.sh](../scripts/setup.sh).
That script is not just an optional helper. It is the main first-run setup for
the self-hosted stack.

It expects a Linux host with `bash`, `sudo`, Docker, and Docker Compose. The
script exits early if it is not run as root.

## Before You Start

Prepare these prerequisites first:

- a Linux host or VM where the stack will run;
- Docker Engine or Docker Desktop with Compose available;
- a public hostname or DDNS domain you want the app to use;
- an email address for Let's Encrypt if you want the script to initialize SSL;
- ports forwarded or reachable as needed for HTTP, HTTPS, and TURN.

Practical network requirements for the full self-hosted setup:

- `80/tcp` for HTTP and certificate bootstrapping;
- `443/tcp` for HTTPS;
- `3478/tcp` and `3478/udp` for STUN/TURN;
- `5349/tcp` for TURN over TLS when enabled;
- `49152-50000/udp` for TURN relay traffic.

Optional but useful:

- Node.js and npm on the host. The script can use Docker as a fallback for
  VAPID key generation, but a local Node installation can make recovery easier
  if something fails mid-setup.

## Get A Release Build

For a first deployment, prefer a tagged GitHub release instead of a moving
snapshot from `main`.

Recommended options:

- open the repository Releases page and download the latest stable release;
- download the release source archive (`zip` or `tar.gz`) if that is the format
  being published;
- if you prefer Git, clone or fetch the repository and check out a specific tag,
  not the default branch tip.

Example with Git and a release tag:

```bash
git clone https://github.com/Drete457/private-communication.git
cd private-communication
git checkout <tag>
```

Or as a shallow clone of a specific tag:

```bash
git clone --branch <tag> --depth 1 https://github.com/Drete457/private-communication.git
cd private-communication
```

If you downloaded a release archive instead, extract it and change into the
extracted folder before continuing.

Avoid using `main` for a first production deployment unless you are explicitly
testing unreleased changes.

## First Run

Make sure Docker is running, then run the setup script from the repository root:

```bash
chmod +x scripts/setup.sh scripts/init-ssl.sh scripts/update-turn-ip.sh
sudo ./scripts/setup.sh
```

If the files already have execute permissions, the `chmod` step is harmless.

## What The Setup Script Does

The setup script prepares the self-hosted stack end to end. In broad terms it:

- copies `backend/.env.example` to `backend/.env` if needed;
- copies `frontend/.env.example` to `frontend/.env` if needed;
- updates backend and frontend environment values for your chosen domain;
- generates or refreshes TURN and VAPID secrets when needed;
- updates Nginx and Coturn configuration files;
- optionally initializes Let's Encrypt certificates through
  [scripts/init-ssl.sh](../scripts/init-ssl.sh);
- optionally applies UFW firewall rules;
- builds and starts the main Docker Compose services in a controlled order;
- optionally installs a cron job for TURN external-IP refresh.

Important: only accept the UFW step if you are working directly on the machine
console, or if you have already handled SSH and other remote-management access
separately. The default UFW rules applied by the setup script do not open SSH,
so accepting that step from an active remote session can lock you out.

The production-style stack it prepares is defined in
[docker-compose.yml](../docker-compose.yml).

## Questions The Script Will Ask

During setup, expect prompts for things like:

- your DDNS or public domain;
- your email address for certificates and VAPID subject;
- whether to configure TURN external IP now;
- whether to rotate the TURN secret;
- whether to initialize SSL now;
- whether to finalize HTTPS configuration in Nginx;
- whether the host is behind a reverse proxy or CDN;
- whether to apply UFW rules; only accept this when you are not depending on
  the current SSH or remote-management session, unless SSH access has already
  been explicitly allowed outside this script;
- whether to install the cron job for TURN IP refresh.

Run it on the actual machine you intend to host, because the script edits local
configuration files and starts containers on that host.

## After Setup

When the script finishes, the main follow-up checks are:

```bash
docker compose ps
docker compose logs -f app nginx coturn
```

If setup completed successfully, the app should be reachable at the domain you
provided to the script.

## If You Only Want Local Development

Do not use this guide as the main workflow for normal application development on
Windows, macOS, or a general coding machine. For that, go to
[development-guide.md](development-guide.md), which documents the development
Compose stack and package-local workflow.