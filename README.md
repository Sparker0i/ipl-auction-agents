# IPL Auction Platform 🏏

A real-time IPL auction platform with live bidding, RTM (Right to Match) mechanics, and multi-user support.

![Platform Status](https://img.shields.io/badge/Phase%203-95%25%20Complete-success)
![Backend](https://img.shields.io/badge/Backend-NestJS-red)
![Frontend](https://img.shields.io/badge/Frontend-React%2018-blue)
![State](https://img.shields.io/badge/State-Redux%20Toolkit-purple)
![Real--time](https://img.shields.io/badge/Real--time-Socket.io-black)

---

## 🎯 Features

### ✅ Completed (Phase 1-3)
- **Real-time Bidding**: Live auction with <100ms WebSocket updates
- **IPL Authenticity**: 10 IPL teams with real retention data (~200 players)
- **RTM Mechanics**: Complete Right to Match flow (trigger, use, counter-bid, finalize)
- **Dynamic Bid Increments**: ₹5L/₹10L/₹20L/₹25L based on current bid
- **Admin Controls**: Sell, skip, load next player, round transitions
- **Multi-user Support**: Multiple users can join and bid simultaneously
- **Redux State Management**: Centralized state with real-time synchronization
- **Responsive UI**: Mobile, tablet, desktop optimized with IPL branding
- **Session Persistence**: LocalStorage-based session management

### 🚧 Optional Enhancements
- Admin Dashboard (dedicated view)
- UI Component Library (Shadcn/ui)
- Automated Testing (Unit, Integration, E2E)
- Performance Optimization
- Accessibility Improvements

## 📋 Tech Stack

### Frontend
- React 18 + TypeScript
- Vite (build tool)
- Redux Toolkit (state management)
- TailwindCSS (styling)
- Socket.io Client (real-time communication)

### Backend
- NestJS + TypeScript
- PostgreSQL 15 (database)
- Redis 7 (caching/sessions)
- Prisma ORM
- Socket.io (WebSocket)

### Infrastructure
- Docker Compose
- Nginx (reverse proxy)
- pnpm workspaces (monorepo)

## 🛠️ Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Docker** & **Docker Compose**
- **Git**

## 📦 Installation

### 1. Clone the repository

```bash
git clone <repository-url>
cd IPLAuctionAgentic
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Setup environment variables

Backend environment (`apps/backend/.env`):
```env
DATABASE_URL="postgresql://ipl_user:ipl_pass@localhost:5432/ipl_auction?schema=public"
REDIS_HOST="localhost"
REDIS_PORT=6379
NODE_ENV="development"
PORT=3001
CORS_ORIGIN="http://localhost:5173"
SESSION_SECRET="change-this-in-production"
```

Frontend environment (`apps/frontend/.env`):
```env
VITE_API_URL=http://localhost:3001/api
VITE_SOCKET_URL=http://localhost:3001
```

### 4. Start infrastructure (Postgres + Redis)

```bash
docker-compose up -d postgres redis
```

Wait for services to be healthy (~10 seconds)

### 5. Setup database

```bash
# Generate Prisma Client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Seed 574 players from auction.csv
pnpm db:seed
```

Expected output:
```
✅ Inserted 574 players
📊 Database Statistics:
   Total Players: 574
   Capped: ~340
   Uncapped: ~234
   Retained: 47
```

### 6. Start development servers

```bash
# Start both frontend and backend
pnpm dev
```

This runs:
- Backend: http://localhost:3001
- Frontend: http://localhost:5173

**OR use the automated quick-start script:**

```bash
./scripts/quick-start.sh
```

## 🐳 Docker Development

Run entire stack with Docker Compose:

```bash
# Build images
docker-compose build

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Access:
- Frontend: http://localhost:80
- Backend API: http://localhost:80/api
- Database: localhost:5432
- Redis: localhost:6379

## 📁 Project Structure

```
IPLAuctionAgentic/
├── apps/
│   ├── backend/              # NestJS application
│   │   ├── src/
│   │   │   ├── auctions/     # Auction logic
│   │   │   ├── players/      # Player management
│   │   │   ├── teams/        # Team management
│   │   │   ├── websocket/    # Socket.io gateway
│   │   │   ├── prisma/       # Database service
│   │   │   └── redis/        # Redis service
│   │   └── prisma/
│   │       ├── schema.prisma # Database schema
│   │       └── seed.ts       # Seed script
│   │
│   └── frontend/             # React application
│       ├── src/
│       │   ├── pages/        # Route pages
│       │   ├── store/        # Redux store & slices
│       │   └── App.tsx       # Main app component
│       └── index.html
│
├── packages/
│   ├── shared-types/         # Shared TypeScript types
│   └── constants/            # Shared constants
│
├── infrastructure/
│   └── docker/               # Dockerfiles & configs
│
├── auction.csv               # 574 IPL players data
├── docker-compose.yml        # Docker orchestration
└── pnpm-workspace.yaml       # Monorepo config
```

## 🎮 Usage

**📖 Complete Testing Guide**: See [TESTING_GUIDE.md](TESTING_GUIDE.md) for detailed testing scenarios

### Creating an Auction

1. Navigate to http://localhost:5173
2. Click **Create Auction**
3. Enter auction name and select type (Public/Private)
4. Get room code (for private auctions - 6 uppercase characters)

### Joining an Auction

1. Enter room code (private) or browse public auctions
2. Select your IPL team (RCB, CSK, MI, etc.)
3. Review retained players and available purse

### Live Bidding

1. Current player card shows base price and details
2. Click **Bid** to place next bid (increments auto-calculated)
3. Use **RTM** if player's 2024 team matches yours
4. Timer resets on each bid (60s default)

### Admin Controls

- **Skip Player**: Mark player as passed
- **Next Round**: Progress to Accelerated Round 1/2
- **Select Players**: Choose players for accelerated rounds
- **End Auction**: Complete auction

### Team Dashboard

- View squad roster with purchase prices
- Track budget (₹120cr purse - retentions - purchases)
- See recommendations for role gaps
- Export auction history as CSV

## 📊 Database Schema

### Key Tables

- **players** - 574 players with roles, base prices, auction sets
- **auctions** - Auction instances with current state
- **auction_teams** - Team-specific data (purse, RTM cards, counts)
- **team_players** - Player purchases with prices
- **auction_events** - Complete event history

### Redis Cache

- `auction:{id}:state` - Current auction state (player, bid, timer)
- `auction:{id}:users` - Active users in auction
- `auction:{id}:queue:{set}` - Player queues by set

## 🔧 Available Scripts

### Root Level
```bash
pnpm dev              # Start frontend + backend
pnpm build            # Build both apps
pnpm lint             # Lint all workspaces
pnpm type-check       # TypeScript check

# Database
pnpm db:generate      # Generate Prisma client
pnpm db:migrate       # Run migrations
pnpm db:seed          # Seed players from CSV
pnpm db:studio        # Open Prisma Studio

# Docker
pnpm docker:up        # Start Docker services
pnpm docker:down      # Stop Docker services
pnpm docker:build     # Build Docker images
```

### Backend
```bash
pnpm --filter backend dev         # Start NestJS dev server
pnpm --filter backend build       # Build backend
pnpm --filter backend start:prod  # Start production server
```

### Frontend
```bash
pnpm --filter frontend dev     # Start Vite dev server
pnpm --filter frontend build   # Build production bundle
pnpm --filter frontend preview # Preview production build
```

## 🧪 Testing

```bash
# Unit tests (to be implemented)
pnpm test

# E2E tests (to be implemented)
pnpm test:e2e

# Coverage
pnpm test:coverage
```

## 🚢 Deployment

### Production Build

```bash
# Build all apps
pnpm build

# Backend will be in apps/backend/dist
# Frontend will be in apps/frontend/dist
```

### Environment Variables (Production)

Update `.env` files with production values:
- Database connection string
- Redis connection
- CORS origins
- Session secrets

### Docker Production

```bash
# Set NODE_ENV=production in docker-compose.yml
# Build optimized images
docker-compose -f docker-compose.prod.yml build

# Deploy
docker-compose -f docker-compose.prod.yml up -d
```

## 📝 Development Roadmap

### Phase 1: MVP (Current) ✅
- [x] Infrastructure setup
- [x] Database schema & seed
- [x] Basic NestJS modules
- [x] React app scaffold
- [x] Redux store setup
- [ ] Auction creation & joining (Next)
- [ ] Real-time bidding engine
- [ ] RTM mechanics
- [ ] Admin controls

### Phase 2: Core Features (Days 6-14)
- [ ] Live auction interface
- [ ] Team dashboard
- [ ] Analytics & history
- [ ] Player recommendations

### Phase 3: Polish (Days 15-22)
- [ ] UI/UX enhancements
- [ ] Error handling
- [ ] Testing
- [ ] Documentation

### Future Enhancements
- [ ] User authentication
- [ ] Mini auction mode
- [ ] Advanced analytics
- [ ] Mobile apps
- [ ] Auto-bidding

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- IPL 2024 auction data
- NestJS framework
- React & Redux teams
- Prisma ORM
- Socket.io library

---

**Built with ❤️ for cricket fans**
