# Docker Setup Documentation

## Multi-Stage Dockerfile Architecture

Both backend and frontend use **multi-stage builds** with separate targets for development and production.

### Build Stages

#### Backend Stages
1. **base** - Common Node.js + pnpm setup with OpenSSL 3.x
2. **deps** - Install all dependencies (dev + prod)
3. **builder** - Compile TypeScript → JavaScript
4. **production** - Optimized runtime with prod deps only
5. **development** - Full dev environment with hot-reload

#### Frontend Stages
1. **base** - Common Node.js + pnpm setup
2. **deps** - Install all dependencies (dev + prod)
3. **builder** - Build static assets (Vite)
4. **production** - Nginx serving static files
5. **development** - Vite dev server with HMR

## Development vs Production

### Development Mode (Current)
```bash
# Start development environment
docker compose up --build

# Services run with:
# - Hot-reload enabled
# - Dev dependencies included
# - Source maps available
# - Larger image sizes (~400MB)
```

**Development Features:**
- ✅ Hot module replacement (HMR)
- ✅ TypeScript source files
- ✅ Dev tools and debuggers
- ✅ Fast iteration cycles
- ❌ Not optimized for performance
- ❌ Larger image sizes

### Production Mode
```bash
# Build and run production images
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build

# Services run with:
# - Compiled/optimized code
# - Production dependencies only
# - Smaller image sizes (~150MB)
# - Better performance
```

**Production Features:**
- ✅ Compiled JavaScript (no TypeScript overhead)
- ✅ Tree-shaken and minified bundles
- ✅ Production dependencies only
- ✅ Smaller image sizes (50% reduction)
- ✅ Better startup time and runtime performance
- ✅ Restart policies for high availability
- ❌ No hot-reload (rebuild required for changes)

## Image Size Comparison

| Service | Development | Production | Savings |
|---------|-------------|------------|---------|
| Backend | ~380MB | ~180MB | 53% |
| Frontend | ~420MB | ~25MB (nginx) | 94% |

## Commands

### Development
```bash
# Start dev environment
docker compose up -d

# View logs
docker compose logs -f backend frontend

# Rebuild after dependency changes
docker compose up --build backend

# Stop all services
docker compose down
```

### Production
```bash
# Build production images
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

# Start production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Check health
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

### Environment Variables

Create `.env` file for production:
```bash
# Database
POSTGRES_USER=ipl_user
POSTGRES_PASSWORD=super_secure_password_here
POSTGRES_DB=ipl_auction

# Redis
REDIS_PASSWORD=another_secure_password

# Backend
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com
JWT_SECRET=your_jwt_secret

# Frontend
VITE_API_URL=https://api.yourdomain.com
```

## Why Multi-Stage Builds?

### Security
- Production images don't contain dev tools or build artifacts
- Smaller attack surface
- No TypeScript compiler or dev dependencies in production

### Performance
- Compiled JavaScript runs faster than TypeScript + ts-node
- Smaller images = faster pulls and deployments
- Production-only dependencies reduce memory footprint

### Cost Efficiency
- 50-90% smaller images save storage and bandwidth
- Faster cold starts in cloud environments
- Lower resource consumption = lower costs

## Switching Between Modes

The `target` parameter in docker-compose.yml controls which stage is used:

```yaml
backend:
  build:
    target: development  # or 'production'
```

**Current Setup:** Development mode is active for local work with hot-reload.

**For Deployment:** Use `docker-compose.prod.yml` which overrides to production targets.

## Troubleshooting

### Backend won't start
```bash
# Check if Prisma Client is generated
docker compose exec backend ls -la node_modules/.prisma/client

# Regenerate if missing
docker compose exec backend pnpm prisma generate
```

### Frontend build fails
```bash
# Check Vite config
docker compose exec frontend cat apps/frontend/vite.config.ts

# Build locally first
pnpm --filter frontend build
```

### OpenSSL errors (Alpine only)
- Switched to Debian Slim base image
- OpenSSL 3.x is included
- No EOL software dependencies

## Best Practices

1. **Development**: Use `docker-compose.yml` with development target
2. **Staging/Prod**: Use `docker-compose.prod.yml` overlay
3. **Environment Variables**: Never commit secrets, use `.env` files
4. **Image Tags**: Tag production images with version numbers
5. **Health Checks**: Always verify services are healthy before deployment
6. **Secrets Management**: Use Docker secrets or external vaults for production
