#!/bin/bash

# IPL Auction Platform - Quick Start Script
# This script sets up and starts the entire platform for testing

set -e  # Exit on error

echo "🏏 IPL Auction Platform - Quick Start"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running from project root
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Please run this script from the project root directory${NC}"
    exit 1
fi

# Step 1: Check prerequisites
echo -e "${BLUE}📋 Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}⚠️  pnpm is not installed. Installing globally...${NC}"
    npm install -g pnpm
fi

echo -e "${GREEN}✅ All prerequisites met${NC}"
echo ""

# Step 2: Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
pnpm install
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Step 3: Start Docker services
echo -e "${BLUE}🐳 Starting PostgreSQL and Redis...${NC}"
docker-compose up -d postgres redis

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be ready...${NC}"
sleep 5

# Check PostgreSQL health
until docker exec ipl-postgres pg_isready -U ipl_user -d ipl_auction &> /dev/null; do
    echo -e "${YELLOW}⏳ Waiting for PostgreSQL...${NC}"
    sleep 2
done
echo -e "${GREEN}✅ PostgreSQL is ready${NC}"

# Check Redis health
until docker exec ipl-redis redis-cli ping &> /dev/null; do
    echo -e "${YELLOW}⏳ Waiting for Redis...${NC}"
    sleep 2
done
echo -e "${GREEN}✅ Redis is ready${NC}"
echo ""

# Step 4: Setup backend
echo -e "${BLUE}⚙️  Setting up backend...${NC}"
cd apps/backend

# Copy .env.example if .env doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env file from .env.example...${NC}"
    cp .env.example .env
    # Update PORT to 3001 (to match frontend expectations)
    sed -i 's/PORT=4000/PORT=3001/' .env
    # Update CORS_ORIGIN to match Vite default
    sed -i 's|CORS_ORIGIN="http://localhost:3000"|CORS_ORIGIN="http://localhost:5173"|' .env
fi

# Generate Prisma client
echo -e "${BLUE}🔧 Generating Prisma client...${NC}"
pnpm prisma generate

# Run migrations
echo -e "${BLUE}🔄 Running database migrations...${NC}"
pnpm prisma migrate dev --name init

# Seed database
echo -e "${BLUE}🌱 Seeding database with IPL teams and players...${NC}"
pnpm prisma db seed

echo -e "${GREEN}✅ Backend setup complete${NC}"
cd ../..
echo ""

# Step 5: Setup frontend
echo -e "${BLUE}⚙️  Setting up frontend...${NC}"
cd apps/frontend

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating frontend .env file...${NC}"
    cat > .env << EOF
VITE_API_URL=http://localhost:3001/api
VITE_SOCKET_URL=http://localhost:3001
EOF
fi

echo -e "${GREEN}✅ Frontend setup complete${NC}"
cd ../..
echo ""

# Step 6: Provide start instructions
echo -e "${GREEN}🎉 Setup Complete!${NC}"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo ""
echo -e "1️⃣  Start Backend (Terminal 1):"
echo -e "   ${YELLOW}cd apps/backend && pnpm dev${NC}"
echo ""
echo -e "2️⃣  Start Frontend (Terminal 2):"
echo -e "   ${YELLOW}cd apps/frontend && pnpm dev${NC}"
echo ""
echo -e "3️⃣  Open Browser:"
echo -e "   ${YELLOW}http://localhost:5173${NC}"
echo ""
echo -e "${BLUE}📖 Testing Guide:${NC}"
echo -e "   See ${YELLOW}TESTING_GUIDE.md${NC} for complete testing instructions"
echo ""
echo -e "${BLUE}🔍 Verify Services:${NC}"
echo -e "   PostgreSQL: ${YELLOW}docker exec -it ipl-postgres psql -U ipl_user -d ipl_auction -c \"SELECT COUNT(*) FROM \\\"Player\\\";\"${NC}"
echo -e "   Redis: ${YELLOW}docker exec -it ipl-redis redis-cli ping${NC}"
echo -e "   Backend: ${YELLOW}curl http://localhost:3001/api/health${NC} (after starting backend)"
echo ""
echo -e "${GREEN}Happy Testing! 🏏${NC}"
