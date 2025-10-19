# Phase 2: Agent Core & Browser Automation

## Overview

Phase 2 implements the core agent infrastructure with Playwright browser automation, enabling agents to join auctions, monitor state, and place bids.

## Implementation Status

✅ **Completed Tasks:**

1. **Setup Playwright browser automation**
   - Installed Playwright dependency
   - Created `BrowserController` class with launch, navigate, and close methods
   - Implemented page interaction methods (click, type, evaluate)
   - Added console logging and error handling

2. **Implement agent initialization**
   - Created `AuctionAgent` main class
   - Implemented team selection logic
   - Added auction start waiting mechanism
   - Configured browser with proper viewport and settings

3. **Implement auction state monitoring**
   - WebSocket event listeners for player updates, bids, and sales
   - DOM polling fallback for state synchronization
   - Periodic state sync every 2 seconds
   - Event handlers for new players, bid updates, and player sold

4. **Implement bid placement logic**
   - Bid button detection and clicking
   - Disabled state checking
   - Configurable bid delay to avoid race conditions
   - Comprehensive logging

5. **Implement state synchronization**
   - Created `StateManager` class
   - Budget tracking and updates
   - Squad management (add players, check constraints)
   - Current player and bid tracking
   - Currency parsing (lakhs and crores)
   - Role distribution analysis
   - Overseas player quota management

6. **Implement error handling**
   - Created `ErrorRecovery` class
   - Browser crash recovery with retry logic
   - Socket disconnect handling
   - Navigation error handling
   - Configurable max retries (default: 3)
   - Exponential backoff for retries

7. **Create test script**
   - Interactive CLI test script (`scripts/test-agent.ts`)
   - Command-line argument support
   - Graceful shutdown handling
   - State monitoring and logging

## Directory Structure

```
apps/agent/
├── src/
│   ├── agent/
│   │   ├── index.ts              # Module exports
│   │   ├── agent.ts              # Main AuctionAgent class
│   │   ├── browser-controller.ts # Playwright automation
│   │   ├── state-manager.ts      # State tracking
│   │   └── error-recovery.ts     # Error handling
│   ├── utils/
│   │   ├── logger.ts             # Winston logger setup
│   │   └── config.ts             # Configuration management
│   └── types/
│       └── agent.types.ts        # TypeScript interfaces
├── scripts/
│   └── test-agent.ts             # Manual testing script
├── config/
│   └── default.json              # Default configuration
├── .env.example                  # Environment variables template
└── package.json                  # Updated with playwright dependency
```

## Key Components

### 1. AuctionAgent (agent.ts)

Main agent class that orchestrates all functionality:

- **Lifecycle**: `initialize()`, `cleanup()`
- **Team Selection**: `selectTeam()`
- **Auction Monitoring**: `monitorAuction()`, event handlers
- **Decision Making**: `makeDecision()` (simple rule-based for now)
- **Bid Placement**: `placeBid()`
- **State Management**: `getState()`, `updateBudget()`, `addToSquad()`

### 2. BrowserController (browser-controller.ts)

Handles all Playwright browser interactions:

- Browser launch with configurable headless mode
- Navigation with timeout handling
- Page interaction utilities (click, type, evaluate)
- Function exposure for page callbacks
- Console and error logging
- Screenshot capture for debugging

### 3. StateManager (state-manager.ts)

Manages agent's internal state and syncs with auction:

- Current player and bid tracking
- Budget management with constraint checking
- Squad management (25 player max, 8 overseas max)
- Role distribution analysis
- Currency parsing (₹725L, 7.25cr → lakhs)
- Affordability checks with minimum squad reserves

### 4. ErrorRecovery (error-recovery.ts)

Robust error handling and recovery:

- Browser crash detection and restart
- Socket disconnect recovery (30s timeout)
- Retryable error detection
- Exponential backoff for retries
- Operation wrapper with retry logic

## Configuration

### Environment Variables (.env)

```bash
NODE_ENV=development
AUCTION_FRONTEND_URL=http://localhost:5173
AUCTION_CODE=ABCD12
AGENT_HEADLESS=false
BROWSER_SLOW_MO=100
LOG_LEVEL=info
LOG_DIRECTORY=./logs
```

### Config File (config/default.json)

```json
{
  "browser": {
    "headless": false,
    "viewport": { "width": 1280, "height": 720 },
    "slowMo": 100,
    "timeout": 10000
  },
  "auction": {
    "frontendUrl": "http://localhost:5173",
    "bidDelayMs": 500,
    "stateCheckIntervalMs": 2000
  },
  "logging": {
    "level": "info",
    "directory": "./logs",
    "maxFileSize": "10MB",
    "maxFiles": 5
  }
}
```

## Testing

### Manual Test

```bash
# Interactive mode (prompts for inputs)
npm run test-agent

# Command-line mode
npm run test-agent -- --team CSK --code ABCD12
```

### Expected Behavior

1. Agent launches browser (visible by default)
2. Navigates to auction lobby
3. Selects specified team
4. Waits for auction to start
5. Monitors auction state
6. Makes simple bid decisions (base price + 20%)
7. Places bids when decision is positive
8. Logs all actions and decisions

## Simple Decision Logic (Phase 2)

For Phase 2, agents use basic rule-based decisions:

```typescript
// Budget constraint
if (budget <= 290L) return PASS;

// Squad size constraint
if (squadSize >= 25) return PASS;

// Overseas quota
if (player.isOverseas && overseasCount >= 8) return PASS;

// Simple bid: base price + 20%
maxBid = basePrice * 1.2;

// Affordability check (with minimum squad reserves)
if (canAfford(maxBid)) return BID(maxBid);
else return PASS;
```

**Note**: This will be replaced with LLM-powered decision-making in Phase 3.

## Integration Points

### Frontend Requirements

The agent expects the following from the frontend:

1. **Team Selection UI**:
   - `[data-team-selector]` element
   - Team buttons with `button:has-text("CSK")` or `[data-team="CSK"]`
   - `[data-auction-joined]` confirmation element

2. **Auction Status**:
   - `[data-auction-started]` element when auction begins

3. **Auction State** (via `window.__auctionState`):
   ```typescript
   {
     currentPlayer: PlayerInAuction,
     currentBid: number,
     currentBidder: string,
     myTeamPurse: number,
     mySquad: Player[],
     teamId: string
   }
   ```

4. **Events**:
   - `auction-player-update` - New player presented
   - `auction-bid-update` - Bid amount changed
   - `auction-player-sold` - Player sold to team

5. **Actions**:
   - `[data-bid-button]` - Bid button element

### State Synchronization

- **Primary**: WebSocket events from frontend
- **Fallback**: DOM polling every 2 seconds
- **Hybrid**: Both methods run simultaneously for reliability

## Logging

Logs are written to:
- Console (colored output)
- File: `logs/agents/{TEAM_CODE}.log`

### Log Levels

- **debug**: State sync, page evaluation
- **info**: Decisions, bids, player updates
- **warn**: Recoverable errors, retries
- **error**: Critical failures, crashes

### Sample Logs

```json
{
  "timestamp": "2025-10-18 18:45:23.456",
  "level": "info",
  "message": "Decision: BID",
  "agent": "CSK",
  "maxBid": 240,
  "player": "Shreyas Iyer"
}
```

## Acceptance Criteria

✅ All criteria met:

- [x] Agent successfully joins auction
- [x] Agent can detect new players
- [x] Agent can place bids
- [x] Agent state stays in sync with auction
- [x] Agent recovers from crashes (up to 3 retries)
- [x] Browser automation is reliable
- [x] Error handling is comprehensive
- [x] Logging is structured and useful

## Known Limitations

1. **Decision Logic**: Simple rule-based (Phase 3 will add LLM)
2. **Frontend Dependency**: Requires specific DOM structure and events
3. **Single Agent Testing**: Full multi-agent testing in Phase 4
4. **No Strategy Profiles**: All agents use same logic (Phase 3)

## Next Steps (Phase 3)

1. Define team-specific strategy profiles
2. Integrate Ollama LLM for decision-making
3. Build player stats query API
4. Implement LLM prompt construction
5. Add budget management strategies
6. Test decision quality with sample scenarios

## Troubleshooting

### Browser doesn't launch

```bash
# Install Playwright browsers
npx playwright install chromium
```

### Can't connect to frontend

- Check `AUCTION_FRONTEND_URL` in `.env`
- Ensure auction app is running on port 5173
- Verify auction code is correct

### Agent gets stuck

- Check browser console for errors
- Review logs in `logs/agents/{TEAM}.log`
- Try with `AGENT_HEADLESS=false` to see browser

### State sync issues

- Verify frontend exposes `window.__auctionState`
- Check event names match expected format
- Increase `stateCheckIntervalMs` if too frequent

## Dependencies

- `playwright ^1.56.1` - Browser automation
- `winston ^3.17.0` - Logging
- `dotenv ^16.4.7` - Environment variables

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [PRD Phase 2 Section](./PRD.md#phase-2-agent-core--browser-automation-week-2)
