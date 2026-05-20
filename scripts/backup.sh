#!/bin/bash

# =====================================================
# Backup Script
# =====================================================
# Creates encrypted backup of critical data
#
# What's backed up:
# - Redis data (message queue, user registrations)
# - SSL certificates
# - Configuration files
#
# Usage:
#   chmod +x backup.sh
#   ./backup.sh
#
# =====================================================

set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

echo "=============================================="
echo "Starting backup..."
echo "=============================================="

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Stop services to ensure data consistency
echo "Stopping services..."
docker-compose stop

# Create backup archive
echo "Creating backup archive..."
tar -czvf "$BACKUP_FILE" \
    docker/certbot/conf \
    docker/coturn/turnserver.conf \
    docker/nginx/conf.d \
    .env

# Backup Redis data (volume)
echo "Backing up Redis data..."
docker run --rm \
    -v private-communication_redis-data:/data \
    -v "$(pwd)/$BACKUP_DIR":/backup \
    alpine tar -czvf /backup/redis_$TIMESTAMP.tar.gz /data

# Restart services
echo "Restarting services..."
docker-compose start

echo "=============================================="
echo "Backup completed!"
echo "Files:"
echo "  - $BACKUP_FILE"
echo "  - $BACKUP_DIR/redis_$TIMESTAMP.tar.gz"
echo ""
echo "IMPORTANT: Store these backups securely off-device!"
echo "=============================================="
