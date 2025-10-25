import { Browser, Page } from 'playwright';

/**
 * Team codes for IPL franchises
 */
export type TeamCode =
  | 'CSK'  // Chennai Super Kings
  | 'MI'   // Mumbai Indians
  | 'RCB'  // Royal Challengers Bangalore
  | 'DC'   // Delhi Capitals
  | 'PBKS' // Punjab Kings
  | 'RR'   // Rajasthan Royals
  | 'KKR'  // Kolkata Knight Riders
  | 'LSG'  // Lucknow Super Giants
  | 'SRH'  // Sunrisers Hyderabad
  | 'GT';  // Gujarat Titans

/**
 * Agent status during auction
 */
export type AgentStatus =
  | 'initializing'
  | 'waiting'      // Waiting for auction to start
  | 'active'       // Auction in progress
  | 'thinking'     // Evaluating decision
  | 'bidding'      // Placing bid
  | 'error'        // Error state
  | 'completed';   // Auction finished

/**
 * Browser configuration
 */
export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  slowMo: number;
  timeout: number;
  executablePath?: string;
}

/**
 * Auction state from the frontend
 */
export interface AuctionState {
  currentPlayer: PlayerInAuction | null;
  currentBid: number | null;
  currentBidder: string | null;
  timeRemaining: number;
  status: 'waiting' | 'active' | 'completed';
}

/**
 * Player being auctioned
 */
export interface PlayerInAuction {
  id: string;
  name: string;
  role: PlayerRole;
  country: string;
  basePrice: number; // in lakhs
  isCapped: boolean;
  isOverseas: boolean;
}

/**
 * Player role classification
 */
export type PlayerRole =
  | 'BATTER'
  | 'BOWLER'
  | 'ALL-ROUNDER'
  | 'WICKETKEEPER';

/**
 * Agent's internal state
 */
export interface AgentInternalState {
  teamCode: TeamCode;
  teamId: string;
  status: AgentStatus;
  budget: number; // in lakhs
  squad: Player[];
  decisions: DecisionLog[];
  auctionCode: string;
}

/**
 * Player in squad
 */
export interface Player {
  id: string;
  name: string;
  role: PlayerRole;
  country: string;
  price: number; // in lakhs
  isCapped: boolean;
  isOverseas: boolean;
}

/**
 * Decision log entry
 */
export interface DecisionLog {
  timestamp: Date;
  player: string;
  decision: 'bid' | 'pass';
  maxBid?: number;
  reasoning: string;
  actualBid?: number;
  won: boolean;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  teamCode: TeamCode;
  auctionCode: string;
  browser: BrowserConfig;
  frontendUrl: string;
  bidDelayMs: number;
  stateCheckIntervalMs: number;
  initialBudgetLakh?: number; // Team's actual budget in lakhs (fetched from database)
  isRejoin?: boolean; // Flag to indicate if agent is rejoining (skips lobby/team selection)
}

/**
 * Main agent class interface
 */
export interface IAuctionAgent {
  // Lifecycle methods
  initialize(): Promise<void>;
  cleanup(): Promise<void>;

  // Core functionality
  selectTeam(teamName: string): Promise<void>;
  rejoinAuction(): Promise<void>; // Rejoin auction bypassing team selection
  waitForAuctionStart(): Promise<void>;
  monitorAuction(): Promise<void>;

  // State management
  getState(): AgentInternalState;
  updateBudget(newBudget: number): void;
  addToSquad(player: Player): void;

  // Decision making (placeholder for Phase 3)
  makeDecision(player: PlayerInAuction): Promise<{ shouldBid: boolean; maxBid?: number }>;
  placeBid(amount: number): Promise<void>;
}

/**
 * Browser controller interface
 */
export interface IBrowserController {
  launch(): Promise<void>;
  navigate(url: string): Promise<void>;
  close(): Promise<void>;
  getPage(): Page;
  getBrowser(): Browser;
  isConnected(): boolean;
}

/**
 * State manager interface
 */
export interface IStateManager {
  syncState(page: Page): Promise<void>;
  getCurrentPlayer(): PlayerInAuction | null;
  getCurrentBid(): number | null;
  getBudget(): number;
  getSquadSize(): number;
  getSquad(): Player[];
  addPlayer(player: Player): void;
}

/**
 * Error recovery interface
 */
export interface IErrorRecovery {
  handleBrowserCrash(): Promise<void>;
  handleSocketDisconnect(): Promise<void>;
  handleNavigationError(error: Error): Promise<void>;
  shouldRetry(error: Error): boolean;
  getRetryCount(): number;
  resetRetryCount(): void;
}
