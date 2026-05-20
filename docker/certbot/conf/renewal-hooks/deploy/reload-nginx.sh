#!/bin/sh
set -eu

pid1_cmdline="$(tr '\000' ' ' </proc/1/cmdline 2>/dev/null || true)"

if ! printf '%s' "$pid1_cmdline" | grep -q 'nginx'; then
    echo "Certbot renewal hook expected nginx to be PID 1, got: ${pid1_cmdline:-unknown}" >&2
    exit 1
fi

kill -HUP 1