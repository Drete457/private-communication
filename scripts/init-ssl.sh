#!/bin/bash

# =====================================================
# SSL Certificate Initialization Script
# =====================================================
# 
# This script obtains Let's Encrypt certificates for your domain
# Run this BEFORE enabling HTTPS in nginx configuration
#
# Prerequisites:
# 1. DDNS configured and pointing to your IP
# 2. Ports 80/443 forwarded to Raspberry Pi
# 3. Docker and docker-compose installed
#
# Usage:
#   chmod +x init-ssl.sh
#   ./init-ssl.sh your-domain.duckdns.org your@email.com
#
# =====================================================

set -e

# Check arguments
if [ -z "$1" ] || [ -z "$2" ]; then
    echo "Usage: $0 <domain> <email>"
    exit 1
fi

DOMAIN=$1
EMAIL=$2

read -r -p "Use production or staging certificates? [production]: " CERT_MODE
CERT_MODE=${CERT_MODE:-production}
case "${CERT_MODE,,}" in
  staging|stage)
    CERTBOT_ENV_FLAG="--staging"
    ;;
  production|prod|p|"")
    CERTBOT_ENV_FLAG=""
    ;;
  *)
    echo "Invalid choice. Use 'production' or 'staging'."
    exit 1
    ;;
esac

echo "=============================================="
echo "SSL Certificate Initialization"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo "Mode: ${CERT_MODE,,}"
echo "=============================================="

# Navigate to project root
cd "$(dirname "$0")/.."

# Create directories
mkdir -p docker/certbot/conf docker/certbot/www docker/nginx/ssl

# 1. Stop everything to free Port 80
echo "Ensuring Port 80 is free..."
docker compose down

# 2. Obtain certificate using Standalone mode
echo "Obtaining certificate for $DOMAIN..."
docker run --rm -it \
  -p 80:80 \
  -v "$(pwd)/docker/certbot/conf:/etc/letsencrypt" \
  -v "$(pwd)/docker/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d "$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email \
  $CERTBOT_ENV_FLAG

echo "=============================================="
echo "Success! Certificates obtained."
echo "=============================================="