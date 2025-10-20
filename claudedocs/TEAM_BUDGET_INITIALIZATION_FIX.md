# Team Budget Initialization Fix

## Problem Summary

All agents were initializing with hardcoded 120cr budget instead of their actual team-specific budgets from the database. For example, LSG showed `budgetRemaining:12000` (120cr) when they should only have 69cr.

## Root Cause

**File**: `apps/agent/src/agent/agent.ts:47`
```typescript
this.stateManager = new StateManager(12000, logger); // Hardcoded 120cr
```

The agent constructor was initializing StateManager with a hardcoded 12000 lakhs (120cr) regardless of:
- Team-specific base purse
- Retention costs already deducted
- Actual remaining purse from database

## Database Schema

The `AuctionTeam` table contains the correct budget information:
- `basePurseCr` - Team's initial purse (varies by team, e.g., 120cr, 75cr, 69cr)
- `retentionCostCr` - Cost of retained players
- `purseRemainingCr` - **Actual budget available** = basePurse - retentionCost

## Fixes Implemented

### Fix 1: Add Database Query for Team Budget
**File**: `apps/agent/src/data/prisma-database.ts:265-289`

Added `getTeamBudget()` method to fetch team-specific budget:
```typescript
async getTeamBudget(auctionCode: string, teamCode: string): Promise<{
  basePurseCr: Prisma.Decimal;
  retentionCostCr: Prisma.Decimal;
  purseRemainingCr: Prisma.Decimal;
} | null>
```

### Fix 2: Fetch Budget in Agent Worker
**File**: `apps/agent/src/orchestrator/agent-worker.ts:92-103`

Query database before creating agent:
```typescript
// CRITICAL: Fetch team's actual budget from database
logger.info('Fetching team budget from database', { teamCode, auctionCode });
const teamBudget = await db.getTeamBudget(auctionCode, teamCode);
if (!teamBudget) {
  throw new Error(`Team budget not found for ${teamCode} in auction ${auctionCode}`);
}
logger.info('Team budget fetched', {
  teamCode,
  basePurseCr: teamBudget.basePurseCr,
  retentionCostCr: teamBudget.retentionCostCr,
  purseRemainingCr: teamBudget.purseRemainingCr,
});
```

### Fix 3: Update AgentConfig Type
**File**: `apps/agent/src/types/agent.types.ts:123`

Added optional `initialBudgetLakh` field:
```typescript
export interface AgentConfig {
  teamCode: TeamCode;
  auctionCode: string;
  browser: BrowserConfig;
  frontendUrl: string;
  bidDelayMs: number;
  stateCheckIntervalMs: number;
  initialBudgetLakh?: number; // Team's actual budget in lakhs (fetched from database)
}
```

### Fix 4: Pass Budget to Agent Constructor
**File**: `apps/agent/src/orchestrator/agent-worker.ts:125`

Convert database budget (crores) to lakhs and pass to agent:
```typescript
const agentConfig: AgentConfig = {
  teamCode,
  auctionCode,
  browser: config.browser,
  frontendUrl: config.auction.frontendUrl,
  bidDelayMs: config.auction.bidDelayMs,
  stateCheckIntervalMs: config.auction.stateCheckIntervalMs,
  initialBudgetLakh: Math.floor(Number(teamBudget.purseRemainingCr) * 100), // Convert cr to lakhs
};
```

### Fix 5: Use Config Budget in Agent
**File**: `apps/agent/src/agent/agent.ts:47-58`

Updated constructor to use config budget with fallback:
```typescript
// CRITICAL: Use team-specific budget from database, fallback to default 120cr only if not provided
const initialBudget = config.initialBudgetLakh ?? 12000;
this.logger.info('Agent budget initialized', {
  teamCode: config.teamCode,
  initialBudgetLakh: initialBudget,
  initialBudgetCr: (initialBudget / 100).toFixed(2),
  source: config.initialBudgetLakh ? 'database' : 'default',
});
this.stateManager = new StateManager(initialBudget, logger);
```

## Expected Behavior

### Before Fix
- **All teams**: 120cr (12000L) hardcoded
- **LSG**: 120cr ❌ (should be 69cr)
- **MI**: 120cr ❌ (should be 45cr after retentions)
- **CSK**: 120cr ❌ (should be 55cr after retentions)

### After Fix
- **Teams fetch from database**: Actual `purseRemainingCr`
- **LSG**: 69cr ✅ (6900L)
- **MI**: 45cr ✅ (4500L)
- **CSK**: 55cr ✅ (5500L)

### Example: LSG
```
Database: purseRemainingCr = 69.00
Conversion: 69.00 × 100 = 6900 lakhs
Agent logs:
  "Agent budget initialized"
  "initialBudgetLakh": 6900
  "initialBudgetCr": "69.00"
  "source": "database"

Budget calculations:
  budgetRemaining: 6900L
  minSlotsNeeded: 18
  reservedBudget: 540L (18 × 30L)
  availableBudget: 6360L (63.6cr)
```

## Logging Enhancements

### Agent Initialization
```json
{
  "message": "Fetching team budget from database",
  "teamCode": "LSG",
  "auctionCode": "bb96f44d-..."
}
{
  "message": "Team budget fetched",
  "teamCode": "LSG",
  "basePurseCr": "120.00",
  "retentionCostCr": "51.00",
  "purseRemainingCr": "69.00"
}
{
  "message": "Agent budget initialized",
  "teamCode": "LSG",
  "initialBudgetLakh": 6900,
  "initialBudgetCr": "69.00",
  "source": "database"
}
```

### Decision Logging
```json
{
  "message": "LLM decision budget validation",
  "player": "Jos Buttler",
  "budgetRemaining": 6900,
  "reservedBudget": 540,
  "availableBudget": 6360
}
```

## Impact

### Budget Accuracy
- ✅ Each team uses actual database budget
- ✅ Retention costs properly deducted
- ✅ Budget constraints accurate from start
- ✅ Reserve budget calculations correct

### Risk Mitigation
- ✅ No more overbidding beyond actual budget
- ✅ Proper budget constraints for all teams
- ✅ Accurate financial planning during auction
- ✅ Prevents budget exhaustion scenarios

## Error Handling

### Database Query Failure
If `getTeamBudget()` returns `null`:
```typescript
if (!teamBudget) {
  throw new Error(`Team budget not found for ${teamCode} in auction ${auctionCode}`);
}
```

Agent worker will:
1. Log error with team and auction details
2. Fail to start (throw error)
3. Allow orchestrator to restart with retry logic

### Fallback Behavior
If `initialBudgetLakh` not provided in config:
```typescript
const initialBudget = config.initialBudgetLakh ?? 12000;
```

Agent uses 120cr default with:
- Warning log: `source: "default"`
- Allows agent to run (backward compatible)
- Useful for testing without database

## Testing

### Validation Steps
1. ✅ Database query returns correct budget
2. ✅ Budget conversion (cr → lakhs) accurate
3. ✅ Agent initializes with database budget
4. ✅ Logs show correct budget source
5. ✅ Decision engine uses correct budget

### Test Scenarios
```typescript
// Test 1: LSG with 69cr after retentions
Expected: initialBudgetLakh = 6900
Expected: availableBudget = 6360L (after 540L reserve)

// Test 2: MI with 45cr after retentions
Expected: initialBudgetLakh = 4500
Expected: availableBudget = 3960L (after 540L reserve)

// Test 3: New team with full 120cr
Expected: initialBudgetLakh = 12000
Expected: availableBudget = 11460L (after 540L reserve)
```

## Related Fixes

This fix works in conjunction with:
- **Budget Overbid Fix** (BUDGET_OVERBID_FIX.md)
  - Ensures reserve budget calculations use correct base budget
  - Prevents overbidding with accurate budget constraints

## Files Modified

1. `apps/agent/src/data/prisma-database.ts` - Added getTeamBudget method
2. `apps/agent/src/orchestrator/agent-worker.ts` - Fetch and pass budget
3. `apps/agent/src/types/agent.types.ts` - Added initialBudgetLakh field
4. `apps/agent/src/agent/agent.ts` - Use config budget with logging

## Deployment Notes

### Database Requirements
- Auction must exist with valid `roomCode`
- AuctionTeam records must exist for all participating teams
- `purseRemainingCr` must be set correctly (basePurse - retentions)

### Monitoring
Monitor logs for:
- "Team budget fetched" - Verify correct values
- "Agent budget initialized" with `source: "database"`
- "LLM decision budget validation" - Verify budgetRemaining values
- Any "default" source warnings (indicates database issue)

### Rollback
If issues occur, can temporarily revert to hardcoded budget by:
1. Not passing `initialBudgetLakh` in config
2. Agent falls back to 12000L default
3. Allows time to fix database issues
