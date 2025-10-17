# Product Requirements Document: IPL Auction Simulation Platform

**Version:** 2.0
**Date:** October 17, 2025
**Status:** Implemented (MVP Complete)
**Project:** IPL Auction Agentic Platform

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Overview](#2-product-overview)
3. [User Requirements](#3-user-requirements)
4. [Functional Requirements](#4-functional-requirements)
5. [Auction Mechanics (IPL 2024)](#5-auction-mechanics-ipl-2024)
6. [Technical Architecture](#6-technical-architecture)
7. [Database Design](#7-database-design)
8. [API & WebSocket Specifications](#8-api--websocket-specifications)
9. [UI/UX Requirements](#9-uiux-requirements)
10. [Deployment & Infrastructure](#10-deployment--infrastructure)
11. [Future Scope](#11-future-scope)

---

## 1. Executive Summary

### 1.1 Product Vision
Build a **real-time, multiplayer IPL auction simulation platform** that allows cricket fans to experience authentic team-building through the **IPL 2024 Mega Auction** format with actual player data, retentions, and auction mechanics.

### 1.2 Key Highlights ✅
- **574 players** from real IPL 2024 auction pool ✅
- **Real team retentions** for all 10 IPL franchises ✅
- **79 auction sets** across Marquee, Capped, and Uncapped categories ✅
- **Unlimited simultaneous auctions** with real-time WebSocket bidding ✅
- **₹120 crore base purse** per team (adjusted for retentions) ✅
- **Advanced RTM mechanics** with three-stage flow (RTM trigger → Counter-bid → Finalization) ✅
- **Three-round system** (Normal → Accelerated 1 → Accelerated 2) with admin-controlled progression ✅
- **Real-time state synchronization** on page refresh/rejoin ✅
- **Three-tab interface** (Auction, Pool, Squads) for comprehensive auction monitoring ✅
- **Containerized architecture** (Docker Compose → Kubernetes-ready) ✅

### 1.3 Target Users
1. **Individual fans** simulating auctions for practice/fun
2. **Friend groups** conducting private competitive auctions
3. **Cricket enthusiasts** exploring team-building strategies

---

## 2. Product Overview

### 2.1 Core Features

#### Phase 1: IPL 2024 Mega Auction (MVP) ✅ COMPLETED
| Feature | Description | Status |
|---------|-------------|--------|
| **Real-time Multiplayer Bidding** | WebSocket-based live auctions for up to 10 teams | ✅ Implemented |
| **Actual IPL 2024 Data** | 574 real players with retentions & auction sets | ✅ Implemented |
| **Private Auctions** | Room codes for friend groups with secure join | ✅ Implemented |
| **Admin Controls** | Auction management, player set selection, round progression | ✅ Implemented |
| **Advanced RTM System** | Three-stage RTM flow with counter-bid mechanics | ✅ Implemented |
| **Multi-Round System** | Normal, AR1, multiple AR2 rounds with auto-advance | ✅ Implemented |
| **Auction End Flow** | Admin-triggered end with tab lock and final standings | ✅ Implemented |
| **Real-time State Sync** | Complete auction state sync on page refresh/rejoin | ✅ Implemented |
| **Pool & Squad Views** | Three-tab interface (Auction, Pool, Squads) | ✅ Implemented |
| **Cross-Auction Isolation** | Independent auction instances with data isolation | ✅ Implemented |
| **Budget Tracking** | Real-time purse updates with constraint validation | ✅ Implemented |
| **Team Analytics** | Squad composition, budget tracking, role distribution | 🔄 Partial (Squads tab) |
| **Auction History** | Complete event log with export capability | 📋 Planned |

#### Phase 2: Extended Features (Future)
- Mini Auction mode with player releases
- User authentication & persistent profiles
- Auto-bidding & advanced AI strategies
- Mobile apps (iOS/Android)

### 2.2 Technical Stack

```
Frontend:  React 18 + TypeScript + TailwindCSS + Socket.io Client
Backend:   Node.js 20 + Express/Fastify + Socket.io + TypeScript
Database:  PostgreSQL 15 + Redis 7
DevOps:    Docker Compose → Kubernetes (future)
```

---

## 3. User Requirements

### 3.1 User Personas

**Persona 1: The Strategy Enthusiast (Rahul, 28)**
- Software engineer, avid IPL follower
- **Goals:** Practice auction strategies, understand team dynamics
- **Needs:** Authentic IPL mechanics, player recommendations, detailed analytics

**Persona 2: The Social Gamer (Priya, 24)**
- Marketing professional, hosts game nights with friends
- **Goals:** Fun auction experiences with friends
- **Needs:** Private lobbies, simple setup, real-time excitement

**Persona 3: The Auction Administrator (Arjun, 32)**
- Cricket league organizer
- **Goals:** Manage structured auctions for clubs
- **Needs:** Admin controls, round management, fair play enforcement

### 3.2 User Stories

```
US-1: As a user, I want to create a private auction lobby,
      So that I can invite 9 friends to build teams together.

US-2: As a team owner, I want to bid on players in real-time,
      So that I can strategically build my squad within budget.

US-3: As an admin, I want to control auction round progression,
      So that I can manage Normal, Accelerated 1, and Accelerated 2 rounds.

US-4: As a team owner, I want to use RTM (Right to Match) cards,
      So that I can reclaim players my team had before the auction.

US-5: As a user, I want to see player recommendations,
      So that I can identify which positions need strengthening.
```

---

## 4. Functional Requirements

### 4.1 Auction Lobby Management

**FR-1: Auction Creation**
- User inputs auction name (3-50 characters)
- User Selects auction type: Private or Public
- User gets sharable link after auction creation. Other players (non-admins) can join and select a team in the auction using this link 
- System initializes 10 IPL teams with real retentions from CSV
- Creator becomes auction admin

**FR-2: Joining Auctions**
- **Private:** Enter room code → select available team
- **Public:** Browse list → select team
- First-come-first-served team assignment
- Max 10 users (one per team)

**FR-3: Team Selection**
- Display all 10 IPL teams with:
  - Team name & logo
  - Retained players
  - Remaining purse (₹120cr - retention costs)
  - RTM cards available
- Lock team once selected

---

### 4.2 Real-time Bidding System

**FR-4: Player Display**
- Show current player:
  - Name, role, country, age
  - Base price (₹30L - ₹200L)
  - Current bid & bidding team
  - Previous IPL team (for RTM eligibility)

**FR-5: Bid Placement**
- **Dynamic bid increments:**
  - ₹30L - ₹1cr: increment ₹5L
  - ₹1cr - ₹2cr: increment ₹10L
  - ₹2cr - ₹5cr: increment ₹20L
  - ₹5cr+: increment ₹25L
- **Validations:**
  - Team has sufficient purse
  - Squad size between 18-25
  - Overseas count < 8 (if overseas player)
- Bid propagates to all clients <100ms

**FR-6: RTM (Right to Match)** ✅ IMPLEMENTED
**Three-Stage RTM Flow:**

**Stage 1: RTM Trigger**
- Eligible if player's 2024 team matches user's team and user has RTM cards available
- RTM button appears after highest bidder is determined
- RTM team can either:
  - Click "Use RTM" → proceed to Stage 2
  - Click "Pass" → player goes to original winner

**Stage 2: Counter-Bid Opportunity**
- RTM team matches highest bid automatically
- Original winner can make ONE final counter-bid with increased price (bid increment applied)
- Original winner can:
  - Make counter-bid → proceed to Stage 3
  - Pass → player goes to RTM team

**Stage 3: RTM Team Final Decision**
- RTM team sees the counter-bid amount
- RTM team can:
  - Click "Match Counter-Bid" (Accept) → player goes to RTM team, RTM card consumed
  - Click "Pass" → player goes to original winner at counter-bid price

**RTM Card Consumption:**
- Consumes one RTM card (either capped or uncapped based on player type)
- Updates `rtmCardsUsed`, `rtmCappedUsed`, or `rtmUncappedUsed`
- Real-time UI updates for all teams showing RTM card counts

**Validations:**
- RTM team must have available RTM cards (based on capped/uncapped limits)
- RTM team must have sufficient purse for matching
- Original winner must have sufficient purse for counter-bid

**FR-7: Player Sold/Unsold**
- **Sold:** Admin clicks on Sell player button
- **Unsold:** No bids at all → mark unsold, add to Accelerated Round 2
- Update team purse, roster, constraints

---

### 4.3 Auction Round Management

**FR-8: Round Progression** ✅ IMPLEMENTED

**Normal Round:**
- Capped players from sets M1, M2, BA1, AL1, WK1, FA1, SP1, UBA1, UAL1, UWK1, UFA1, USP1, BA2, AL2, WK2, FA2, SP2 (Sets 1-17)
- Sequential set progression
- Auto-advance after each player sold/unsold
- ~220+ players

**Accelerated Round 1:** ✅
- **Player Selection**: Admin selects from "not presented" players starting from Set UBA2 (Set 18) onwards
- **Exclusions**: Does NOT include unsold players from Normal Round
- **Queue System**: All selected players are queued in Redis
- **Auto-advance**: Automatically loads next player from queue after each sale/RTM completion
- **Round Complete**: Shows transition button to AR2 when queue is empty

**Accelerated Round 2:** ✅
- **Player Pool**: ALL unsold players from Normal Round + AR1 + remaining "not presented" players
- **Player Selection**: Admin selects specific players from available pool
- **Queue System**: Same auto-advance queue mechanism as AR1
- **Multiple AR2 Rounds**: Admin can run AR2 multiple times by selecting different player batches each time
- **Sorting**: Players sorted by set order (M1, M2, BA1, AL1, WK1, FA1, SP1, UBA1, UAL1, UWK1, UFA1, USP1, BA2, AL2, WK2, FA2, SP2, UBA2, UAL2, UWK2, UFA2, USP2, BA3, AL3, WK3, FA3, SP3, UBA3, UAL3, UWK3, UFA3, USP3, BA4, AL4, WK4, FA4, SP4, UBA4, UAL4, UWK4, UFA4, USP4, BA5, AL5, WK5, FA5, SP5, UBA5, UAL5, UWK5, UFA5, USP5, BA6, AL6, WK6, FA6, SP6, UBA6, UAL6, UWK6, UFA6, USP6)

**FR-9: Admin Controls** ✅ IMPLEMENTED
- Start auction (load first player from Normal Round)
- Sell player (finalize current player sale)
- Mark unsold (mark player as unsold, add to AR2 pool)
- Load next player (manual advance if needed)
- Transition to AR1 (after Normal Round complete)
- Select and queue AR1 players (multi-select modal with sorted players)
- Transition to AR2 (after AR1 complete)
- Select and queue AR2 players (multi-select modal with all unsold + remaining)
- Run multiple AR2 rounds (admin can select and queue more players after AR2 queue empties)
- End auction (finalizes auction, disables bidding, switches all users to Squads tab view)

---

### 4.4 Team Management

**FR-10: Squad Constraints**
- Min players: 18
- Max players: 25
- Max overseas: 8
- Base purse: ₹120 crore
- Adjusted purse: ₹120cr - (retention costs)

**FR-11: Budget Tracking**
- Real-time purse updates
- Expenditure by role
- Remaining budget vs slots
- Constraint warnings

**FR-12: Roster Display**
- All purchased players
- Retained vs purchased indicator
- Role-wise grouping
- Sort by price/name/role

---

### 4.5 Analytics & Insights

**FR-13: Auction History**
- Chronological player-by-player log
- Columns: Player, Set, Base price, Final price, Team
- Filter by set, team, role, nationality
- Export as CSV

**FR-14: Team Comparison**
- Select 2+ teams for side-by-side view
- Metrics:
  - Total spend vs purse remaining
  - Squad size
  - Overseas distribution
  - Role-wise breakdown (bar chart)
  - Most expensive player
  - Average player cost

**FR-15: Player Recommendations**
- Analyze team composition gaps
- Suggest unsold players by:
  - Role deficiency (e.g., need bowlers)
  - Budget compatibility
  - Overseas slots available
- Top 5-10 recommendations with reasons

**FR-16: Real-time State Synchronization** ✅ IMPLEMENTED
- **Complete State Restoration**: When any user refreshes page or rejoins auction, they receive:
  - All teams' complete stats (purse, player count, overseas count, RTM cards)
  - Current player being auctioned (if any)
  - Current bid and bidding team
  - Active RTM state (if RTM process is ongoing)
  - Current round and set information
- **Cross-Client Sync**: All clients stay synchronized within <100ms latency
- **WebSocket Event**: `auction_joined` broadcasts full state on connection
- **Fields Synchronized**:
  - `allTeams`: Complete stats for all 10 teams
  - `currentPlayer`: Player details with current bid
  - `rtmState`: Active RTM flow (stage, teams involved, amounts)
  - `auction`: Round, set, status

**FR-17: Three-Tab Interface** ✅ IMPLEMENTED
**Auction Tab** (Default):
- Live bidding interface
- Current player display
- Bid history
- RTM controls
- Team sidebar with stats

**Pool Tab**:
- **Sold Players** (Green column): Shows all players purchased with team names and final prices
- **Pending Players** (Blue column): Shows players not yet presented in auction
- **Unsold Players** (Red column): Shows players marked as unsold
- **Real-time Updates**: Data refreshes when tab is activated
- **Player Counts**: Shows count in each category header

**Squads Tab**:
- Grid layout showing all 10 team rosters
- Each team card shows:
  - Team name
  - Current purse remaining
  - Player count and overseas count
  - RTM cards used/total
  - Complete player list with purchase prices
  - Retained player badges
- **Scrollable Lists**: Team rosters scroll independently
- **Real-time Updates**: Data refreshes when tab is activated

**FR-18: Auction End Flow** ✅ IMPLEMENTED

**End Auction Trigger:**
- **Admin-Initiated**: Admin clicks "End Auction" button (available in AR2 interface)
- **Confirmation**: System prompts admin to confirm action (irreversible)

**Backend Actions:**
1. Updates auction status to `completed` in database
2. Sets `endedAt` timestamp
3. Clears current player and bidding state
4. Broadcasts `auction_ended` WebSocket event to all connected clients
5. Returns final standings with team rosters and statistics

**Frontend Behavior:**
1. **Automatic Tab Switch**: All users immediately switched to Squads tab
2. **Tab Navigation Disabled**: Auction and Pool tabs become disabled (grayed out, cursor-not-allowed)
3. **Visual Feedback**:
   - Auction tab: Gray background, 60% opacity, no hover effects
   - Pool tab: Gray background, 60% opacity, no hover effects
   - Squads tab: Remains fully functional and active
4. **State Persistence**: If user refreshes page, they remain on Squads tab with other tabs disabled
5. **No Re-activation**: Once ended, auction cannot be restarted

**WebSocket Events:**
- `end_auction` (client → server): Admin triggers auction end
- `auction_ended` (server → all clients): Broadcast auction completion with final standings

---

## 5. Auction Mechanics (IPL 2024)

### 5.1 Team Retentions (Real Data)

Based on `auction.csv`, teams have retained players with costs deducted:

| Team | Retention Cost (₹cr) | Remaining Purse | RTM Cards | Sample Retentions |
|------|---------------------|-----------------|-----------|-------------------|
| **RCB** | 37 | 83 | 3 | Virat Kohli (₹21cr), Rajat Patidar (₹11cr), Yash Dayal (₹5cr) |
| **RR** | 79 | 41 | 0 | Sanju Samson (₹18cr), Jaiswal (₹18cr), Riyan Parag (₹14cr), Dhruv Jurel (₹14cr), Hetmyer (₹11cr), Sandeep (₹4cr) |
| **CSK** | 65 | 55 | 1 | Gaikwad (₹18cr), Jadeja (₹18cr), Dube (₹13cr), Pathirana (₹12cr), Dhoni (₹4cr) |
| **KKR** | 57 | 63 | 0 | Rinku (₹18cr), Narine (₹14cr), Russell (₹18cr), Varun (₹11cr), Harshit (₹4cr), Ramandeep (₹4cr) |
| **PBKS** | 9.5 | 110.5 | 4 | Shashank (₹5.5cr), Prabhsimran (₹4cr) |
| **DC** | 47 | 73 | 2 | Axar (₹18cr), Kuldeep (₹14cr), Tristan Stubbs (₹11cr), Abishek Porel (₹4cr) |
| **LSG** | 51 | 69 | 1 | Pooran (₹21cr), Bishnoi (₹11cr), Mayank Yadav (₹11cr), Mohsin (₹4cr), Ayush Badoni (₹4cr) |
| **SRH** | 75 | 45 | 1 | Klassen (₹23cr), Cummins (₹18cr), Abhishek (₹14cr), Head (₹14cr), Nitish (₹6cr) |
| **GT** | 51 | 69 | 1 | Rashid (₹18cr), Gill (₹16.5cr), Sai Sudarsan (₹8.5cr), Shahrukh (₹4cr), Tewatia (₹4cr) |
| **MI** | 75 | 45 | 1 | Bumrah (₹18cr), SKY (₹16.35cr), Hardik (₹16.35cr), Rohit (₹16.3cr), Tilak (₹8cr) |

**RTM Card Allocation:**
- Total of 6 Retentions + RTMs
- Maximum of 5 Capped Retentions + RTMs
- Maximum of 2 Uncapped Retentions + RTMs

---

### 5.2 Player Pool (574 Players)

**Auction Set Structure:**

| Category | Sets | Example Players | Count |
|----------|------|-----------------|-------|
| **Marquee** | M1, M2 | Jos Buttler, Shreyas Iyer, Rishabh Pant, Kagiso Rabada, Arshdeep, Starc, Chahal, Livingstone, Miller, KL Rahul, Shami, Siraj | 12 |
| **Batsmen (Capped)** | BA1-BA5 | Harry Brook, Devon Conway, Jake Fraser-McGurk, Aiden Markram, David Warner, Faf, Prithvi Shaw, Kane Williamson, Steve Smith | 50+ |
| **All-Rounders (Capped)** | AL1-AL10 | Ashwin, Venkatesh Iyer, Mitchell Marsh, Glenn Maxwell, Harshal Patel, Sam Curran, Marco Jansen, Krunal Pandya, Nitish Rana | 80+ |
| **Wicket-keepers (Capped)** | WK1-WK4 | Jonny Bairstow, Quinton de Kock, Rahmanullah Gurbaz, Ishan Kishan, Phil Salt, Jitesh Sharma | 25+ |
| **Fast Bowlers (Capped)** | FA1-FA10 | Khaleel Ahmed, Trent Boult, Josh Hazlewood, Avesh Khan, Prasidh Krishna, Natarajan, Nortje, Mustafizur, Alzarri Joseph | 70+ |
| **Spinners (Capped)** | SP1-SP3 | Noor Ahmad, Rahul Chahar, Wanindu Hasaranga, Maheesh Theekshana, Adam Zampa, Tabraiz Shamsi | 20+ |
| **Uncapped Batsmen** | UBA1-UBA9 | Yash Dhull, Abhinav Manohar, Angkrish Raghuvanshi, Nehal Wadhera | 70+ |
| **Uncapped All-Rounders** | UAL1-UAL15 | Harpreet Brar, Naman Dhir, Mahipal Lomror, Abdul Samad, Ashutosh Sharma | 120+ |
| **Uncapped Wicket-keepers** | UWK1-UWK6 | Aryan Juyal, Kumar Kushagra, Anuj Rawat, Upendra Yadav | 40+ |
| **Uncapped Fast Bowlers** | UFA1-UFA10 | Vaibhav Arora, Rasikh Dar, Akash Madhwal, Yash Thakur, Kartik Tyagi | 70+ |
| **Uncapped Spinners** | USP1-USP5 | Piyush Chawla, Shreyas Gopal, Mayank Markande, Karn Sharma | 30+ |

**Base Prices:**
- Capped players: ₹75L/₹100L/₹125L/₹150L/₹200L
- Uncapped players: ₹30L/₹40L/₹50L

---

### 5.3 Bidding Rules

**Bid Increments:**
```
Current Bid          Increment
₹30L - ₹1cr     →    ₹5 lakh
₹1cr - ₹2cr     →    ₹10 lakh
₹2cr - ₹5cr     →    ₹20 lakh
₹5cr+           →    ₹25 lakh
```

**RTM Mechanics:** ✅ IMPLEMENTED (Advanced Three-Stage Flow)

**Stage 1: RTM Trigger**
```
Player reaches winning bid → RTM-eligible team sees "Use RTM" / "Pass" buttons
→ If "Use RTM": Proceed to Stage 2
→ If "Pass": Player sold to original winner
```

**Stage 2: Counter-Bid Opportunity**
```
RTM team matches bid → Original winner sees "Counter-Bid ₹X" / "Pass" buttons
→ If Counter-Bid: Proceed to Stage 3 with new amount
→ If Pass: Player goes to RTM team at original amount
```

**Stage 3: RTM Final Decision**
```
RTM team sees counter-bid amount → "Match Counter-Bid" / "Pass" buttons
→ If Match: Player goes to RTM team at counter-bid price, RTM card consumed
→ If Pass: Player goes to original winner at counter-bid price
```

**Implementation Details:**
- **Redis State Management**: RTM state stored in Redis with stage tracking
- **WebSocket Events**:
  - `rtm_triggered`: Broadcasts RTM opportunity
  - `rtm_used`: RTM team used card (Stage 1 → Stage 2)
  - `rtm_counter_bid_placed`: Original winner counter-bid (Stage 2 → Stage 3)
  - `rtm_finalized`: Final decision made (Stage 3 → Player sold)
- **Card Consumption**: Updates `rtmCardsUsed`, `rtmCappedUsed`, `rtmUncappedUsed` in real-time
- **Cross-Auction Isolation**: RTM state is auction-specific, no data leakage

---

## 6. Technical Architecture

### 6.1 System Diagram

```
┌────────────── CLIENT LAYER ──────────────┐
│  React 18 + TypeScript + Socket.io       │
│  - Auction Lobby UI                      │
│  - Live Bidding Interface                │
│  - Team Dashboard                        │
│  - Admin Panel                           │
└──────────────┬───────────────────────────┘
               │ WebSocket + HTTP
┌──────────────┴───────────────────────────┐
│       APPLICATION LAYER (Node.js)        │
│  ┌─────────────┐    ┌─────────────────┐  │
│  │  REST API   │    │  WebSocket      │  │
│  │  (Express)  │    │  (Socket.io)    │  │
│  └─────────────┘    └─────────────────┘  │
│  ┌─────────────────────────────────────┐ │
│  │    Business Logic                   │ │
│  │  - Auction Engine (bidding logic)   │ │
│  │  - Validation (purse, constraints)  │ │
│  │  - RTM Handler                      │ │
│  │  - Analytics Engine                 │ │
│  └─────────────────────────────────────┘ │
└──────────────┬───────────────────────────┘
               │
┌──────────────┴───────────────────────────┐
│          DATA LAYER                      │
│  ┌──────────────┐    ┌──────────────┐   │
│  │ PostgreSQL   │    │    Redis     │   │
│  │ (Players,    │    │  (Sessions,  │   │
│  │  Teams,      │    │   Auction    │   │
│  │  Auctions)   │    │   State)     │   │
│  └──────────────┘    └──────────────┘   │
└──────────────────────────────────────────┘
```

### 6.2 Technology Stack

**Frontend:**
- React 18 with TypeScript
- State: Zustand or Redux Toolkit
- UI: TailwindCSS + Shadcn/ui
- Real-time: Socket.io Client
- Charts: Recharts

**Backend:**
- Runtime: Node.js 20 LTS
- Framework: Express.js or Fastify
- Language: TypeScript
- WebSocket: Socket.io
- Validation: Zod
- ORM: Prisma

**Database:**
- Primary: PostgreSQL 15
- Cache/Sessions: Redis 7

**DevOps:**
- Containers: Docker
- Orchestration: Docker Compose (MVP) → Kubernetes (Phase 2)
- Reverse Proxy: Nginx

---

## 7. Database Design

### 7.1 Schema

#### **players**
```sql
CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    country VARCHAR(50) NOT NULL,
    age INTEGER,
    role VARCHAR(30) NOT NULL, -- 'BATTER', 'BOWLER', 'ALL-ROUNDER', 'WICKETKEEPER'
    specialism VARCHAR(100), -- 'RIGHT ARM Fast', 'LEFT ARM Slow Orthodox', etc.
    base_price_lakh INTEGER NOT NULL, -- in lakhs (30, 50, 75, 100, 125, 150, 200)
    auction_set VARCHAR(10), -- 'M1', 'BA3', 'UAL5', etc.
    is_capped BOOLEAN NOT NULL, -- Capped/Uncapped/Associate
    is_overseas BOOLEAN DEFAULT false,
    ipl_team_2024 VARCHAR(10), -- 'RCB', 'CSK', 'MI', etc. (for RTM)
    ipl_matches INTEGER, -- 2024 IPL matches played
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_players_set ON players(auction_set);
CREATE INDEX idx_players_role ON players(role);
CREATE INDEX idx_players_team ON players(ipl_team_2024);
```

#### **auctions**
```sql
CREATE TABLE auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    room_code VARCHAR(6) UNIQUE, -- for private auctions
    type VARCHAR(10) NOT NULL, -- 'public', 'private'
    status VARCHAR(20) DEFAULT 'waiting', -- 'waiting', 'in_progress', 'completed'
    current_round VARCHAR(20), -- 'normal', 'accelerated_1', 'accelerated_2'
    current_set VARCHAR(10), -- 'M1', 'BA2', etc.
    current_player_id UUID,
    current_bid_lakh INTEGER, -- in lakhs
    current_bidding_team_id UUID,
    timer_seconds INTEGER DEFAULT 60,
    admin_session_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    ended_at TIMESTAMP,

    FOREIGN KEY (current_player_id) REFERENCES players(id),
    FOREIGN KEY (current_bidding_team_id) REFERENCES auction_teams(id)
);

CREATE INDEX idx_auctions_status ON auctions(status);
CREATE INDEX idx_auctions_room_code ON auctions(room_code);
```

#### **auction_teams**
```sql
CREATE TABLE auction_teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    team_name VARCHAR(10) NOT NULL, -- 'RCB', 'CSK', 'MI', etc.
    owner_session_id VARCHAR(100), -- user session controlling team
    base_purse_cr DECIMAL(5,2) DEFAULT 120.00, -- ₹120cr
    retention_cost_cr DECIMAL(5,2) DEFAULT 0,
    purse_remaining_cr DECIMAL(5,2),
    rtm_cards_total INTEGER DEFAULT 0,
    rtm_cards_used INTEGER DEFAULT 0,
    player_count INTEGER DEFAULT 0,
    overseas_count INTEGER DEFAULT 0,
    joined_at TIMESTAMP,

    FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
    UNIQUE (auction_id, team_name)
);

CREATE INDEX idx_teams_auction ON auction_teams(auction_id);
```

#### **team_players**
```sql
CREATE TABLE team_players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL,
    player_id UUID NOT NULL,
    purchase_price_cr DECIMAL(5,2) NOT NULL, -- final price in crores
    is_retained BOOLEAN DEFAULT false,
    retention_price_cr DECIMAL(5,2), -- for retained players
    acquired_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (team_id) REFERENCES auction_teams(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id),
    UNIQUE (team_id, player_id)
);

CREATE INDEX idx_team_players_team ON team_players(team_id);
CREATE INDEX idx_team_players_player ON team_players(player_id);
```

#### **auction_events**
```sql
CREATE TABLE auction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    player_id UUID NOT NULL,
    event_type VARCHAR(20) NOT NULL, -- 'BID', 'SOLD', 'UNSOLD', 'RTM_USED', 'PASSED'
    team_id UUID,
    bid_amount_cr DECIMAL(5,2),
    metadata JSONB, -- { rtm: true, round: 'AR1', set: 'M1' }
    timestamp TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (team_id) REFERENCES auction_teams(id)
);

CREATE INDEX idx_events_auction ON auction_events(auction_id);
CREATE INDEX idx_events_timestamp ON auction_events(timestamp);
```

### 7.2 Redis Data Structures

**Auction State Cache:**
```
Key: auction:{auction_id}:state
Type: Hash
TTL: 24h after completion

Fields:
  current_player_id
  current_bid_lakh
  current_bidding_team_id
  last_bid_timestamp
  timer_remaining_seconds
```

**Active Users:**
```
Key: auction:{auction_id}:users
Type: Set
Members: [session_id_1, session_id_2, ...]
```

**Player Queue:**
```
Key: auction:{auction_id}:queue:{set}
Type: List
Values: [player_id_1, player_id_2, ...]
```

---

## 8. API & WebSocket Specifications

### 8.1 REST API Endpoints

#### POST `/api/auctions`
Create auction
```json
Request:
{
  "type": "private"
}

Response: 201
{
  "auctionId": "uuid",
  "roomCode": "ABC123",
  "adminToken": "session_xyz",
  "teams": [ ... ]
}
```

#### GET `/api/auctions/:roomCode`
Get auction by room code

#### POST `/api/auctions/:auctionId/join`
Join auction & select team

#### GET `/api/players?set=M1&role=BATTER`
Get players with filters

#### GET `/api/auctions/:auctionId/teams/:teamId`
Get team details

#### GET `/api/auctions/:auctionId/teams/:teamId/recommendations`
Player recommendations

#### GET `/api/auctions/:auctionId/history`
Auction event history (CSV export)

---

### 8.2 WebSocket Events

**Client → Server:**

```javascript
// Place bid
{
  event: 'place_bid',
  data: {
    auctionId, playerId, teamId,
    bidAmountLakh: 1500
  }
}

// Use RTM
{
  event: 'use_rtm',
  data: { auctionId, playerId, teamId }
}

// Admin: Skip player
{
  event: 'skip_player',
  data: { auctionId, playerId }
}

// Admin: Transition round
{
  event: 'transition_round',
  data: {
    auctionId,
    nextRound: 'accelerated_1',
    selectedPlayers: [...]
  }
}
```

**Server → Client:**

```javascript
// Bid placed
{
  event: 'bid_placed',
  data: {
    playerId, playerName,
    teamId, teamName,
    bidAmountLakh, timestamp
  }
}

// Player sold
{
  event: 'player_sold',
  data: {
    playerId, teamId,
    finalPriceCr, isRtm
  }
}

// New player
{
  event: 'new_player',
  data: {
    id, name, role, country,
    basePriceLakh, set,
    rtmEligibleTeam: 'CSK'
  }
}

// RTM used
{
  event: 'rtm_used',
  data: {
    teamId, teamName,
    matchedAmountCr
  }
}

// Error
{
  event: 'error',
  data: {
    code: 'INSUFFICIENT_PURSE',
    message: '...',
    details: { ... }
  }
}
```

---

## 9. UI/UX Requirements

### 9.1 Key Screens

**Home Page:**
- Create Auction button
- Join Private Auction (room code input)
- Browse Public Auctions (grid/list)

**Team Selection Lobby:**
- 10 IPL team cards with:
  - Team logo
  - Retained players (3-6 players)
  - Purse remaining
  - RTM cards
  - "Select Team" button
- Start Auction (admin, ≥1 team joined)

**Live Auction View:**
```
┌─────────────────────────────────────────┐
│ Header: Auction | Round: Normal | M1    │
├───────────┬─────────────────────────────┤
│ Sidebar   │  Current Player Card        │
│ - My Team │  ┌─────────────────────┐    │
│   CSK     │  │ Virat Kohli         │    │
│   ₹54cr   │  │ BATTER | IND | 36   │    │
│   15 pl   │  │ Base: ₹210L         │    │
│           │  │ Current: ₹1700L     │    │
│ - Roster  │  └─────────────────────┘    │
│   MS Dhoni│  Bidding: RCB               │
│   Jadeja  │  Timer: [=====>  ] 15s      │
│   ...     │                             │
│           │  [Bid ₹1720L] [Use RTM]     │
│           │                             │
│           │  Recent: ₹1700L-RCB,        │
│           │         ₹1600L-MI ...       │
└───────────┴─────────────────────────────┘
```

**Admin Panel (Modal):**
- Pause/Resume/End Auction
- Skip Player
- Transition Round (Normal → AR1 → AR2)
- Player Selection (multi-select for accelerated rounds)

**Team Dashboard:**
- Tabs: Squad | Budget | Recommendations
- Squad: Table with players, roles, prices
- Budget: Pie chart (spend by role), remaining purse
- Recommendations: Top 5-10 suggested players

**Analytics Page:**
- Auction History (filterable table, CSV export)
- Team Comparison (select teams, view charts)

### 9.2 Design Guidelines
- **Color Scheme:** IPL purple (#6C3483), team-specific colors
- **Typography:** Modern sans-serif (Inter, Poppins)
- **Responsive:** Desktop-first (1200px+), tablet (768-1199px), mobile (< 768px)
- **Accessibility:** WCAG 2.1 AA (color contrast, keyboard navigation)

---

## 10. Deployment & Infrastructure

### 10.1 Docker Compose (MVP)

**Services:**
1. Frontend (React) - Nginx serving build
2. Backend (Node.js) - Express + Socket.io
3. PostgreSQL 15
4. Redis 7
5. Nginx reverse proxy

**docker-compose.yml:**
```yaml
version: '3.8'
services:
  frontend:
    build: ./frontend
    ports: ["3000:3000"]

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/ipl_auction
      REDIS_URL: redis://redis:6379
    depends_on: [postgres, redis]

  postgres:
    image: postgres:15-alpine
    volumes: [postgres_data:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    volumes: [redis_data:/data]

  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    volumes: [./nginx.conf:/etc/nginx/nginx.conf]

volumes:
  postgres_data:
  redis_data:
```

### 10.2 Environment Variables

```bash
# Backend .env
DATABASE_URL=postgresql://user:pass@postgres:5432/ipl_auction
REDIS_URL=redis://redis:6379
NODE_ENV=production
PORT=4000
SESSION_SECRET=<random>
CORS_ORIGIN=http://frontend:3000
```

### 10.3 Deployment Steps

1. Load player data from `auction.csv` into PostgreSQL
2. Build Docker images
3. Run `docker-compose up -d`
4. Access at `http://localhost:80`

### 10.4 Future: Kubernetes Migration

- Deployments for frontend, backend
- StatefulSet for PostgreSQL
- Redis cluster
- Ingress for routing
- HPA (Horizontal Pod Autoscaler) for backend

---

## 11. Future Scope

### Phase 2 (3-6 months)
- **User Authentication:** Email/password, social login
- **Mini Auction Mode:** Player releases, adjusted budgets
- **Persistent Profiles:** User auction history, leaderboards
- **Advanced Analytics:** Player value analysis, auction ratings
- **Auto-bidding:** Set max bid limits for players

### Phase 3 (6-12 months)
- **Mobile Apps:** Native iOS/Android
- **Live Streaming:** Watch IPL matches while auctioning
- **Fantasy Integration:** Export to Dream11, MyTeam11
- **Social Features:** In-auction chat, share results
- **Custom Auctions:** Create custom player pools, rules

### Technical Enhancements
- Kubernetes deployment with Helm charts
- CDN for static assets (CloudFront/Cloudflare)
- Monitoring: Prometheus + Grafana
- Multi-region deployment for low latency

---

## Appendix

### A. IPL Team Abbreviations
- RCB: Royal Challengers Bangalore
- RR: Rajasthan Royals
- CSK: Chennai Super Kings
- KKR: Kolkata Knight Riders
- PBKS: Punjab Kings
- DC: Delhi Capitals
- LSG: Lucknow Super Giants
- SRH: Sunrisers Hyderabad
- GT: Gujarat Titans
- MI: Mumbai Indians

### B. Player Role Mapping
- BATTER → Batsman
- BOWLER → Bowler (Fast/Spin based on specialism)
- ALL-ROUNDER → All-rounder
- WICKETKEEPER → Wicket-keeper

### C. Data Import
CSV columns map to database as:
- `Name` → `players.name`
- `Country` → `players.country`
- `Specialism` → `players.role` (parsed to BATTER/BOWLER/etc.)
- `Reserve Price Rs Lakh` → `players.base_price_lakh`
- `2025 Set` → `players.auction_set`
- `C/U/A` → `players.is_capped` (Capped/Uncapped/Associate)
- `2024 Team` → `players.ipl_team_2024`

### D. Success Metrics (90 days)
- 50+ auctions conducted
- 100+ concurrent users supported
- <500ms bid latency
- 99%+ uptime
- 80%+ team completion rate

---

**Document Control**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-16 | Product Team | Initial draft with real IPL 2024 data |

**Approvals:**
- [ ] Product Manager
- [ ] Engineering Lead
- [ ] UX Designer
- [ ] Stakeholder

**Next Steps:**
1. Review & approve PRD
2. Technical design document
3. UI/UX mockups
4. Sprint planning
5. Development kickoff

---

**End of Document**
