# Production Deployment Guide

## Quick Summary

**Current State**: Docker Compose is configured with multi-stage builds supporting both development and production modes.

**Key Changes Made**:
- ✅ Multi-stage Dockerfiles (dev + production targets)
- ✅ Debian Slim base (OpenSSL 3.x, no EOL dependencies)
- ✅ Production optimizations (compiled code, prod deps only)
- ✅ Separate compose files for dev vs prod
- ✅ Rootless Podman compatible

## Deployment Options

### Option 1: Docker Compose (Simple)

**Best for**: Small deployments, single-server setups

```bash
# 1. Set environment variables
cp .env.example .env
vim .env  # Configure production values

# 2. Build and deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 3. Run migrations
docker compose exec backend pnpm prisma migrate deploy

# 4. Verify
docker compose ps
docker compose logs -f
```

### Option 2: Docker Swarm (Orchestrated)

**Best for**: Multi-node deployments, high availability

```bash
# 1. Initialize swarm
docker swarm init

# 2. Deploy stack
docker stack deploy -c docker-compose.yml -c docker-compose.prod.yml ipl-auction

# 3. Scale services
docker service scale ipl-auction_backend=3
docker service scale ipl-auction_frontend=2

# 4. Monitor
docker service ls
docker stack ps ipl-auction
```

### Option 3: Kubernetes (Enterprise)

**Best for**: Large scale, cloud-native deployments

```bash
# Convert to Kubernetes manifests
kompose convert -f docker-compose.prod.yml

# Apply to cluster
kubectl apply -f k8s/

# Or use Helm chart (recommended)
helm install ipl-auction ./charts/ipl-auction
```

## Pre-Deployment Checklist

### Security
- [ ] Change all default passwords in `.env`
- [ ] Use strong secrets (min 32 characters)
- [ ] Enable HTTPS/TLS certificates
- [ ] Configure CORS origins properly
- [ ] Set up firewall rules
- [ ] Disable unnecessary ports
- [ ] Review and update nginx security headers

### Database
- [ ] Backup strategy configured
- [ ] Run migrations with `prisma migrate deploy`
- [ ] Set connection pool limits
- [ ] Enable PostgreSQL SSL if remote
- [ ] Configure automated backups

### Monitoring
- [ ] Health check endpoints working
- [ ] Logging configured (stdout/files)
- [ ] Metrics collection (Prometheus/Grafana)
- [ ] Error tracking (Sentry/similar)
- [ ] Uptime monitoring

### Performance
- [ ] CDN configured for frontend assets
- [ ] Redis persistence enabled
- [ ] Database indexes reviewed
- [ ] Resource limits set (CPU/memory)
- [ ] Load balancer configured

## Environment Variables Reference

### Required Production Variables

```bash
# Database
POSTGRES_USER=ipl_user
POSTGRES_PASSWORD=<min-32-char-secure-password>
POSTGRES_DB=ipl_auction

# Redis
REDIS_PASSWORD=<min-32-char-secure-password>

# Backend
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://yourdomain.com
JWT_SECRET=<min-64-char-secret>
JWT_EXPIRATION=7d

# Database URLs (auto-generated from above)
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public

# Frontend
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=wss://api.yourdomain.com

# Optional
LOG_LEVEL=info
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=15m
```

## Deployment Steps

### 1. Build Production Images

```bash
# Build all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# Tag images with version
docker tag iplauctionagentic-backend:latest iplauctionagentic-backend:v1.0.0
docker tag iplauctionagentic-frontend:latest iplauctionagentic-frontend:v1.0.0

# Push to registry (if using)
docker push your-registry/iplauctionagentic-backend:v1.0.0
docker push your-registry/iplauctionagentic-frontend:v1.0.0
```

### 2. Database Setup

```bash
# Start database first
docker compose -f docker-compose.prod.yml up -d postgres redis

# Wait for healthy status
docker compose ps

# Run migrations
docker compose exec backend pnpm prisma migrate deploy

# Seed data (if needed)
docker compose exec backend pnpm --filter backend seed
```

### 3. Deploy Application

```bash
# Start backend
docker compose -f docker-compose.prod.yml up -d backend

# Verify backend health
curl http://localhost:4000/health

# Start frontend
docker compose -f docker-compose.prod.yml up -d frontend

# Start nginx proxy
docker compose -f docker-compose.prod.yml up -d nginx
```

### 4. Verify Deployment

```bash
# Check all services running
docker compose ps

# Check logs for errors
docker compose logs --tail=50

# Test endpoints
curl http://localhost:4000/api/health
curl http://localhost:3000

# Check database connection
docker compose exec backend pnpm prisma db status
```

## Rollback Procedure

```bash
# 1. Stop current version
docker compose -f docker-compose.prod.yml down

# 2. Restore previous version
docker tag iplauctionagentic-backend:v1.0.0 iplauctionagentic-backend:latest
docker tag iplauctionagentic-frontend:v1.0.0 iplauctionagentic-frontend:latest

# 3. Rollback migrations (if needed)
docker compose exec backend pnpm prisma migrate resolve --rolled-back <migration_name>

# 4. Restart services
docker compose -f docker-compose.prod.yml up -d
```

## Performance Tuning

### Backend
```yaml
# docker-compose.prod.yml
backend:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '1'
        memory: 1G
  environment:
    NODE_OPTIONS: "--max-old-space-size=1536"
```

### PostgreSQL
```yaml
postgres:
  environment:
    POSTGRES_SHARED_BUFFERS: 256MB
    POSTGRES_EFFECTIVE_CACHE_SIZE: 1GB
    POSTGRES_MAX_CONNECTIONS: 100
```

### Redis
```yaml
redis:
  command: >
    redis-server
    --maxmemory 512mb
    --maxmemory-policy allkeys-lru
    --requirepass ${REDIS_PASSWORD}
```

## Monitoring

### Health Checks

```bash
# Backend
curl http://localhost:4000/health

# Database
docker compose exec postgres pg_isready -U ipl_user

# Redis
docker compose exec redis redis-cli ping
```

### Logs

```bash
# View all logs
docker compose logs -f

# Specific service
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100 backend

# Save to file
docker compose logs --no-color > deployment.log
```

## Troubleshooting

### Backend Won't Start
```bash
# Check Prisma Client
docker compose exec backend ls -la node_modules/.prisma/client

# Regenerate if missing
docker compose exec backend pnpm prisma generate

# Check environment
docker compose exec backend env | grep DATABASE
```

### Database Connection Issues
```bash
# Check network
docker network ls
docker network inspect iplauctionagentic_default

# Test connection
docker compose exec backend psql $DATABASE_URL -c "SELECT 1;"
```

### High Memory Usage
```bash
# Check resource usage
docker stats

# Set limits in docker-compose.prod.yml
deploy:
  resources:
    limits:
      memory: 1G
```

## Production Best Practices

1. **Never use default passwords** - Always generate strong secrets
2. **Enable HTTPS** - Use Let's Encrypt or cloud provider certificates
3. **Set up monitoring** - Prometheus + Grafana or cloud monitoring
4. **Automated backups** - Daily database backups with retention policy
5. **Resource limits** - Set CPU and memory limits for all services
6. **Health checks** - Configure liveness and readiness probes
7. **Secrets management** - Use Docker secrets or external vault
8. **Log rotation** - Configure log rotation to prevent disk fill
9. **Security updates** - Regular base image updates
10. **Disaster recovery** - Tested backup and restore procedures

## Support

For issues or questions:
- Documentation: [./infrastructure/docker/README.md](./infrastructure/docker/README.md)
- Backend docs: [./apps/backend/README.md](./apps/backend/README.md)
- Frontend docs: [./apps/frontend/README.md](./apps/frontend/README.md)
