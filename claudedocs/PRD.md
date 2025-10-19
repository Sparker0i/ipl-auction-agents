# IPL Auction AI Agent System - Product Requirements Document (PRD)

**Version**: 1.0
**Date**: 2025-10-18
**Author**: AI Agent Development Team
**Status**: Draft for Review

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Architecture](#system-architecture)
3. [Data Processing Pipeline](#data-processing-pipeline)
4. [Agent Behavior & Strategy](#agent-behavior--strategy)
5. [LLM Integration](#llm-integration)
6. [Browser Automation](#browser-automation)
7. [Technical Specifications](#technical-specifications)
8. [Monitoring & Logging](#monitoring--logging)
9. [Implementation Phases](#implementation-phases)
10. [Appendix](#appendix)

---

## 1. Executive Summary

### 1.1 Purpose
Build an autonomous AI agent system that simulates 9 IPL franchise teams participating in a live auction. Each agent will use browser automation to join the auction, evaluate players using historical T20 data and LLM-powered decision-making, and place strategic bids to build a competitive squad within budget constraints.

### 1.2 Goals
- **Primary**: Enable realistic multi-team auction simulation with intelligent AI agents
- **Secondary**: Provide insights into AI decision-making for educational/demo purposes
- **Tertiary**: Create reusable agent framework for future auction simulations

### 1.3 Success Criteria
- ✅ 9 agents successfully join auction and complete squad building
- ✅ All agents meet IPL squad constraints (18-25 players, max 8 overseas)
- ✅ Each agent employs distinct team-specific strategy
- ✅ 95%+ of bid decisions made within 5 seconds
- ✅ Zero auction state corruption (no duplicate bids, race conditions)

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Dashboard                          │
│          (Triggers agent system with 6-letter code)         │
└─────────────────────────────────────┬───────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent Orchestrator (Master Process)            │
│  - Spawns 9 agent processes                                 │
│  - Monitors agent health                                    │
│  - Aggregates logs                                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
       ┌──────────┴──────────┬──────────┬────────────┐
       ▼                     ▼          ▼            ▼
┌─────────────┐      ┌─────────────┐  ...   ┌─────────────┐
│  Agent 1    │      │  Agent 2    │        │  Agent 9    │
│  (CSK)      │      │  (MI)       │        │  (GT)       │
├─────────────┤      ├─────────────┤        ├─────────────┤
│ Browser     │      │ Browser     │        │ Browser     │
│ Controller  │      │ Controller  │        │ Controller  │
├─────────────┤      ├─────────────┤        ├─────────────┤
│ Strategy    │      │ Strategy    │        │ Strategy    │
│ Engine      │      │ Engine      │        │ Engine      │
├─────────────┤      ├─────────────┤        ├─────────────┤
│ LLM Client  │      │ LLM Client  │        │ LLM Client  │
└──────┬──────┘      └──────┬──────┘        └──────┬──────┘
       │                    │                       │
       └────────────────────┴───────────────────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │  Shared Services    │
                  ├─────────────────────┤
                  │ - Player Database   │
                  │ - Stats Engine      │
                  │ - Ollama LLM Server │
                  └─────────────────────┘
```

### 2.2 Component Breakdown

#### 2.2.1 Agent Orchestrator
**Location**: `apps/agent/src/orchestrator/`
- **Responsibilities**:
  - Receive 6-letter auction code from admin
  - Spawn 9 independent agent processes
  - Monitor agent health (heartbeat every 10s)
  - Restart crashed agents
  - Aggregate logs to central dashboard
  - Cleanup on auction completion

#### 2.2.2 Individual Agent
**Location**: `apps/agent/src/agent/`
- **Responsibilities**:
  - Initialize Playwright browser
  - Navigate to auction lobby with team assignment
  - Monitor auction state (current player, bids, team stats)
  - Make bid/no-bid decisions using strategy engine
  - Execute bids via socket or UI interaction
  - Maintain internal state (squad, budget, decisions)

#### 2.2.3 Strategy Engine
**Location**: `apps/agent/src/strategy/`
- **Responsibilities**:
  - Load team-specific strategy configuration
  - Query player statistics from database
  - Construct LLM prompt with relevant context
  - Parse LLM response into bid decision
  - Apply rule-based constraints (budget, squad limits)
  - Learn from previous decisions (within session)

#### 2.2.4 Player Database & Stats Engine
**Location**: `apps/agent/src/data/`
- **Responsibilities**:
  - Pre-process T20 match data (2015-2025)
  - Build player performance profiles
  - Calculate ground-specific statistics
  - Provide fast lookup APIs for agents
  - Handle missing player data gracefully

---

## 3. Data Processing Pipeline

### 3.1 Data Sources
- **Primary**: `data/matchdata/all/*.yaml` (ball-by-ball T20 match data)
- **Player Mapping**: `data/players/people.csv` (short name → full name)
- **Auction Data**: `auction.csv` (player list with base prices)

### 3.2 Data Filtering
Extract only T20 format matches from 2015 onwards:
```yaml
Filter Criteria:
  - match_type: "T20" or "T20I"
  - competition: ["IPL", "BBL", "CPL", "PSL", "T20 World Cup", "T20 Blast", etc.]
  - date: >= "2015-01-01"
```

### 3.3 Statistics to Extract

#### 3.3.1 Batting Statistics
```typescript
interface BattingStats {
  overall: {
    matches: number;
    innings: number;
    runs: number;
    balls: number;
    strikeRate: number;
    average: number;
    fifties: number;
    hundreds: number;
    highestScore: number;
    boundaries: { fours: number; sixes: number };
  };

  byVenue: Map<string, VenueStats>; // Ground-specific performance

  byPhase: {
    powerplay: { runs: number; strikeRate: number; };
    middle: { runs: number; strikeRate: number; };
    death: { runs: number; strikeRate: number; };
  };

  vsOpposition: Map<string, OpponentStats>;

  recentForm: { // Last 10 T20 innings
    runs: number[];
    strikeRates: number[];
    trend: "improving" | "declining" | "stable";
  };
}
```

#### 3.3.2 Bowling Statistics
```typescript
interface BowlingStats {
  overall: {
    matches: number;
    innings: number;
    overs: number;
    wickets: number;
    economy: number;
    average: number;
    strikeRate: number;
    bestFigures: string;
    fiveWicketHauls: number;
  };

  byVenue: Map<string, VenueStats>;

  byPhase: {
    powerplay: { wickets: number; economy: number; };
    middle: { wickets: number; economy: number; };
    death: { wickets: number; economy: number; };
  };

  vsOpposition: Map<string, OpponentStats>;

  recentForm: {
    wickets: number[];
    economies: number[];
    trend: "improving" | "declining" | "stable";
  };
}
```

#### 3.3.3 Fielding Statistics
```typescript
interface FieldingStats {
  catches: number;
  runOuts: number;
  stumpings: number; // for wicketkeepers
}
```

#### 3.3.4 Ground-Specific Statistics
```typescript
interface VenueStats {
  venueName: string;
  matches: number;
  performance: {
    batting?: { runs: number; average: number; strikeRate: number; };
    bowling?: { wickets: number; economy: number; average: number; };
  };
  bonus: number; // 0.0 to 1.0 multiplier for team's home ground
}
```

### 3.4 Database Schema
**Technology**: SQLite for simplicity (can migrate to PostgreSQL later)

```sql
-- Players table
CREATE TABLE players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  country TEXT,
  role TEXT, -- BATTER, BOWLER, ALL-ROUNDER, WICKETKEEPER
  is_overseas BOOLEAN,
  is_capped BOOLEAN
);

-- Player stats aggregated
CREATE TABLE player_stats (
  player_id TEXT PRIMARY KEY,
  batting_stats JSON,
  bowling_stats JSON,
  fielding_stats JSON,
  venue_stats JSON,
  last_updated TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

-- Match-level data (for detailed queries)
CREATE TABLE matches (
  match_id TEXT PRIMARY KEY,
  date DATE,
  venue TEXT,
  competition TEXT,
  teams JSON
);

CREATE TABLE player_performances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT,
  player_id TEXT,
  batting JSON,
  bowling JSON,
  fielding JSON,
  FOREIGN KEY (match_id) REFERENCES matches(match_id),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE INDEX idx_player_perf ON player_performances(player_id);
CREATE INDEX idx_match_date ON matches(date);
```

### 3.5 Data Processing Script
**Location**: `apps/agent/scripts/process-match-data.ts`

**Workflow**:
1. Read all YAML files from `data/matchdata/all/`
2. Filter T20 matches from 2015+
3. Extract player performances (batting, bowling, fielding)
4. Map short names to full names via people.csv
5. Aggregate statistics per player
6. Calculate venue-specific stats
7. Store in SQLite database
8. Generate summary report (players processed, missing data)

**Execution Time**: ~5-10 minutes for full dataset

---

## 4. Agent Behavior & Strategy

### 4.1 Team-Specific Strategies

Each IPL team has a distinct playing style and auction strategy. Agents will embody these characteristics:

#### 4.1.1 Strategy Profiles

```typescript
interface TeamStrategy {
  teamCode: string; // CSK, MI, RCB, etc.
  homeVenue: string; // MA Chidambaram Stadium, Wankhede, etc.

  // Bidding behavior
  aggression: "conservative" | "balanced" | "aggressive";
  riskTolerance: number; // 0.0 to 1.0

  // Squad building preferences
  priorities: {
    experience: number; // Weight for capped players (0-1)
    youth: number; // Weight for uncapped players (0-1)
    starPower: number; // Weight for marquee players (0-1)
    value: number; // Weight for budget players (0-1)
  };

  // Role distribution targets (percentages)
  roleDistribution: {
    batters: number; // 35-45%
    bowlers: number; // 30-40%
    allRounders: number; // 15-25%
    wicketkeepers: number; // 10-15%
  };

  // Special constraints
  specialRules: {
    maxBidPerPlayer: number; // Max ₹cr willing to spend on one player
    retainedPlayers?: string[]; // Players this team retained
    rivalryBonus?: Map<string, number>; // Extra willingness for rival teams' players
  };
}
```

**Example Strategies**:

```typescript
const TEAM_STRATEGIES: Record<string, TeamStrategy> = {
  CSK: {
    teamCode: "CSK",
    homeVenue: "MA Chidambaram Stadium",
    aggression: "balanced",
    riskTolerance: 0.6,
    priorities: { experience: 0.7, youth: 0.3, starPower: 0.6, value: 0.8 },
    roleDistribution: { batters: 40, bowlers: 35, allRounders: 20, wicketkeepers: 5 },
    specialRules: {
      maxBidPerPlayer: 18,
      retainedPlayers: ["Ruturaj Gaikwad", "Ravindra Jadeja", "Shivam Dube", "Matheesha Pathirana", "MS Dhoni"],
    },
  },

  MI: {
    teamCode: "MI",
    homeVenue: "Wankhede Stadium",
    aggression: "aggressive",
    riskTolerance: 0.8,
    priorities: { experience: 0.5, youth: 0.5, starPower: 0.9, value: 0.6 },
    roleDistribution: { batters: 40, bowlers: 30, allRounders: 20, wicketkeepers: 10 },
    specialRules: {
      maxBidPerPlayer: 25,
      retainedPlayers: ["Jasprit Bumrah", "Suryakumar Yadav", "Hardik Pandya", "Rohit Sharma", "Tilak Varma"],
    },
  },

  RCB: {
    teamCode: "RCB",
    homeVenue: "M Chinnaswamy Stadium",
    aggression: "aggressive",
    riskTolerance: 0.9,
    priorities: { experience: 0.6, youth: 0.4, starPower: 1.0, value: 0.4 },
    roleDistribution: { batters: 45, bowlers: 30, allRounders: 15, wicketkeepers: 10 },
    specialRules: {
      maxBidPerPlayer: 30,
      retainedPlayers: ["Virat Kohli", "Rajat Patidar", "Yash Dayal"],
    },
  },

  // ... Similar for DC, PBKS, RR, KKR, LSG, SRH, GT
};
```

### 4.2 Decision-Making Framework

#### 4.2.1 Bid Decision Workflow

```
Player Presented
      ↓
[1] Quick Rule Check
    - Budget > 29L?
    - Squad size < 25?
    - Overseas slots available (if overseas)?
      ↓ YES
[2] Fetch Player Stats
    - Query database for player performance
    - Calculate venue bonus (home ground)
    - Get recent form (last 10 matches)
      ↓
[3] Evaluate Squad Needs
    - Current role distribution
    - Gaps in squad (e.g., need fast bowlers)
    - Budget allocation remaining
      ↓
[4] LLM Decision
    - Construct prompt with context
    - Query Ollama for bid/no-bid + max price
    - Parse structured response
      ↓
[5] Apply Final Constraints
    - Ensure bid within team's max
    - Ensure budget remains > squad_needed * 0.3cr
    - Ensure won't exceed 25 players
      ↓
[6] Execute Bid
    - Place bid via browser automation
    - Update internal state
    - Log decision reasoning
```

#### 4.2.2 Budget Management Strategy

**Dynamic Budget Allocation**:

```typescript
function calculateMaxBid(agent: Agent, player: Player): number {
  const remainingBudget = agent.budget; // in lakhs
  const currentSquadSize = agent.squad.length;
  const minSquadSize = 18;
  const maxSquadSize = 25;

  // Calculate minimum slots we need to fill
  const minSlotsNeeded = Math.max(0, minSquadSize - currentSquadSize);
  const maxSlotsAvailable = maxSquadSize - currentSquadSize;

  // Reserve budget for mandatory slots (min 30L each)
  const reservedBudget = minSlotsNeeded * 30;
  const spendableBudget = remainingBudget - reservedBudget;

  if (spendableBudget <= 0) {
    // Critical: Only bid base price if absolutely needed
    return player.basePriceLakh;
  }

  // Allocate budget based on squad phase
  let maxBidPercent: number;

  if (currentSquadSize < 11) {
    // Early phase: Build core, willing to spend more
    maxBidPercent = 0.25; // Up to 25% of spendable budget
  } else if (currentSquadSize < 18) {
    // Mid phase: Fill key roles
    maxBidPercent = 0.15; // Up to 15% of spendable budget
  } else {
    // Late phase: Fill remaining slots cheaply
    maxBidPercent = 0.05; // Up to 5% of spendable budget
  }

  const baseMaxBid = spendableBudget * maxBidPercent;

  // Apply player quality multiplier (from LLM evaluation)
  const qualityMultiplier = getQualityMultiplier(player, agent);
  const adjustedMaxBid = baseMaxBid * qualityMultiplier;

  // Ensure within team's absolute max
  return Math.min(adjustedMaxBid, agent.strategy.specialRules.maxBidPerPlayer * 100);
}
```

**Stop Bidding Conditions**:
1. Budget ≤ 29 lakhs (hard stop)
2. Squad size = 25 (full squad)
3. Budget insufficient for minimum squad (18 - current) * 30L

**Mandatory Constraints**:
- Must acquire minimum 18 players before budget exhaustion
- If squad < 18 and budget running low, prioritize cheap uncapped players

---

## 5. LLM Integration

### 5.1 Model Selection

**Primary Model**: `llama3.1:8b`
- Best balance of reasoning quality and speed
- Excellent at structured decision-making
- Good instruction following

**Alternative Models** (configurable):
- `mistral:7b` - Faster, slightly less reasoning
- `phi3:medium` - Very fast for simple decisions
- `llama3.1:70b` - Maximum quality (resource-intensive)

### 5.2 Prompt Engineering

#### 5.2.1 Structured Prompt Template

```typescript
const AUCTION_DECISION_PROMPT = `
You are an AI agent representing the {TEAM_NAME} franchise in the IPL 2025 Mega Auction.

## Your Team Profile
- Home Ground: {HOME_VENUE}
- Strategy: {AGGRESSION} bidding with {RISK_TOLERANCE} risk tolerance
- Priorities: Experience {EXP_WEIGHT}, Youth {YOUTH_WEIGHT}, Star Power {STAR_WEIGHT}, Value {VALUE_WEIGHT}

## Current Squad Status
- Players Acquired: {CURRENT_SQUAD_SIZE}/25
- Budget Remaining: ₹{BUDGET_REMAINING} lakhs
- Squad Composition:
  * Batters: {BATTER_COUNT} (Target: {BATTER_TARGET}%)
  * Bowlers: {BOWLER_COUNT} (Target: {BOWLER_TARGET}%)
  * All-Rounders: {AR_COUNT} (Target: {AR_TARGET}%)
  * Wicketkeepers: {WK_COUNT} (Target: {WK_TARGET}%)
- Overseas Players: {OVERSEAS_COUNT}/8

## Player Being Auctioned
- Name: {PLAYER_NAME}
- Role: {PLAYER_ROLE}
- Country: {PLAYER_COUNTRY}
- Capped/Uncapped: {CAPPED_STATUS}
- Base Price: ₹{BASE_PRICE} lakhs
- Current Bid: ₹{CURRENT_BID} lakhs (by {BIDDING_TEAM})

## Player Statistics (T20 2015-2025)
{PLAYER_STATS_JSON}

## Performance at Your Home Ground ({HOME_VENUE})
{VENUE_SPECIFIC_STATS}

## Squad Needs Analysis
- Critical Gaps: {CRITICAL_GAPS}
- Desired Roles: {DESIRED_ROLES}
- Budget Constraints: Must reserve ₹{RESERVED_BUDGET} lakhs for {SLOTS_NEEDED} minimum slots

## Decision Required
Based on your team strategy, squad needs, and this player's performance data:

1. Should you bid? (yes/no)
2. If yes, what is your maximum bid (in lakhs)?
3. Brief reasoning (1-2 sentences)

Respond in JSON format:
{
  "decision": "bid" | "pass",
  "maxBid": number (in lakhs, or null if pass),
  "reasoning": "string"
}
`;
```

#### 5.2.2 Example Prompt Instance

```json
{
  "TEAM_NAME": "Chennai Super Kings",
  "HOME_VENUE": "MA Chidambaram Stadium",
  "AGGRESSION": "balanced",
  "RISK_TOLERANCE": "0.6",
  "CURRENT_SQUAD_SIZE": "8",
  "BUDGET_REMAINING": "8500",
  "BATTER_COUNT": "3",
  "BATTER_TARGET": "40",
  "PLAYER_NAME": "Shreyas Iyer",
  "PLAYER_ROLE": "BATTER",
  "PLAYER_COUNTRY": "India",
  "CAPPED_STATUS": "Capped",
  "BASE_PRICE": "200",
  "CURRENT_BID": "650",
  "BIDDING_TEAM": "Kolkata Knight Riders",
  "PLAYER_STATS_JSON": {
    "batting": {
      "matches": 115,
      "runs": 3127,
      "average": 32.6,
      "strikeRate": 128.4,
      "fifties": 18,
      "hundreds": 2
    },
    "recentForm": {
      "last10Innings": [45, 23, 67, 12, 89, 34, 56, 21, 78, 43],
      "trend": "stable",
      "averageStrikeRate": 131.2
    }
  },
  "VENUE_SPECIFIC_STATS": {
    "matches": 8,
    "runs": 287,
    "average": 35.9,
    "strikeRate": 134.2,
    "bonus": 0.15
  },
  "CRITICAL_GAPS": "Need experienced top-order batter, strong middle-order anchor",
  "DESIRED_ROLES": "BATTER (top priority), ALL-ROUNDER (secondary)",
  "RESERVED_BUDGET": "3000",
  "SLOTS_NEEDED": "10"
}
```

### 5.3 LLM Response Parsing

```typescript
interface LLMResponse {
  decision: "bid" | "pass";
  maxBid: number | null; // in lakhs
  reasoning: string;
}

async function queryLLM(prompt: string): Promise<LLMResponse> {
  const response = await fetch(`http://localhost:11434/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.llmModel, // "llama3.1:8b"
      prompt: prompt,
      format: "json",
      stream: false,
      options: {
        temperature: 0.3, // Lower for more consistent decisions
        top_p: 0.9,
      }
    })
  });

  const data = await response.json();

  try {
    const parsed = JSON.parse(data.response);

    // Validate response structure
    if (!parsed.decision || (parsed.decision === "bid" && !parsed.maxBid)) {
      throw new Error("Invalid LLM response structure");
    }

    return parsed;
  } catch (error) {
    console.error("Failed to parse LLM response:", error);
    // Fallback: conservative decision
    return { decision: "pass", maxBid: null, reasoning: "LLM parsing error" };
  }
}
```

### 5.4 LLM Performance Optimization

**Strategies**:
1. **Pre-compute Player Evaluations**: Generate evaluations for all players before auction starts, cache results
2. **Async Queries**: Don't block agent while waiting for LLM response
3. **Timeout Handling**: If LLM takes > 5s, use fallback rule-based decision
4. **Batch Warmup**: Pre-load LLM model before auction starts

```typescript
// Fallback rule-based decision if LLM fails/times out
function fallbackDecision(agent: Agent, player: Player): LLMResponse {
  const needsRole = agent.getRoleGap(player.role) > 0;
  const canAfford = agent.budget > player.basePriceLakh + 300;
  const isGoodValue = player.basePriceLakh < 100;

  if (needsRole && canAfford) {
    return {
      decision: "bid",
      maxBid: player.basePriceLakh + 50, // Conservative bid
      reasoning: "Fallback: Role needed, within budget"
    };
  }

  return {
    decision: "pass",
    maxBid: null,
    reasoning: "Fallback: Not critical or over budget"
  };
}
```

---

## 6. Browser Automation

### 6.1 Technology: Playwright

**Why Playwright**:
- Native async/await support
- Better reliability than Puppeteer
- Multi-browser support
- Built-in waiting mechanisms
- Already available via MCP

### 6.2 Browser Configuration

```typescript
interface BrowserConfig {
  headless: boolean; // Configurable via env var
  viewport: { width: number; height: number };
  slowMo: number; // Delay between actions (ms)
  timeout: number; // Default timeout for actions (ms)
}

const DEFAULT_CONFIG: BrowserConfig = {
  headless: process.env.AGENT_HEADLESS === "true",
  viewport: { width: 1280, height: 720 },
  slowMo: 100, // Helps avoid race conditions
  timeout: 10000
};
```

### 6.3 Agent Browser Lifecycle

```typescript
class AuctionAgent {
  private browser: Browser;
  private page: Page;
  private teamId: string;

  async initialize(auctionCode: string, teamName: string) {
    // 1. Launch browser
    this.browser = await playwright.chromium.launch({
      headless: config.headless,
      slowMo: config.slowMo
    });

    // 2. Create page
    this.page = await this.browser.newPage({
      viewport: config.viewport
    });

    // 3. Navigate to auction lobby
    await this.page.goto(`http://localhost:5173/lobby/${auctionCode}`);

    // 4. Select team
    await this.selectTeam(teamName);

    // 5. Wait for auction to start
    await this.waitForAuctionStart();

    // 6. Start monitoring auction state
    this.startAuctionMonitoring();
  }

  private async selectTeam(teamName: string) {
    // Wait for team selection UI
    await this.page.waitForSelector('[data-team-selector]');

    // Find and click team
    const teamButton = await this.page.$(`button:has-text("${teamName}")`);
    if (!teamButton) {
      throw new Error(`Team ${teamName} not found`);
    }

    await teamButton.click();

    // Wait for join confirmation
    await this.page.waitForSelector('[data-auction-joined]');

    // Extract team ID from page state
    this.teamId = await this.page.evaluate(() => {
      return window.localStorage.getItem(`teamId_${auctionId}`);
    });
  }

  private async startAuctionMonitoring() {
    // Listen to WebSocket events via page evaluation
    await this.page.evaluate(() => {
      window.addEventListener('auction-player-update', (event) => {
        // Expose to Node.js via page.exposeFunction
        window.__notifyNodePlayer(event.detail);
      });
    });

    // Expose callback to page
    await this.page.exposeFunction('__notifyNodePlayer', (playerData) => {
      this.handleNewPlayer(playerData);
    });
  }

  private async handleNewPlayer(playerData: any) {
    // This is where agent makes decision
    const decision = await this.makeDecision(playerData);

    if (decision.shouldBid) {
      await this.placeBid(decision.maxBid);
    }
  }

  private async placeBid(amount: number) {
    // Find and click bid button
    const bidButton = await this.page.$('[data-bid-button]');

    if (!bidButton) {
      console.warn("Bid button not found");
      return;
    }

    // Check if button is disabled (e.g., we're already highest bidder)
    const isDisabled = await bidButton.isDisabled();
    if (isDisabled) {
      console.log("Cannot bid: button disabled");
      return;
    }

    // Click bid button
    await bidButton.click();

    // Log the bid
    console.log(`✅ Placed bid: ₹${amount}L`);
  }
}
```

### 6.4 State Synchronization

**Challenge**: Keep agent's internal state in sync with auction state

**Solution**: Hybrid approach
1. **Primary**: Listen to WebSocket events via browser
2. **Fallback**: Poll UI elements every 2s for critical data

```typescript
class StateManager {
  private currentPlayer: Player | null = null;
  private currentBid: number | null = null;
  private myBudget: number;
  private mySquad: Player[] = [];

  async syncState(page: Page) {
    // Extract state from DOM
    const state = await page.evaluate(() => {
      return {
        currentPlayer: window.__auctionState?.currentPlayer,
        currentBid: window.__auctionState?.currentBid,
        myTeamPurse: document.querySelector('[data-purse]')?.textContent,
        mySquadSize: document.querySelector('[data-squad-size]')?.textContent
      };
    });

    this.currentPlayer = state.currentPlayer;
    this.currentBid = state.currentBid;

    // Parse and update budget
    if (state.myTeamPurse) {
      this.myBudget = parseFloat(state.myTeamPurse.replace(/[₹,cr]/g, '')) * 100; // Convert cr to lakhs
    }
  }
}
```

### 6.5 Error Handling & Recovery

```typescript
class ErrorRecovery {
  async handleBrowserCrash(agent: AuctionAgent) {
    console.error(`Agent ${agent.teamName} browser crashed`);

    // Try to restart
    try {
      await agent.cleanup();
      await agent.initialize(agent.auctionCode, agent.teamName);
      console.log(`✅ Agent ${agent.teamName} restarted successfully`);
    } catch (error) {
      console.error(`❌ Failed to restart agent ${agent.teamName}:`, error);
      // Notify orchestrator
      this.notifyOrchestrator('agent_failed', { teamName: agent.teamName, error });
    }
  }

  async handleSocketDisconnect(agent: AuctionAgent) {
    console.warn(`Agent ${agent.teamName} socket disconnected`);

    // Wait for reconnection
    await agent.page.waitForFunction(() => {
      return window.__socketConnected === true;
    }, { timeout: 30000 });

    // Re-sync state
    await agent.stateManager.syncState(agent.page);
  }
}
```

---

## 7. Technical Specifications

### 7.1 Directory Structure

```
apps/agent/
├── src/
│   ├── orchestrator/
│   │   ├── index.ts              # Main orchestrator entry point
│   │   ├── agent-spawner.ts      # Spawn and manage agent processes
│   │   └── health-monitor.ts     # Monitor agent heartbeats
│   │
│   ├── agent/
│   │   ├── agent.ts               # Main agent class
│   │   ├── browser-controller.ts # Playwright automation
│   │   ├── state-manager.ts      # Auction state tracking
│   │   └── decision-engine.ts    # Bid decision logic
│   │
│   ├── strategy/
│   │   ├── team-strategies.ts    # Team-specific strategy configs
│   │   ├── budget-manager.ts     # Budget allocation logic
│   │   └── squad-optimizer.ts    # Squad composition analysis
│   │
│   ├── llm/
│   │   ├── ollama-client.ts      # Ollama API client
│   │   ├── prompt-builder.ts     # Construct LLM prompts
│   │   └── response-parser.ts    # Parse LLM responses
│   │
│   ├── data/
│   │   ├── database.ts            # SQLite database interface
│   │   ├── stats-engine.ts       # Player stats queries
│   │   └── player-evaluator.ts   # Player evaluation logic
│   │
│   ├── utils/
│   │   ├── logger.ts              # Structured logging
│   │   ├── config.ts              # Configuration management
│   │   └── errors.ts              # Custom error classes
│   │
│   └── types/
│       ├── agent.types.ts
│       ├── player.types.ts
│       └── strategy.types.ts
│
├── scripts/
│   ├── process-match-data.ts     # Data processing script
│   ├── test-agent.ts              # Manual agent testing
│   └── benchmark-llm.ts           # LLM performance testing
│
├── data/
│   └── players.db                 # SQLite database (generated)
│
├── logs/
│   ├── orchestrator.log
│   └── agents/
│       ├── CSK.log
│       ├── MI.log
│       └── ...
│
├── config/
│   ├── default.json               # Default configuration
│   ├── development.json           # Dev overrides
│   └── production.json            # Prod overrides
│
├── package.json
├── tsconfig.json
└── README.md
```

### 7.2 Configuration File

**Location**: `apps/agent/config/default.json`

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
    "timeout": 10000,
    "executablePath": null
  },

  "llm": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "llama3.1:8b",
    "temperature": 0.3,
    "timeout": 5000,
    "fallbackOnTimeout": true
  },

  "database": {
    "path": "./data/players.db",
    "enableWAL": true
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
  },

  "teams": [
    "CSK", "MI", "RCB", "DC", "PBKS",
    "RR", "KKR", "LSG", "SRH", "GT"
  ]
}
```

### 7.3 Environment Variables

```bash
# .env.example
NODE_ENV=development

# Auction Configuration
AUCTION_FRONTEND_URL=http://localhost:5173
AUCTION_CODE=ABCD12

# Browser Configuration
AGENT_HEADLESS=false
BROWSER_SLOW_MO=100

# LLM Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
LLM_TIMEOUT=5000

# Database
DATABASE_PATH=./data/players.db

# Logging
LOG_LEVEL=info
LOG_DIRECTORY=./logs
```

### 7.4 Dependencies

**package.json**:
```json
{
  "name": "@ipl-auction/agent",
  "version": "1.0.0",
  "dependencies": {
    "playwright": "^1.48.0",
    "better-sqlite3": "^11.5.0",
    "yaml": "^2.6.1",
    "zod": "^3.24.1",
    "winston": "^3.17.0",
    "dotenv": "^16.4.7"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.2",
    "typescript": "^5.7.2",
    "tsx": "^4.19.2"
  },
  "scripts": {
    "process-data": "tsx scripts/process-match-data.ts",
    "start": "tsx src/orchestrator/index.ts",
    "test-agent": "tsx scripts/test-agent.ts",
    "build": "tsc"
  }
}
```

---

## 8. Monitoring & Logging

### 8.1 Logging Architecture

**Levels**:
- `debug`: Detailed state transitions, LLM prompts/responses
- `info`: Agent actions (bids placed, decisions made)
- `warn`: Recoverable errors (LLM timeout, socket disconnect)
- `error`: Critical failures (browser crash, data corruption)

**Structure**:
```typescript
interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  agent: string; // Team code
  event: string; // "bid_placed", "decision_made", etc.
  data: Record<string, any>;
  message: string;
}
```

**Example Log Entries**:
```json
{
  "timestamp": "2025-10-18T14:32:15.234Z",
  "level": "info",
  "agent": "CSK",
  "event": "decision_made",
  "data": {
    "player": "Shreyas Iyer",
    "decision": "bid",
    "maxBid": 725,
    "currentBid": 650,
    "reasoning": "Strong top-order batter, good recent form, fits budget"
  },
  "message": "CSK decided to bid on Shreyas Iyer (max: ₹725L)"
}

{
  "timestamp": "2025-10-18T14:32:16.123Z",
  "level": "info",
  "agent": "CSK",
  "event": "bid_placed",
  "data": {
    "player": "Shreyas Iyer",
    "bidAmount": 700,
    "newBudget": 7800
  },
  "message": "CSK placed bid of ₹700L on Shreyas Iyer"
}
```

### 8.2 Real-time Dashboard (Optional - Phase 2)

**Technology**: WebSocket + React dashboard

**Features**:
- Live agent status (bidding, waiting, thinking)
- Current squad composition per team
- Budget remaining visualization
- Decision reasoning display
- Bid history timeline

**Screenshot Mock**:
```
┌─────────────────────────────────────────────────────────┐
│  IPL Auction AI Agent Dashboard                         │
├─────────────────────────────────────────────────────────┤
│  Current Player: Shreyas Iyer (₹650L - KKR bidding)    │
│                                                         │
│  Agent Status:                                          │
│  ┌───────┬──────────┬────────┬─────────┬──────────────┐│
│  │ Team  │ Status   │ Budget │ Squad   │ Last Action  ││
│  ├───────┼──────────┼────────┼─────────┼──────────────┤│
│  │ CSK   │ Thinking │ ₹78cr  │ 8/25    │ Evaluating..││
│  │ MI    │ Waiting  │ ₹112cr │ 5/25    │ Passed       ││
│  │ RCB   │ Bidding  │ ₹93cr  │ 6/25    │ Bid ₹700L   ││
│  └───────┴──────────┴────────┴─────────┴──────────────┘│
│                                                         │
│  Recent Decisions:                                      │
│  • CSK: PASS on Jos Buttler - "Over budget for WK"     │
│  • MI: BID ₹1850L on Jos Buttler - "Premium WK needed" │
│  • RCB: BID ₹700L on Shreyas Iyer - "Top-order gap"    │
└─────────────────────────────────────────────────────────┘
```

### 8.3 Metrics to Track

**Per Agent**:
- Total bids placed
- Total players acquired
- Budget spent
- Budget remaining
- Squad composition (roles)
- Average decision time
- LLM query time (avg, p95, p99)
- Bid success rate (bids won / bids placed)

**System-wide**:
- Total auction duration
- Average time per player
- Agent uptime
- Browser crash count
- LLM timeout count
- Database query time

---

## 9. Implementation Phases

### Phase 1: Data Foundation (Week 1)
**Goal**: Process all T20 match data and build player statistics database

**Tasks**:
1. ✅ Write YAML parser for match data
2. ✅ Filter T20 matches from 2015-2025
3. ✅ Extract player performances (batting, bowling, fielding)
4. ✅ Map short names to full names via people.csv
5. ✅ Calculate aggregated statistics
6. ✅ Calculate venue-specific stats
7. ✅ Store in SQLite database
8. ✅ Validate data completeness (handle missing players)

**Deliverables**:
- `process-match-data.ts` script
- `players.db` SQLite database
- Data processing report (players processed, missing data)

**Acceptance Criteria**:
- All T20 matches from 2015+ processed
- Stats available for 95%+ of auction players
- Database queries return results in <100ms

---

### Phase 2: Agent Core & Browser Automation (Week 2)
**Goal**: Build basic agent that can join auction and place bids

**Tasks**:
1. ✅ Setup Playwright browser automation
2. ✅ Implement agent initialization (join auction with team)
3. ✅ Implement auction state monitoring (WebSocket + DOM polling)
4. ✅ Implement bid placement logic
5. ✅ Implement state synchronization (budget, squad)
6. ✅ Implement error handling (browser crash, socket disconnect)
7. ✅ Test single agent in live auction

**Deliverables**:
- `agent.ts` - Main agent class
- `browser-controller.ts` - Playwright automation
- `state-manager.ts` - State tracking
- Test script for manual agent testing

**Acceptance Criteria**:
- Agent successfully joins auction
- Agent can detect new players
- Agent can place bids
- Agent state stays in sync with auction
- Agent recovers from crashes

---

### Phase 3: Strategy & Decision Engine (Week 3)
**Goal**: Implement team strategies and LLM-powered decision making

**Tasks**:
1. ✅ Define 10 team strategy profiles
2. ✅ Implement budget management logic
3. ✅ Implement squad composition analysis
4. ✅ Build player stats query API
5. ✅ Implement LLM prompt construction
6. ✅ Integrate Ollama API
7. ✅ Implement LLM response parsing
8. ✅ Implement fallback rule-based decisions
9. ✅ Test decision quality with sample scenarios

**Deliverables**:
- `team-strategies.ts` - Strategy configurations
- `budget-manager.ts` - Budget allocation
- `ollama-client.ts` - LLM integration
- `prompt-builder.ts` - Prompt engineering
- Decision quality test suite

**Acceptance Criteria**:
- Each team exhibits distinct bidding behavior
- Budget constraints enforced correctly
- LLM decisions made in <5s (95th percentile)
- Fallback logic works when LLM times out
- Agents build valid squads (18-25 players)

---

### Phase 4: Orchestrator & Multi-Agent (Week 4)
**Goal**: Spawn and manage 9 concurrent agents

**Tasks**:
1. ✅ Implement orchestrator process spawning
2. ✅ Implement agent health monitoring
3. ✅ Implement agent restart logic
4. ✅ Implement log aggregation
5. ✅ Test 9 agents in parallel auction
6. ✅ Performance tuning (LLM queuing, browser concurrency)
7. ✅ Handle edge cases (all agents bid simultaneously)

**Deliverables**:
- `orchestrator/index.ts` - Orchestrator entry point
- `agent-spawner.ts` - Process management
- `health-monitor.ts` - Health checks
- Multi-agent test script

**Acceptance Criteria**:
- 9 agents run concurrently without crashes
- Orchestrator detects and restarts crashed agents
- No race conditions in bidding
- System completes full auction successfully
- Logs aggregated correctly

---

### Phase 5: Monitoring & Polish (Week 5)
**Goal**: Add logging, monitoring, and final polish

**Tasks**:
1. ✅ Implement structured logging (Winston)
2. ✅ Add detailed decision logging
3. ✅ Create auction replay script (read logs)
4. ✅ Performance profiling
5. ✅ Documentation (README, API docs)
6. ✅ Configuration management (env vars, config files)
7. ✅ Final testing with complete auction

**Deliverables**:
- Comprehensive logging system
- Auction replay tool
- Performance report
- Complete documentation
- Production-ready configuration

**Acceptance Criteria**:
- All decisions logged with reasoning
- Replay tool reconstructs auction accurately
- Documentation covers setup and operation
- System runs reliably for full auction

---

### Phase 6 (Optional): Dashboard & Analytics
**Goal**: Build real-time monitoring dashboard

**Tasks**:
1. ⏳ WebSocket server for dashboard updates
2. ⏳ React dashboard UI
3. ⏳ Agent status visualization
4. ⏳ Decision reasoning display
5. ⏳ Post-auction analytics

**Deliverables**:
- Real-time web dashboard
- Post-auction analytics reports

---

## 10. Appendix

### 10.1 Example Agent Lifecycle

```
1. Admin enters 6-letter code → Triggers orchestrator
2. Orchestrator spawns 9 agent processes (CSK, MI, RCB, ...)
3. Each agent:
   a. Launches Playwright browser
   b. Navigates to auction lobby
   c. Selects assigned team
   d. Waits for auction start
4. Auction begins:
   a. First player presented (e.g., Jos Buttler)
   b. All agents receive update simultaneously
   c. Each agent:
      i.   Checks budget (> 29L?) ✅
      ii.  Queries player stats from database
      iii. Constructs LLM prompt with context
      iv.  Queries Ollama (async, 5s timeout)
      v.   Parses decision (bid/pass + max price)
      vi.  Applies budget constraints
      vii. Decides: MI bids ₹1850L, CSK passes
   d. MI places bid via browser automation
   e. Auction continues...
5. Player sold → State updates
6. Next player → Repeat step 4
7. Auction ends:
   a. All agents cleanup (close browsers)
   b. Orchestrator aggregates logs
   c. Generate auction summary report
```

### 10.2 Risk Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Browser crashes | Medium | High | Auto-restart agents, process isolation |
| LLM timeout | High | Medium | Fallback rule-based decisions, pre-compute evaluations |
| Race conditions | Medium | High | Add random delay (100-500ms) before bidding |
| Database corruption | Low | High | Use SQLite WAL mode, regular backups |
| Network issues | Medium | Medium | Retry logic, local caching |
| Agent logic errors | Medium | High | Extensive testing, fail-safe constraints |

### 10.3 Testing Strategy

**Unit Tests**:
- Budget calculation logic
- Squad composition analysis
- LLM response parsing
- Stats database queries

**Integration Tests**:
- Agent joins auction successfully
- Bid placement works correctly
- State synchronization accurate
- Error recovery effective

**End-to-End Tests**:
- Full auction with 9 agents
- All agents build valid squads
- No race conditions or deadlocks
- Logs complete and accurate

**Load Tests**:
- 9 concurrent Playwright browsers
- 9 concurrent LLM queries
- Database performance under load

### 10.4 Success Metrics

**Technical Metrics**:
- Agent uptime: >99%
- Decision latency (p95): <5s
- Bid success rate: >30%
- Valid squad rate: 100%
- Browser crash rate: <1 per auction

**Quality Metrics**:
- Distinct team behaviors observable: Yes
- Squads meet IPL rules: 100%
- Budget management effective: >95%
- Decisions explainable: 100%

---

## Next Steps

1. ✅ Review and approve this PRD
2. 🔄 Set up development environment (Ollama, SQLite, Playwright)
3. 🔄 Begin Phase 1: Data processing pipeline
4. 🔄 Iterate through implementation phases

---

**Document Status**: Ready for Review
**Last Updated**: 2025-10-18
**Next Review**: After Phase 1 completion
