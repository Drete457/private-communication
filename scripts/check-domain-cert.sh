#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <domain> [expected_ip]"
  echo "Example: $0 mychat.duckdns.org 192.168.1.25"
  exit 1
fi

DOMAIN="$1"
EXPECTED_IP="${2:-}"

print_section() {
  echo
  echo "=================================================="
  echo "$1"
  echo "=================================================="
}

resolve_domain() {
  if command -v getent >/dev/null 2>&1; then
    getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u
    return
  fi

  if command -v dig >/dev/null 2>&1; then
    dig +short A "$DOMAIN" | sort -u
    return
  fi

  if command -v nslookup >/dev/null 2>&1; then
    nslookup "$DOMAIN" 2>/dev/null | awk '/^Address: /{print $2}' | sort -u
    return
  fi

  echo "No resolver tool found (need getent, dig, or nslookup)."
  return 1
}

print_section "1) DNS resolution"
IPS="$(resolve_domain || true)"
if [ -z "$IPS" ]; then
  echo "Could not resolve $DOMAIN"
else
  echo "$IPS"
fi

if [ -n "$EXPECTED_IP" ]; then
  echo
  if echo "$IPS" | grep -qx "$EXPECTED_IP"; then
    echo "OK: expected IP $EXPECTED_IP is present"
  else
    echo "WARN: expected IP $EXPECTED_IP not found in DNS results"
  fi
fi

print_section "2) HTTPS certificate check"
if command -v openssl >/dev/null 2>&1; then
  CERT_INFO="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName 2>/dev/null || true)"
  if [ -z "$CERT_INFO" ]; then
    echo "Could not read certificate from $DOMAIN:443"
  else
    echo "$CERT_INFO"
    if echo "$CERT_INFO" | grep -q "DNS:$DOMAIN"; then
      echo
      echo "OK: certificate SAN includes $DOMAIN"
    else
      echo
      echo "WARN: certificate SAN does not include $DOMAIN"
    fi
  fi
else
  echo "openssl not found; skipping certificate inspection"
fi

print_section "3) Canonical host redirect check"
if command -v curl >/dev/null 2>&1; then
  REDIRECT_OUTPUT="$(curl -sS -I "https://$DOMAIN" | tr -d '\r' || true)"
  echo "$REDIRECT_OUTPUT" | sed -n '1,5p'
else
  echo "curl not found; skipping redirect check"
fi

print_section "4) Recommendations"
echo "- If DNS resolves to WAN IP on LAN and cert fails, enable Hairpin NAT or Split DNS."
echo "- For Split DNS: map $DOMAIN -> Raspberry Pi LAN IP in router DNS / Pi-hole / AdGuard Home."
echo "- Avoid opening by local IP in browser; always use https://$DOMAIN."
