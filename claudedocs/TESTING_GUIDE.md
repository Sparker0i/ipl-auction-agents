# IPL Auction Platform - Testing Guide

**Complete step-by-step guide to test all features**

---

## 🚀 Quick Start (First Time Setup)

### Prerequisites
- Docker and Docker Compose installed
- pnpm installed (`npm install -g pnpm`)
- Git repository cloned

### 1. Start Infrastructure with Docker Compose

```bash
# From project root
docker-compose up -d postgres redis

# Wait for services to be healthy (check with)
docker-compose ps

# You should see:
# ipl-postgres  healthy
# ipl-redis     healthy
```

### 2. Setup Backend

```bash
# Install dependencies
pnpm install

# Navigate to backend
cd apps/backend

# Generate Prisma client
pnpm prisma generate

# Run migrations
pnpm prisma migrate dev

# Seed database with IPL teams and players
pnpm prisma db seed

# Start backend
pnpm dev

# Backend should start on http://localhost:3001
# You'll see: "Server running on port 3001"
```

### 3. Setup Frontend (New Terminal)

```bash
# From project root
cd apps/frontend

# Start frontend dev server
pnpm dev

# Frontend should start on http://localhost:5173
# You'll see: "Local: http://localhost:5173/"
```

### 4. Verify Services

Open browser and check:
- ✅ Frontend: http://localhost:5173 (should show IPL Auction home page)
- ✅ Backend: http://localhost:3001/api/health (should return `{"status":"ok"}`)
- ✅ Postgres: `docker exec -it ipl-postgres psql -U ipl_user -d ipl_auction -c "SELECT COUNT(*) FROM \"Player\";"` (should show ~200)
- ✅ Redis: `docker exec -it ipl-redis redis-cli ping` (should return `PONG`)

---

## 🧪 Manual Testing Scenarios

### Scenario 1: Create Public Auction (Single User)

**Objective**: Test basic auction creation and flow

#### Steps:
1. **Open Frontend** (http://localhost:5173)
   - You should see the Home Page with IPL gradient background
   - Two forms: "Create New Auction" and "Join Auction"

2. **Create Auction**
   - Enter auction name: `Test Auction 1`
   - Select type: `Public`
   - Click **Create Auction**
   - You should be redirected to `/lobby/:auctionId`

3. **Lobby Page**
   - **Verify**:
     - ✅ Auction name displayed: "Test Auction 1"
     - ✅ "0 / 10 teams joined" counter
     - ✅ "👑 Admin" badge visible (you're the creator)
     - ✅ Start Auction button is **disabled** (need 2+ teams)
     - ✅ Yellow warning: "At least 2 teams must join to start the auction"

4. **Select First Team**
   - Click on **CSK** (Chennai Super Kings) card
   - **Verify**:
     - ✅ CSK card now shows "YOU" badge in green
     - ✅ CSK card has colored border
     - ✅ "Your Team" section appears above grid showing CSK details
     - ✅ Retained players visible (MS Dhoni, Ravindra Jadeja, Ruturaj Gaikwad)
     - ✅ Counter updates: "1 / 10 teams joined"
     - ✅ Start button still disabled (need 1 more team)

5. **Open Incognito/Private Window** (http://localhost:5173)
   - Join same auction (copy URL from first window)
   - Select **MI** (Mumbai Indians)
   - **Verify in first window**:
     - ✅ Counter updates: "2 / 10 teams joined"
     - ✅ MI card shows "TAKEN" badge
     - ✅ Start Auction button now **enabled**

6. **Start Auction** (First window as admin)
   - Click **Start Auction**
   - **Verify**:
     - ✅ Redirected to `/auction/:auctionId`
     - ✅ Auction Room page loads
     - ✅ Current player card appears (should be Marquee player M1)
     - ✅ Your team purse visible in header
     - ✅ All 10 teams visible in right sidebar
     - ✅ Round indicator shows "NORMAL"
     - ✅ Set indicator shows "M1"

---

### Scenario 2: Live Bidding Flow

**Objective**: Test real-time bidding with multiple users

#### Steps:

1. **Verify Current Player** (Both windows)
   - **Player Card** should show:
     - ✅ Player name
     - ✅ Role badge (e.g., "Batsman")
     - ✅ Country flag emoji
     - ✅ "Capped" or "Uncapped" badge
     - ✅ Base price display (e.g., ₹200L)
   - **Current Bid**: Large gradient box showing base price

2. **Place First Bid** (Window 1 - CSK)
   - Current bid: ₹200L
   - Bid button shows: "Bid ₹205L" (+₹5L increment)
   - Click **Bid ₹205L**
   - **Verify Both Windows**:
     - ✅ Current bid updates to ₹205L instantly
     - ✅ Bid history shows: "CSK bid ₹205L for [Player]"
     - ✅ CSK purse decreases (₹55cr → ₹52.95cr if player sold at this price)
     - ✅ Timestamp appears in bid history

3. **Place Counter Bid** (Window 2 - MI)
   - Current bid: ₹205L
   - Bid button shows: "Bid ₹210L" (+₹5L increment)
   - Click **Bid ₹210L**
   - **Verify Both Windows**:
     - ✅ Current bid updates to ₹210L
     - ✅ New entry in bid history: "MI bid ₹210L for [Player]"
     - ✅ History auto-scrolls to top
     - ✅ MI purse updates

4. **Rapid Bidding** (Alternate between windows)
   - Place 5-10 bids rapidly
   - **Verify**:
     - ✅ All bids appear in history
     - ✅ No bids are lost
     - ✅ Current bid always shows latest
     - ✅ Purses update correctly
     - ✅ No UI lag or freezing

5. **Bid Increment Changes** (Continue bidding)
   - At ₹100L: Increment changes to ₹10L
   - At ₹200L: Increment changes to ₹20L
   - At ₹500L: Increment changes to ₹25L
   - **Verify**:
     - ✅ Bid button updates with correct increment
     - ✅ Increments follow rules exactly

6. **Purse Validation**
   - Continue bidding until one team runs low on purse
   - **Verify**:
     - ✅ Bid button becomes **disabled** when purse insufficient
     - ✅ Button shows "Insufficient Purse" or similar
     - ✅ Other team can still bid

---

### Scenario 3: Sell Player (Admin Controls)

**Objective**: Test admin selling player and moving to next

#### Steps:

1. **Admin Window** (Window 1 - CSK)
   - After bidding war, admin controls visible below player card
   - Three buttons: **Sell**, **Skip**, **Next**

2. **Sell Player**
   - Click **Sell** button
   - **Verify Both Windows**:
     - ✅ Message appears: "Sold to MI for ₹210L" (or last bid)
     - ✅ Player card disappears after 2 seconds
     - ✅ MI team stats update in sidebar:
       - Players: 5 → 6
       - Overseas: 2 → 3 (if player is overseas)
       - Purse: Decreases by sold amount
     - ✅ Bid history remains visible for 2 seconds
     - ✅ Admin clicks **Next**

3. **Load Next Player**
   - Click **Next** button
   - **Verify Both Windows**:
     - ✅ New player card appears
     - ✅ Bid history cleared
     - ✅ Current bid reset to new base price
     - ✅ Set updates if moved to next set (M1 → M2)
     - ✅ Round stays "NORMAL"

---

### Scenario 4: RTM (Right to Match) Flow

**Objective**: Test complete RTM mechanics

#### Prerequisites:
- Continue from Scenario 3
- Find a player who was retained by a team (check seed data)
- Player's 2024 team must be one of the auction teams
- That team must have RTM cards remaining

#### Steps:

1. **Find RTM-Eligible Player**
   - Load players until you find one with `team2024` matching an auction team
   - Example: If CSK retained Dhoni, and he comes up for auction
   - Let **MI** win the bid (not CSK)

2. **Admin Sells to MI**
   - MI has highest bid at ₹180L
   - Admin clicks **Sell**
   - **Verify Both Windows**:
     - ✅ Instead of "Sold", RTM banner appears
     - ✅ Banner shows: "RTM Triggered!"
     - ✅ "CSK can match ₹180L for [Player]"
     - ✅ CSK sees "Use RTM" button
     - ✅ MI sees "Waiting for CSK..."
     - ✅ Admin sees both teams' status

3. **CSK Uses RTM** (Window 1 - CSK)
   - Click **Use RTM** button
   - **Verify Both Windows**:
     - ✅ RTM banner updates: "CSK matched ₹180L"
     - ✅ "MI can raise bid once"
     - ✅ MI sees "Counter-Bid" button with new amount (₹200L)
     - ✅ CSK sees "Waiting for MI counter-bid..."
     - ✅ Admin sees "Finalize RTM" button

4. **MI Counter-Bids** (Window 2 - MI)
   - MI has ONE chance to raise
   - Click **Counter-Bid ₹200L**
   - **Verify Both Windows**:
     - ✅ RTM banner updates: "MI counter-bid ₹200L"
     - ✅ "CSK must match ₹200L or pass"
     - ✅ Counter-bid button becomes **disabled** (only ONE counter allowed)
     - ✅ Admin sees current state

5. **Admin Finalizes RTM**
   - Admin has two choices:

   **Option A: CSK Accepts (matches ₹200L)**
   - Admin clicks **Accept**
   - **Verify Both Windows**:
     - ✅ "Sold to CSK for ₹200L (RTM)" message
     - ✅ CSK team stats update:
       - RTM cards: 3 → 2
       - Purse: Decreases by ₹200L (₹2cr)
       - Players: Increases by 1
     - ✅ RTM banner clears after 2 seconds
     - ✅ Player card disappears

   **Option B: CSK Passes**
   - Admin clicks **Pass**
   - **Verify Both Windows**:
     - ✅ "Sold to MI for ₹200L" message
     - ✅ MI team stats update
     - ✅ CSK RTM cards unchanged (didn't use)
     - ✅ RTM banner clears

6. **RTM Card Limits**
   - Continue auction and trigger more RTMs
   - **Verify**:
     - ✅ Capped player RTMs limited to 5 total
     - ✅ Uncapped player RTMs limited to 2 total
     - ✅ Once limits reached, RTM doesn't trigger for that team
     - ✅ RTM cards remaining shown in sidebar

---

### Scenario 5: Skip Player (Unsold)

**Objective**: Test admin skipping unsold players

#### Steps:

1. **Load Player with Low Base Price**
   - Find player with ₹30L base price
   - No one bids (or bids are too low)

2. **Admin Skips**
   - Click **Skip** button
   - **Verify Both Windows**:
     - ✅ Message: "[Player] went unsold"
     - ✅ Player card disappears after 2 seconds
     - ✅ No team stats change
     - ✅ Bid history shows no sale
     - ✅ Admin clicks **Next** to continue

---

### Scenario 6: Round Transitions

**Objective**: Test Normal → AR1 → AR2 transitions

#### Prerequisites:
- Need backend REST endpoints for transitions
- Or continue auction until all Marquee, Batsmen sets complete

#### Steps:

1. **Complete Normal Round**
   - Continue auction through all player sets:
     - M1, M2 (Marquee)
     - BA1, BA2 (Batsmen)
     - BO1, BO2 (Bowlers)
     - AR1, AR2 (All-rounders)
     - WK (Wicket-keepers)

2. **Admin Transitions to AR1**
   - Use REST endpoint or admin command
   ```bash
   curl -X POST http://localhost:3001/api/auctions/:auctionId/transition-ar1 \
     -H "Content-Type: application/json" \
     -d '{"adminSessionId": "your-admin-token"}'
   ```
   - **Verify Both Windows**:
     - ✅ Round indicator changes: "NORMAL" → "ACCELERATED_1"
     - ✅ Unsold players from Normal round loaded
     - ✅ Admin can select specific players

3. **Admin Transitions to AR2**
   - After AR1 completes
   - Similar REST call with `/transition-ar2`
   - **Verify**:
     - ✅ Round indicator: "ACCELERATED_2"
     - ✅ Remaining unsold players loaded

---

### Scenario 7: End Auction

**Objective**: Test auction completion

#### Steps:

1. **Admin Ends Auction**
   ```bash
   curl -X POST http://localhost:3001/api/auctions/:auctionId/end \
     -H "Content-Type: application/json" \
     -d '{"adminSessionId": "your-admin-token"}'
   ```

2. **Verify Both Windows**:
   - ✅ Auction status changes to "completed"
   - ✅ Final standings displayed
   - ✅ All team rosters visible
   - ✅ Purse remaining for each team
   - ✅ No further bidding allowed

---

## 🔍 Debugging & Troubleshooting

### Check Backend Logs
```bash
# In backend terminal, you'll see:
# - WebSocket connections
# - Bid events
# - RTM triggers
# - Errors (if any)
```

### Check Frontend Console
```bash
# Open browser DevTools (F12)
# Console tab shows:
# - "Bid placed: {...}"
# - "New player: {...}"
# - "RTM triggered: {...}"
# - Any errors
```

### Redux DevTools
```bash
# Install Redux DevTools browser extension
# Open extension in browser
# You can:
# - See entire Redux state tree
# - Time-travel through actions
# - Inspect action payloads
# - Replay actions
```

### WebSocket Connection Issues
```bash
# If bids don't update in real-time:

# 1. Check backend WebSocket is running
curl http://localhost:3001/socket.io/?EIO=4&transport=polling

# 2. Check frontend WebSocket URL
# In apps/frontend/src/services/socket.ts
# Should be: http://localhost:3001

# 3. Check CORS
# Backend should allow frontend origin
# In apps/backend/src/main.ts: cors({ origin: 'http://localhost:5173' })
```

### Database Issues
```bash
# Check database has data
docker exec -it ipl-postgres psql -U ipl_user -d ipl_auction

# Inside psql:
\dt                           # List tables
SELECT COUNT(*) FROM "Player"; # Should show ~200
SELECT COUNT(*) FROM "Team";   # Should show 10
SELECT * FROM "Team" LIMIT 1; # Verify team structure

# If no data, reseed:
cd apps/backend
pnpm prisma db seed
```

### Redis Connection Issues
```bash
# Check Redis is running
docker exec -it ipl-redis redis-cli ping
# Should return: PONG

# Check Redis has data during auction
docker exec -it ipl-redis redis-cli
# Inside redis-cli:
KEYS *                        # List all keys
GET auction:YOUR_AUCTION_ID:current_player
GET auction:YOUR_AUCTION_ID:rtm
```

---

## 🧪 Automated Testing (Future)

### Unit Tests (Redux Slices)
```bash
# apps/frontend/src/store/slices/__tests__/auctionSlice.test.ts

import { configureStore } from '@reduxjs/toolkit';
import auctionReducer, { addBidToHistory, setRTMState } from '../auctionSlice';

describe('auctionSlice', () => {
  it('should add bid to history', () => {
    const store = configureStore({ reducer: { auction: auctionReducer } });
    store.dispatch(addBidToHistory({
      id: '1', timestamp: '2025-10-16', teamName: 'CSK',
      bidAmountLakh: 100, playerName: 'Virat Kohli'
    }));
    expect(store.getState().auction.bidHistory).toHaveLength(1);
  });
});
```

### Integration Tests (WebSocket Events)
```bash
# apps/frontend/src/services/__tests__/socket.test.ts

import { io } from 'socket.io-client';
import socketService from '../socket';

describe('WebSocket Service', () => {
  it('should emit bid_placed event', () => {
    const mockSocket = io('http://localhost:3001');
    socketService.placeBid('auction123', 'player456', 'team789', 100);
    // Verify emit was called with correct payload
  });
});
```

### E2E Tests (Playwright)
```bash
# tests/e2e/auction-flow.spec.ts

import { test, expect } from '@playwright/test';

test('complete auction flow', async ({ page, context }) => {
  // Admin creates auction
  await page.goto('http://localhost:5173');
  await page.fill('input[name="auctionName"]', 'E2E Test');
  await page.click('button:has-text("Create Auction")');

  // Admin selects team
  await page.click('text=CSK');

  // User 2 joins (new page)
  const page2 = await context.newPage();
  await page2.goto(page.url());
  await page2.click('text=MI');

  // Admin starts auction
  await page.click('button:has-text("Start Auction")');

  // Both users see current player
  await expect(page.locator('.player-card')).toBeVisible();
  await expect(page2.locator('.player-card')).toBeVisible();

  // User 1 places bid
  await page.click('button:has-text("Bid")');

  // Both see updated bid
  await expect(page.locator('.bid-history')).toContainText('CSK');
  await expect(page2.locator('.bid-history')).toContainText('CSK');
});
```

---

## ✅ Testing Checklist

Use this checklist to ensure all features work:

### Basic Flow
- [ ] Create public auction
- [ ] Create private auction with room code
- [ ] Join auction by room code (404 on invalid code)
- [ ] Select team in lobby
- [ ] View retained players in lobby
- [ ] Start auction (admin, 2+ teams)
- [ ] Cannot start with <2 teams

### Bidding
- [ ] Place first bid (base price)
- [ ] Place counter-bid
- [ ] Rapid bidding (no lost bids)
- [ ] Bid increments (₹5L/₹10L/₹20L/₹25L)
- [ ] Purse validation (cannot bid without funds)
- [ ] Bid history updates real-time
- [ ] Bid history auto-scrolls
- [ ] Team purse decreases correctly

### Admin Controls
- [ ] Sell player to highest bidder
- [ ] Skip player (unsold)
- [ ] Load next player
- [ ] Player progression (M1→M2→BA1→...)
- [ ] Round transitions (Normal→AR1→AR2)
- [ ] End auction

### RTM Flow
- [ ] RTM triggers on eligible player
- [ ] Original team can match bid
- [ ] Original winner can counter-bid (ONCE)
- [ ] Admin finalizes (accept/pass)
- [ ] RTM card consumption
- [ ] Capped limit (max 5)
- [ ] Uncapped limit (max 2)
- [ ] RTM doesn't trigger when no cards

### UI/UX
- [ ] Responsive design (mobile, tablet, desktop)
- [ ] IPL team colors accurate
- [ ] Loading states
- [ ] Error messages
- [ ] Toasts/notifications
- [ ] WebSocket reconnection
- [ ] Session persistence (refresh page)

### Multi-User
- [ ] 2 users in same auction
- [ ] 5+ users in same auction
- [ ] All users see same state
- [ ] No race conditions in bidding
- [ ] WebSocket sync <100ms

---

## 📊 Performance Testing

### Load Testing with Artillery
```bash
# Install Artillery
npm install -g artillery

# Create load test config
# artillery-config.yml
config:
  target: 'http://localhost:3001'
  phases:
    - duration: 60
      arrivalRate: 10  # 10 users per second
scenarios:
  - name: "Join auction and bid"
    engine: socketio
    flow:
      - emit:
          channel: "join_auction"
          data:
            auctionId: "test-auction"
            teamId: "team123"
            sessionId: "{{ $randomString() }}"
      - think: 2
      - emit:
          channel: "place_bid"
          data:
            auctionId: "test-auction"
            playerId: "player456"
            teamId: "team123"
            bidAmountLakh: 100

# Run test
artillery run artillery-config.yml
```

---

## 🎯 Success Criteria

**Auction is production-ready when**:
- ✅ All checklist items pass
- ✅ 10+ concurrent users tested
- ✅ No WebSocket disconnections
- ✅ All bids reflected in <100ms
- ✅ RTM flow works end-to-end
- ✅ No data loss or corruption
- ✅ Redux state consistent across clients
- ✅ No console errors
- ✅ Responsive on mobile/tablet/desktop

---

**Happy Testing! 🎉**

If you encounter issues, check the Debugging section or open an issue with:
1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Console logs (frontend + backend)
5. Redux state snapshot
