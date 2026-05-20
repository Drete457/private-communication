#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COTURN_CONF="$PROJECT_ROOT/docker/coturn/turnserver.conf"

if [ ! -f "$COTURN_CONF" ]; then
    echo "turnserver.conf not found at $COTURN_CONF"
    exit 1
fi

detect_public_ip() {
    local ip=""
    if command -v curl >/dev/null 2>&1; then
        ip="$(curl -s https://api.ipify.org || true)"
    elif command -v wget >/dev/null 2>&1; then
        ip="$(wget -qO- https://api.ipify.org || true)"
    fi
    if echo "$ip" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
        echo "$ip"
    else
        echo ""
    fi
}

PUBLIC_IP="${PUBLIC_IP:-$(detect_public_ip)}"
if [ -z "$PUBLIC_IP" ]; then
    echo "Unable to detect public IP."
    exit 1
fi

EXISTING_LINE="$(grep -E '^external-ip=' "$COTURN_CONF" || true)"
if [ -n "$EXISTING_LINE" ]; then
    EXISTING_VALUE="${EXISTING_LINE#external-ip=}"
    if echo "$EXISTING_VALUE" | grep -q '/'; then
        PRIVATE_PART="${EXISTING_VALUE#*/}"
        NEW_VALUE="${PUBLIC_IP}/${PRIVATE_PART}"
    else
        NEW_VALUE="$PUBLIC_IP"
    fi
    sed -i "s#^external-ip=.*#external-ip=${NEW_VALUE}#" "$COTURN_CONF"
else
    if grep -qE '^#[[:space:]]*external-ip=' "$COTURN_CONF"; then
        sed -i "s|^#[[:space:]]*external-ip=.*|external-ip=${PUBLIC_IP}|" "$COTURN_CONF"
    else
        echo "external-ip=${PUBLIC_IP}" >> "$COTURN_CONF"
    fi
fi

if command -v docker >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
        (cd "$PROJECT_ROOT" && docker compose restart coturn)
    elif command -v docker-compose >/dev/null 2>&1; then
        (cd "$PROJECT_ROOT" && docker-compose restart coturn)
    else
        echo "docker compose not available. Restart coturn manually."
        exit 1
    fi
else
    echo "Docker not available. Restart coturn manually."
    exit 1
fi

echo "Updated external-ip to ${PUBLIC_IP} and restarted coturn."
