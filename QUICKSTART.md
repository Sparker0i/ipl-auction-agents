# Quick Start Guide

Get the IPL Auction Platform running in 5 minutes.

## Prerequisites

- Node.js 20+ installed
- Docker & Docker Compose installed
- pnpm installed (`npm install -g pnpm`)

## Setup (First Time)

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres & Redis
docker-compose up -d postgres redis

# 3. Wait for services to be ready (10 seconds)
sleep 10

# 4. Setup database
pnpm db:generate  # Generate Prisma client
pnpm db:migrate   # Create tables
pnpm db:seed      # Load 574 players

# Expected output:
# ✅ Inserted 574 players
# 📊 Total Players: 574
```

## Run Development

```bash
# Start both frontend & backend
pnpm dev
```

Open browser:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000/api/health

## Database Management

```bash
# View data in browser
pnpm db:studio

# Re-seed database
pnpm db:seed

# Reset database
pnpm --filter backend prisma migrate reset
```

## Docker (Full Stack)

```bash
# Start everything with Docker
docker-compose up -d

# View logs
docker-compose logs -f backend

# Stop all
docker-compose down
```

Access via http://localhost:80

## Troubleshooting

**"Connection refused" errors:**
```bash
# Check if services are running
docker-compose ps

# Restart services
docker-compose restart postgres redis
```

**"Prisma Client not generated":**
```bash
pnpm db:generate
```

**Port already in use:**
```bash
# Change ports in .env files
# Backend: apps/backend/.env (PORT=4000)
# Frontend: apps/frontend/.env (VITE_API_URL)
```

## Next Steps

Phase 1 is complete. Ready to implement:
- Auction creation & joining
- Real-time bidding engine
- Team dashboard
- Admin controls

See `README.md` for full documentation.
