# IPL Auction AI Agent System

AI-powered autonomous agents that participate in IPL auction simulations using browser automation, LLM decision-making, and team-specific strategies.

## Overview

This system creates 10 AI agents (one for each IPL team) that autonomously participate in live auctions:

- **Browser Automation**: Playwright-powered agents join auction rooms and place bids
- **LLM Decision Making**: Ollama (llama3.1:8b) evaluates players and determines bid strategies
- **Team Strategies**: Each team has unique philosophy, risk tolerance, and priorities
- **Multi-Agent Orchestration**: 9 agents run concurrently with health monitoring
- **Performance Monitoring**: Comprehensive logging, metrics, and replay capabilities

## Quick Start

### Prerequisites

- Node.js 20+ and npm
- Ollama with llama3.1:8b model
- PostgreSQL database (for player stats)

### Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Initialize database
npx prisma generate
npx prisma migrate dev

# Process historical match data
npm run process-data
```

### Start Ollama

```bash
# Install Ollama (if not already)
curl -fsSL https://ollama.com/install.sh | sh

# Pull model
ollama pull llama3.1:8b

# Start server
ollama serve
# Runs on http://localhost:11434
```

### Run Auction

```bash
# Start orchestrator with auction code
npm run dev ABCD12

# The system will:
# 1. Spawn 9 agent processes (CSK, MI, RCB, DC, PBKS, RR, KKR, LSG, SRH, GT)
# 2. Each agent opens browser and joins auction
# 3. Agents make autonomous decisions throughout auction
# 4. Logs and metrics collected in real-time
```

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Orchestrator                              │
│  - Spawns 9 agent processes                                  │
│  - Health monitoring (10s heartbeats)                        │
│  - Agent restart on failures                                 │
│  - Log aggregation                                           │
└──────────────┬──────────────────────────────────────────────┘
               │
     ┌─────────┴─────────┐
     │                   │
┌────▼────┐         ┌────▼────┐
│ Agent 1 │   ...   │ Agent 9 │
│  (CSK)  │         │  (GT)   │
└────┬────┘         └────┬────┘
     │                   │
     │  Each Agent:      │
     │  ┌─────────────────────────────┐
     │  │ Browser Controller          │
     │  │ State Manager               │
     │  │ Decision Engine             │
     │  │   - LLM Client              │
     │  │   - Budget Manager          │
     │  │   - Squad Optimizer         │
     │  │   - Stats Engine            │
     │  │ Error Recovery              │
     │  └─────────────────────────────┘
```

## Core Components

### 1. Agent Core ([src/agent/](src/agent/))

- **agent.ts**: Main AuctionAgent class orchestrating all functionality
- **browser-controller.ts**: Playwright browser automation wrapper
- **state-manager.ts**: Auction state synchronization (WebSocket + DOM)
- **error-recovery.ts**: Browser crash and socket disconnect handling

### 2. Strategy Engine ([src/strategy/](src/strategy/))

- **team-strategies.ts**: 10 distinct team profiles with unique philosophies
- **decision-engine.ts**: LLM-powered bidding decisions with fallback logic
- **budget-manager.ts**: Dynamic budget allocation (early/mid/late phases)
- **squad-optimizer.ts**: Role distribution analysis and gap identification

### 3. LLM Integration ([src/llm/](src/llm/))

- **ollama-client.ts**: Ollama API client with timeout handling
- **prompt-builder.ts**: Context-rich prompts (800-1200 words)

### 4. Data Layer ([src/data/](src/data/))

- **stats-engine.ts**: Player quality evaluation from historical stats
- **prisma-database.ts**: Database abstraction layer

### 5. Orchestrator ([src/orchestrator/](src/orchestrator/))

- **agent-spawner.ts**: Child process management and lifecycle
- **agent-worker.ts**: Worker script for agent processes
- **health-monitor.ts**: Heartbeat monitoring and health checks

### 6. Monitoring ([src/monitoring/](src/monitoring/))

- **performance-profiler.ts**: Real-time metrics collection
- **auction-replay.ts**: Log parsing and timeline reconstruction

## Team Strategies

Each team has a distinct bidding personality:

| Team | Aggression | Risk | Philosophy |
|------|------------|------|------------|
| CSK | Balanced | 0.6 | Experience matters - value solid performers |
| MI | Aggressive | 0.75 | Star power - willing to pay for marquee players |
| RCB | Aggressive | 0.9 | Entertainers - batting firepower at all costs |
| DC | Balanced | 0.65 | Youth movement - invest in potential |
| PBKS | Aggressive | 0.85 | Aggressive rebuilders - take calculated risks |
| RR | Conservative | 0.55 | Moneyball - find undervalued players |
| KKR | Balanced | 0.7 | Balanced winners - mystery spinners |
| LSG | Aggressive | 0.75 | New money - building identity |
| SRH | Balanced | 0.65 | Orange Army - bowling-first approach |
| GT | Conservative | 0.6 | Champions mentality - team chemistry |

## Configuration

### Environment Variables (.env)

```bash
# Node Environment
NODE_ENV=development

# Auction
AUCTION_FRONTEND_URL=http://localhost:5173
AUCTION_CODE=ABCD12

# Browser
AGENT_HEADLESS=false
BROWSER_SLOW_MO=100

# LLM
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
LLM_TEMPERATURE=0.3
LLM_TIMEOUT=5000

# Logging
LOG_LEVEL=info
LOG_DIRECTORY=./logs

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ipl_auction
```

### Config File ([config/default.json](config/default.json))

```json
{
  "orchestrator": {
    "maxConcurrentAgents": 9,
    "agentHealthCheckInterval": 10000,
    "agentRestartAttempts": 3
  },
  "browser": {
    "headless": false,
    "viewport": { "width": 1280, "height": 720 },
    "slowMo": 100,
    "timeout": 10000
  },
  "llm": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "llama3.1:8b",
    "temperature": 0.3,
    "timeout": 5000,
    "fallbackOnTimeout": true
  },
  "auction": {
    "frontendUrl": "http://localhost:5173",
    "bidDelayMs": 500,
    "stateCheckIntervalMs": 2000
  }
}
```

## Scripts

```bash
# Data Processing
npm run process-data          # Process historical match data into database

# Testing
npm run test-agent            # Test single agent functionality
npm run test-db               # Test database connectivity

# Auction
npm run dev <auction-code>    # Start orchestrator for auction

# Monitoring
npm run replay <auction-code> [--html]  # Generate auction replay report
npm run performance <data.json>         # Generate performance report

# Maintenance
npm run clean                 # Clean logs and temporary data
npm run build                 # Compile TypeScript
```

## Monitoring & Analysis

### Real-Time Logs

Logs are written to `logs/` directory with agent-specific files:

```
logs/
├── CSK-agent.log
├── MI-agent.log
├── orchestrator.log
└── combined.log
```

### Auction Replay

Reconstruct auction timeline from logs:

```bash
# Generate markdown report
npm run replay ABCD12

# Generate interactive HTML report
npm run replay ABCD12 --html

# Output: reports/auction-replay-ABCD12.md
#         reports/auction-replay-ABCD12.html
```

### Performance Reports

Analyze agent performance metrics:

```bash
npm run performance reports/profiler-ABCD12.json

# Output: reports/profiler-ABCD12-report.md
```

**Metrics Tracked:**
- Decision times (avg, min, max, P50, P95, P99)
- LLM success rate and timeouts
- Bids placed vs won
- Budget spent per team
- Browser crashes and agent restarts
- Memory and CPU usage

## Decision Making Flow

```
1. Player Presented
   ↓
2. State Synchronization
   - Budget check (>29L minimum)
   - Squad size check (<25 max)
   - Overseas check (<8 max)
   ↓
3. Player Stats Retrieval
   - Historical T20 performance (2015-2025)
   - Quality rating (0-10)
   - Venue bonus calculation
   - Form trend analysis
   ↓
4. Squad Analysis
   - Current composition
   - Role gaps identification
   - Priority scoring
   ↓
5. LLM Decision (5s timeout)
   - Context-rich prompt with team philosophy
   - Player stats and quality assessment
   - Squad needs and budget status
   - Returns: bid/pass + max amount + reasoning
   ↓
6. Fallback Logic (if LLM fails)
   - Role need assessment
   - Affordable bid calculation
   - Conservative approach
   ↓
7. Budget Validation
   - Apply max bid limits
   - Reserve budget for remaining slots
   - Team-specific constraints
   ↓
8. Bid Placement (if decision: bid)
   - Click bid button via Playwright
   - Log decision and reasoning
   - Update internal state
```

## Error Handling

### Browser Crashes
- Automatic detection via Playwright events
- Up to 3 restart attempts with exponential backoff
- State restoration from last known state

### LLM Timeouts
- 5-second timeout on LLM queries
- Automatic fallback to rule-based decisions
- Decisions still made within response window

### Agent Failures
- Heartbeat monitoring (10s intervals)
- 30s timeout for heartbeat detection
- Automatic agent restart by orchestrator
- Process isolation prevents cascade failures

### Network Issues
- WebSocket reconnection logic
- DOM polling fallback for state sync
- Retry logic with exponential backoff

## Development

### Project Structure

```
apps/agent/
├── src/
│   ├── agent/           # Agent core components
│   ├── strategy/        # Strategy and decision engine
│   ├── llm/            # LLM integration
│   ├── data/           # Database and stats
│   ├── orchestrator/   # Multi-agent orchestration
│   ├── monitoring/     # Performance and replay
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Utilities (config, logger)
├── scripts/            # CLI scripts
├── config/             # Configuration files
├── logs/               # Runtime logs
├── reports/            # Generated reports
├── prisma/             # Database schema
└── package.json
```

### Adding a New Team Strategy

1. Update [src/strategy/team-strategies.ts](src/strategy/team-strategies.ts):

```typescript
const NEW_TEAM: TeamStrategy = {
  teamCode: 'NT',
  aggression: 'balanced',
  riskTolerance: 0.65,
  priorities: {
    experience: 0.7,
    youth: 0.6,
    starPower: 0.5,
    value: 0.8
  },
  roleDistribution: {
    WICKETKEEPER: 0.08,
    BATTER: 0.40,
    ALL_ROUNDER: 0.28,
    BOWLER: 0.24
  },
  specialRules: {
    maxBidPerPlayer: 2000,
    minExperienceForExpensive: 50,
    preferredVenues: ['Home Stadium']
  },
  retainedPlayers: [],
  philosophy: 'Your team philosophy here'
};
```

2. Update [config/default.json](config/default.json) teams array

3. Update orchestrator to spawn additional agent

### Custom Decision Logic

Extend DecisionEngine in [src/strategy/decision-engine.ts](src/strategy/decision-engine.ts):

```typescript
private async customEvaluation(
  player: PlayerInAuction,
  stats: PlayerStats
): Promise<number> {
  // Your custom logic here
  return qualityScore;
}
```

## Performance Benchmarks

**Decision Latency** (Target: <5s at P95)
- P50: ~2.5s
- P95: ~4.2s
- P99: ~4.8s

**LLM Performance**
- Success Rate: >95%
- Timeout Rate: <5%
- Cache Hit Rate: 30-50% (with caching)

**System Resources**
- Memory: ~800MB for 9 concurrent agents
- CPU: Minimal (I/O bound operations)

**Reliability**
- Browser Crash Rate: <1% per agent per auction
- Agent Restart Success: >98%
- Decision Success: 100% (with fallback)

## Troubleshooting

### Ollama Connection Failed
```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Verify model
ollama list
```

### Browser Launch Failed
```bash
# Install Playwright browsers
npx playwright install chromium

# Check browser executable path in config
```

### Database Connection Issues
```bash
# Check PostgreSQL is running
pg_isready

# Verify DATABASE_URL in .env
# Run migrations
npx prisma migrate dev
```

### Agent Not Bidding
- Check logs for decision reasoning
- Verify LLM is responding (check ollama serve logs)
- Ensure budget > 29L (minimum bid with reserve)
- Check squad size < 25 and overseas < 8

## Contributing

1. Follow existing code structure and patterns
2. Add TypeScript types for all new code
3. Write tests for new functionality
4. Update documentation for changes
5. Follow team strategy philosophy patterns

## License

MIT

## Acknowledgments

- Built with [Playwright](https://playwright.dev/) for browser automation
- [Ollama](https://ollama.com/) for local LLM inference
- [Winston](https://github.com/winstonjs/winston) for logging
- [Prisma](https://www.prisma.io/) for database management
