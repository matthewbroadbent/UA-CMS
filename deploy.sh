#!/bin/bash

# UA CMS Production Deployment Script
# Usage: ./deploy.sh

echo "🚀 Starting UA CMS Deployment..."

# 1. Pull latest code
echo "📦 Pulling latest changes from GitHub..."
git pull origin main

# 2. Build and restart containers
echo "🏗️ Rebuilding containers..."
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# 3. Database Sync
echo "🔄 Syncing database schema..."
docker exec ua-cms-app-1 npx prisma db push

# 4. Prune old images
echo "🧹 Cleaning up old Docker images..."
docker image prune -f

echo "✅ Deployment Complete! App running at port 3000."
