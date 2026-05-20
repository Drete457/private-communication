#!/usr/bin/env bash
set -euo pipefail

# 1. Path definitions
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_ENV="$PROJECT_ROOT/backend/.env"
FRONTEND_ENV="$PROJECT_ROOT/frontend/.env"
NGINX_CONF="$PROJECT_ROOT/docker/nginx/conf.d/01-https.conf"
COTURN_CONF="$PROJECT_ROOT/docker/coturn/turnserver.conf"
COTURN_CERTS_DIR="$PROJECT_ROOT/docker/certbot/conf/coturn"
UPDATE_TURN_SCRIPT="$PROJECT_ROOT/scripts/update-turn-ip.sh"
NGINX_RENEW_HOOK="$PROJECT_ROOT/docker/certbot/conf/renewal-hooks/deploy/reload-nginx.sh"
COTURN_RENEW_HOOK="$PROJECT_ROOT/docker/certbot/conf/renewal-hooks/deploy/sync-coturn-certs.sh"

prompt() {
    local label="$1"
    local default="${2:-}"
    local value
    if [ -n "$default" ]; then
        read -r -p "$label [$default]: " value
        echo "${value:-$default}"
    else
        read -r -p "$label: " value
        echo "$value"
    fi
}

yesno() {
    local label="$1"
    local default="${2:-y}"
    local value
    read -r -p "$label [${default}]: " value
    value="${value:-$default}"
    case "${value,,}" in
        y|yes) return 0 ;;
        *) return 1 ;;
    esac
}

is_root() {
    [ "${EUID:-$(id -u)}" -eq 0 ]
}

generate_vapid_keys_local() {
    (cd "$PROJECT_ROOT/backend" && node -e "const webpush=require('web-push'); const k=webpush.generateVAPIDKeys(); console.log(k.publicKey); console.log(k.privateKey);")
}

generate_vapid_keys_docker() {
    docker run --rm node:alpine sh -lc "TMP_DIR=\$(mktemp -d) && cd \"\$TMP_DIR\" && npm install --silent web-push@3.6.7 >/dev/null 2>&1 && node -e \"const webpush=require('web-push'); const k=webpush.generateVAPIDKeys(); console.log(k.publicKey); console.log(k.privateKey);\""
}

is_valid_vapid_public_key() {
    local value="$1"
    printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]{80,}$'
}

is_valid_vapid_private_key() {
    local value="$1"
    printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]{40,}$'
}

has_valid_vapid_config() {
    local public_key="$1"
    local private_key="$2"

    is_valid_vapid_public_key "$public_key" && is_valid_vapid_private_key "$private_key"
}

cleanup_backend_install() {
    if [ "${BACKEND_HAD_NODE_MODULES:-0}" -eq 0 ] && [ -d "$PROJECT_ROOT/backend/node_modules" ]; then
        rm -rf "$PROJECT_ROOT/backend/node_modules"
    fi
    if [ "${BACKEND_HAD_PACKAGE_LOCK:-0}" -eq 0 ] && [ -f "$PROJECT_ROOT/backend/package-lock.json" ]; then
        rm -f "$PROJECT_ROOT/backend/package-lock.json"
    fi
}

stop_all_running_containers() {
    local running_container_ids=()

    mapfile -t running_container_ids < <(docker ps -q)
    if [ "${#running_container_ids[@]}" -eq 0 ]; then
        return
    fi

    echo "Stopping all running Docker containers on this host..."
    docker stop "${running_container_ids[@]}" >/dev/null
}

sync_coturn_tls_material() {
    local domain="$1"
    local source_dir="$PROJECT_ROOT/docker/certbot/conf/live/$domain"
    local target_dir="$COTURN_CERTS_DIR/$domain"

    if [ ! -f "$source_dir/fullchain.pem" ] || [ ! -f "$source_dir/privkey.pem" ]; then
        return 1
    fi

    install -d -m 0755 "$COTURN_CERTS_DIR"
    install -d -m 0750 "$target_dir"
    install -m 0644 "$source_dir/fullchain.pem" "$target_dir/fullchain.pem"
    install -m 0640 "$source_dir/privkey.pem" "$target_dir/privkey.pem"
    chown 65534:65533 "$target_dir" "$target_dir/fullchain.pem" "$target_dir/privkey.pem"
}

install_turn_cron() {
    local schedule="${1}"
    local cron_tag="# private-comm-turn-ip"
    local cron_cmd="cd \"$PROJECT_ROOT\" && \"$UPDATE_TURN_SCRIPT\" >/var/log/turn-ip-update.log 2>&1"
    local cron_line="${schedule} ${cron_cmd} ${cron_tag}"

    if ! command -v crontab >/dev/null 2>&1; then
        echo "crontab not available; skipping cron setup."
        return
    fi

    local existing
    existing="$(crontab -l 2>/dev/null || true)"
    if is_root; then
        { echo "$existing" | grep -v "$cron_tag" || true; echo "$cron_line"; } | crontab -
        echo "Cron installed (root): ${schedule}."
    else
        { echo "$existing" | grep -v "$cron_tag" || true; echo "$cron_line"; } | crontab -
        echo "Cron installed for current user. Use sudo to install system-wide if desired."
    fi
}

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

echo "=============================================="
echo "      PRIVATE COMMUNICATION SETUP"
echo "=============================================="

if ! is_root; then
    echo "This setup must be run with sudo to access certificates and configure services."
    echo "Please re-run: sudo ./scripts/setup.sh"
    exit 1
fi

# 2. Collect user information
DOMAIN="$(prompt "DDNS domain (e.g., YOUR_DOMAIN.duckdns.org)")"
EMAIL="$(prompt "Email for Let's Encrypt" "")"
DETECTED_PUBLIC_IP="$(detect_public_ip)"
PUBLIC_IP=""
PRIVATE_IP=""

if yesno "Configure TURN external-ip now? (recommended for reliable TURN)" "y"; then
    if [ -n "$DETECTED_PUBLIC_IP" ]; then
        if yesno "Use detected public IP (${DETECTED_PUBLIC_IP})?" "y"; then
            PUBLIC_IP="$DETECTED_PUBLIC_IP"
        else
            PUBLIC_IP="$(prompt "Public IP (optional, press enter to skip)" "")"
        fi
    else
        PUBLIC_IP="$(prompt "Public IP (optional, press enter to skip)" "")"
    fi

    if [ -n "$PUBLIC_IP" ]; then
        # Use the fixed coturn container IP from docker-compose.yml
        PRIVATE_IP="172.30.0.5"
    fi
fi

if [ -z "$DOMAIN" ]; then
    echo "Error: Domain is required."
    exit 1
fi

# 3. Create necessary folders
mkdir -p "$PROJECT_ROOT/docker/nginx/ssl"
mkdir -p "$PROJECT_ROOT/docker/certbot/conf" "$PROJECT_ROOT/docker/certbot/www"
mkdir -p "$COTURN_CERTS_DIR"

# 4. Handle Environment Files
[ ! -f "$BACKEND_ENV" ] && cp "$PROJECT_ROOT/backend/.env.example" "$BACKEND_ENV"
[ ! -f "$FRONTEND_ENV" ] && cp "$PROJECT_ROOT/frontend/.env.example" "$FRONTEND_ENV"

# Update Backend
sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=https://${DOMAIN},http://localhost:3000#" "$BACKEND_ENV"
sed -i "s#^NODE_ENV=.*#NODE_ENV=production#" "$BACKEND_ENV"
grep -q "^NODE_ENV=" "$BACKEND_ENV" || echo "NODE_ENV=production" >> "$BACKEND_ENV"
sed -i "s#^HTTP_AUTH_DISABLED=.*#HTTP_AUTH_DISABLED=false#" "$BACKEND_ENV"
grep -q "^HTTP_AUTH_DISABLED=" "$BACKEND_ENV" || echo "HTTP_AUTH_DISABLED=false" >> "$BACKEND_ENV"

# Generate TURN REST shared secret only if missing/placeholder, unless user requests rotation
ROTATE_TURN_SECRET=false
if yesno "Rotate TURN secret now?" "n"; then
    ROTATE_TURN_SECRET=true
fi

CURRENT_TURN_SECRET="$(grep -E '^TURN_SECRET=' "$BACKEND_ENV" | cut -d= -f2-)"
if [ "$ROTATE_TURN_SECRET" = true ] || [ -z "$CURRENT_TURN_SECRET" ] || [ "$CURRENT_TURN_SECRET" = "your_turn_shared_secret" ]; then
    TURN_SECRET="$(python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
)"
    sed -i "s#^TURN_SECRET=.*#TURN_SECRET=${TURN_SECRET}#" "$BACKEND_ENV"
    grep -q "^TURN_SECRET=" "$BACKEND_ENV" || echo "TURN_SECRET=${TURN_SECRET}" >> "$BACKEND_ENV"
else
    TURN_SECRET="$CURRENT_TURN_SECRET"
fi

sed -i "s#^TURN_TTL_SECONDS=.*#TURN_TTL_SECONDS=3600#" "$BACKEND_ENV"
grep -q "^TURN_TTL_SECONDS=" "$BACKEND_ENV" || echo "TURN_TTL_SECONDS=3600" >> "$BACKEND_ENV"


# Generate VAPID keys when missing or obviously invalid
CURRENT_VAPID_PUBLIC="$(grep -E '^VAPID_PUBLIC_KEY=' "$BACKEND_ENV" | cut -d= -f2-)"
CURRENT_VAPID_PRIVATE="$(grep -E '^VAPID_PRIVATE_KEY=' "$BACKEND_ENV" | cut -d= -f2-)"
if ! has_valid_vapid_config "$CURRENT_VAPID_PUBLIC" "$CURRENT_VAPID_PRIVATE"; then
    echo "Generating VAPID keys..."
    VAPID_OUTPUT=""

    if [ -x "$(command -v node)" ]; then
        BACKEND_HAD_NODE_MODULES=0
        BACKEND_HAD_PACKAGE_LOCK=0
        [ -d "$PROJECT_ROOT/backend/node_modules" ] && BACKEND_HAD_NODE_MODULES=1
        [ -f "$PROJECT_ROOT/backend/package-lock.json" ] && BACKEND_HAD_PACKAGE_LOCK=1
        if (cd "$PROJECT_ROOT/backend" && node -e "require('web-push')" >/dev/null 2>&1); then
            VAPID_OUTPUT="$(generate_vapid_keys_local)"
        else
            if [ -x "$(command -v npm)" ]; then
                (cd "$PROJECT_ROOT/backend" && npm install web-push@3.6.7)
                if (cd "$PROJECT_ROOT/backend" && node -e "require('web-push')" >/dev/null 2>&1); then
                    VAPID_OUTPUT="$(generate_vapid_keys_local)"
                else
                    VAPID_OUTPUT=""
                fi
                cleanup_backend_install
            else
                echo "npm not available on the host; skipping local VAPID generation."
                VAPID_OUTPUT=""
            fi
        fi
    else
        echo "Node.js not available on the host; skipping local VAPID generation."
    fi

    if [ -z "$VAPID_OUTPUT" ] && [ -x "$(command -v docker)" ]; then
        echo "Falling back to Docker for VAPID key generation..."
        VAPID_OUTPUT="$(generate_vapid_keys_docker || true)"
    fi

    if [ -n "$VAPID_OUTPUT" ]; then
        readarray -t VAPID_KEYS <<< "$VAPID_OUTPUT"
        VAPID_PUBLIC_KEY="${VAPID_KEYS[0]}"
        VAPID_PRIVATE_KEY="${VAPID_KEYS[1]}"
        if has_valid_vapid_config "$VAPID_PUBLIC_KEY" "$VAPID_PRIVATE_KEY"; then
            sed -i "s#^VAPID_PUBLIC_KEY=.*#VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}#" "$BACKEND_ENV"
            sed -i "s#^VAPID_PRIVATE_KEY=.*#VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}#" "$BACKEND_ENV"
            grep -q "^VAPID_PUBLIC_KEY=" "$BACKEND_ENV" || echo "VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}" >> "$BACKEND_ENV"
            grep -q "^VAPID_PRIVATE_KEY=" "$BACKEND_ENV" || echo "VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY}" >> "$BACKEND_ENV"
        else
            echo "Error: Generated VAPID keys were invalid. Aborting setup."
            exit 1
        fi
    else
        echo "Error: Could not generate valid VAPID keys automatically. Install Node.js/npm on the host or provide valid keys in backend/.env, then rerun setup."
        exit 1
    fi
fi

if [ -n "$EMAIL" ]; then
    sed -i "s#^VAPID_SUBJECT=.*#VAPID_SUBJECT=mailto:${EMAIL}#" "$BACKEND_ENV"
    grep -q "^VAPID_SUBJECT=" "$BACKEND_ENV" || echo "VAPID_SUBJECT=mailto:${EMAIL}" >> "$BACKEND_ENV"
fi

# Update Frontend
sed -i "s#^VITE_SIGNALING_SERVER_URL=.*#VITE_SIGNALING_SERVER_URL=wss://${DOMAIN}#" "$FRONTEND_ENV"
sed -i "s#^VITE_STUN_SERVER_URL=.*#VITE_STUN_SERVER_URL=stun:${DOMAIN}:3478#" "$FRONTEND_ENV"

# 5. Update Nginx Template
sed -i "s/YOUR_DOMAIN\.duckdns\.org/${DOMAIN}/g" "$NGINX_CONF"

# 6. SSL Initialization (Calls the other script)
if [ -f "$PROJECT_ROOT/docker/certbot/conf/live/${DOMAIN}/fullchain.pem" ] && [ -f "$PROJECT_ROOT/docker/certbot/conf/live/${DOMAIN}/privkey.pem" ]; then
    echo "SSL certs already exist for ${DOMAIN}. Skipping initialization."
else
    if yesno "Run SSL Certificate initialization?"; then
        if [ -z "$EMAIL" ]; then
            echo "Error: Email is required for SSL."
            exit 1
        fi
        bash "$PROJECT_ROOT/scripts/init-ssl.sh" "$DOMAIN" "$EMAIL"
    fi
fi

# 7. Apply SSL Configuration to Nginx
LOCAL_IP=$(hostname -I | awk '{print $1}')

if yesno "Finalize Nginx HTTPS configuration?"; then
    # Enable Certificates
    sed -i "s|^#* *ssl_certificate /etc/letsencrypt/live/.*|    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;|" "$NGINX_CONF"
    sed -i "s|^#* *ssl_certificate_key /etc/letsencrypt/live/.*|    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;|" "$NGINX_CONF"
fi

# 7b. SSL Optimization (OCSP Stapling and Local Resolver)
if [ -f "$PROJECT_ROOT/docker/certbot/conf/live/${DOMAIN}/fullchain.pem" ]; then
    echo "Enabling Optimizations: OCSP Stapling and Local Resolver..."
    
    # 1. Enable ssl_stapling
    sed -i "s|^\s*#\s*ssl_stapling on;|    ssl_stapling on;|" "$NGINX_CONF"
    sed -i "s|^\s*#\s*ssl_stapling_verify on;|    ssl_stapling_verify on;|" "$NGINX_CONF"
    
    # 2. Configure the trusted certificate
    sed -i "s|^\s*#\s*ssl_trusted_certificate .*|    ssl_trusted_certificate /etc/letsencrypt/live/${DOMAIN}/chain.pem;|" "$NGINX_CONF"
    
    # 3. Configure the Resolver using the DETECTED Local IP
    sed -i "s|^\s*#\s*resolver .*|    resolver ${LOCAL_IP} 8.8.8.8 valid=30s;|" "$NGINX_CONF"
    sed -i "s|^\s*#\s*resolver_timeout .*|    resolver_timeout 5s;|" "$NGINX_CONF"
    
    echo "SSL and Resolver configurations applied successfully for IP: ${LOCAL_IP}."
else
    echo "Certificates not found. Skipping optimizations."
fi

# 7c. Real IP handling (only if behind a reverse proxy/CDN)
if yesno "Is the server behind a reverse proxy/CDN?" "n"; then
    TRUSTED_PROXY_CIDR="$(prompt "Trusted proxy CIDR (e.g., 203.0.113.0/24)" "0.0.0.0/0")"
    sed -i "s|^#\s*real_ip_header X-Forwarded-For;|    real_ip_header X-Forwarded-For;|" "$PROJECT_ROOT/docker/nginx/nginx.conf"
    sed -i "s|^#\s*set_real_ip_from .*;|    set_real_ip_from ${TRUSTED_PROXY_CIDR};|" "$PROJECT_ROOT/docker/nginx/nginx.conf"
else
    sed -i "s|^\s*real_ip_header X-Forwarded-For;|    # real_ip_header X-Forwarded-For;|" "$PROJECT_ROOT/docker/nginx/nginx.conf"
    sed -i "s|^\s*set_real_ip_from .*;|    # set_real_ip_from 0.0.0.0/0;|" "$PROJECT_ROOT/docker/nginx/nginx.conf"
fi

# 8. Update Coturn
sed -i "s#^realm=.*#realm=${DOMAIN}#" "$COTURN_CONF"
sed -i "s#^static-auth-secret=.*#static-auth-secret=${TURN_SECRET}#" "$COTURN_CONF"

# 8b. Enable Coturn TLS if certificates exist
ENABLE_COTURN_TLS=false
if [ -f "$PROJECT_ROOT/docker/certbot/conf/live/${DOMAIN}/fullchain.pem" ] && [ -f "$PROJECT_ROOT/docker/certbot/conf/live/${DOMAIN}/privkey.pem" ]; then
    if sync_coturn_tls_material "$DOMAIN"; then
        ENABLE_COTURN_TLS=true
    else
        echo "Warning: Could not stage TLS certificates for Coturn. TLS listener will stay disabled."
    fi
fi

if [ "$ENABLE_COTURN_TLS" = true ]; then
    sed -i "s|^#\s*tls-listening-port=5349|tls-listening-port=5349|" "$COTURN_CONF"
    sed -i "s|^#\s*cert=/etc/coturn/certs/.*|cert=/etc/coturn/certs/${DOMAIN}/fullchain.pem|" "$COTURN_CONF"
    sed -i "s|^#\s*pkey=/etc/coturn/certs/.*|pkey=/etc/coturn/certs/${DOMAIN}/privkey.pem|" "$COTURN_CONF"
    sed -i "s|^#\s*no-tlsv1$|no-tlsv1|" "$COTURN_CONF"
    sed -i "s|^#\s*no-tlsv1_1$|no-tlsv1_1|" "$COTURN_CONF"
else
    sed -i "s|^\s*tls-listening-port=5349|# tls-listening-port=5349|" "$COTURN_CONF"
    sed -i "s|^\s*cert=/etc/coturn/certs/.*|# cert=/etc/coturn/certs/${DOMAIN}/fullchain.pem|" "$COTURN_CONF"
    sed -i "s|^\s*pkey=/etc/coturn/certs/.*|# pkey=/etc/coturn/certs/${DOMAIN}/privkey.pem|" "$COTURN_CONF"
    sed -i "s|^\s*no-tlsv1$|# no-tlsv1|" "$COTURN_CONF"
    sed -i "s|^\s*no-tlsv1_1$|# no-tlsv1_1|" "$COTURN_CONF"
fi

TURN_URLS_VALUE="turn:${DOMAIN}:3478?transport=udp,turn:${DOMAIN}:3478?transport=tcp"
if [ "$ENABLE_COTURN_TLS" = true ]; then
    TURN_URLS_VALUE="${TURN_URLS_VALUE},turns:${DOMAIN}:5349?transport=tcp"
fi
sed -i "s#^TURN_URLS=.*#TURN_URLS=${TURN_URLS_VALUE}#" "$BACKEND_ENV"
grep -q "^TURN_URLS=" "$BACKEND_ENV" || echo "TURN_URLS=${TURN_URLS_VALUE}" >> "$BACKEND_ENV"

if [ -n "$PUBLIC_IP" ]; then
    COTURN_CONF="$COTURN_CONF" PUBLIC_IP="$PUBLIC_IP" PRIVATE_IP="$PRIVATE_IP" python3 - <<'PY'
import os, pathlib, re
path = os.environ["COTURN_CONF"]
public_ip = os.environ["PUBLIC_IP"]
private_ip = os.environ.get("PRIVATE_IP", "").strip()
value = f"{public_ip}/{private_ip}" if private_ip else public_ip
text = pathlib.Path(path).read_text()
if re.search(r"^external-ip=", text, flags=re.M):
    text = re.sub(r"^external-ip=.*$", f"external-ip={value}", text, flags=re.M)
elif re.search(r"^#\s*external-ip=", text, flags=re.M):
    text = re.sub(r"^#\s*external-ip=.*$", f"external-ip={value}", text, flags=re.M)
else:
    text = text.rstrip() + f"\nexternal-ip={value}\n"
pathlib.Path(path).write_text(text)
PY
fi

if [ -f "$UPDATE_TURN_SCRIPT" ]; then
    chmod +x "$UPDATE_TURN_SCRIPT" || true
fi

if [ -f "$NGINX_RENEW_HOOK" ]; then
    chmod +x "$NGINX_RENEW_HOOK" || true
fi

if [ -f "$COTURN_RENEW_HOOK" ]; then
    chmod +x "$COTURN_RENEW_HOOK" || true
fi

# 9. FINAL STEP: START EVERYTHING
echo "=============================================="
echo " Starting Optimized Sequential Deployment"
echo "=============================================="

# 1. Stop everything and clean up orphaned resources
echo "Stopping all services..."
docker compose down --remove-orphans
stop_all_running_containers

# 2. Pull pre-built images first (Redis, Coturn, Certbot)
# This avoids CPU spikes from simultaneous downloads and builds
echo "Pulling pre-built images (Redis, Coturn, Certbot)..."
docker compose pull redis coturn certbot

# 3. Build the Docker Socket Proxy
echo "Building Docker Socket Proxy..."
docker compose build docker-socket-proxy

# 4. Build the Backend (App)
echo "Building Backend (App)..."
docker compose build app

# 5. Short pause to let the Raspberry Pi breathe
sleep 5

# 6. Build the Dashboard
echo "Building Dashboard..."
docker compose build dashboard

# 7. Short pause before the frontend/nginx build
sleep 2

# 8. Build the Frontend + Nginx
# This is the most RAM-intensive part (Vite compilation)
echo "Building Frontend & Nginx... (Sequential mode)"
docker compose build nginx

# 9. Apply firewall (UFW) rules before starting services
if yesno "Apply firewall (UFW) rules now?" "y"; then
    if command -v ufw >/dev/null 2>&1; then
        echo "Configuring UFW rules..."
        ufw allow 80/tcp
        ufw allow 443/tcp
        ufw allow 3478/tcp
        ufw allow 3478/udp
        ufw allow 5349/tcp
        ufw allow 49152:50000/udp

        if ! ufw status | grep -q "Status: active"; then
            ufw --force enable
        fi
    else
        echo "UFW not found. Skipping firewall configuration."
    fi
fi

# 10. Start services one by one to prevent RAM exhaustion
echo "Starting services in order..."
sudo docker compose up -d redis           # Start database first
sleep 5
sudo docker compose up -d docker-socket-proxy  # Start metadata proxy before backend
sleep 2
sudo docker compose up -d app             # Start backend
sleep 2
sudo docker compose up -d dashboard       # Start dashboard UI
sleep 2
sudo docker compose up -d coturn certbot  # Start support services
sleep 2
sudo docker compose up -d nginx           # Start proxy last

# =================================================
# 11. POST-INSTALLATION
# =================================================
if yesno "Install cron job to keep TURN external-ip updated?" "y"; then
    CRON_SCHEDULE="$(prompt "Cron schedule" "*/10 * * * *")"
    install_turn_cron "$CRON_SCHEDULE"
fi

echo ""
echo "############################################################"
echo "  Setup complete."
echo "  Backend env: $BACKEND_ENV"
echo "  Frontend env: $FRONTEND_ENV"
echo "  Nginx conf: $NGINX_CONF"
echo "  Coturn conf: $COTURN_CONF"
echo "  DONE! Your project is running at: https://${DOMAIN}"
echo "############################################################"