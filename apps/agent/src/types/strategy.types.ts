import { TeamCode, PlayerRole } from './agent.types.js';

/**
 * Bidding aggression level
 */
export type Aggression = 'conservative' | 'balanced' | 'aggressive';

/**
 * Squad building priorities
 */
export interface TeamPriorities {
  experience: number; // Weight for capped players (0-1)
  youth: number; // Weight for uncapped players (0-1)
  starPower: number; // Weight for marquee players (0-1)
  value: number; // Weight for budget players (0-1)
}

/**
 * Target role distribution (percentages)
 */
export interface RoleDistribution {
  batters: number; // 35-45%
  bowlers: number; // 30-40%
  allRounders: number; // 15-25%
  wicketkeepers: number; // 10-15%
}

/**
 * Team-specific special rules
 */
export interface SpecialRules {
  maxBidPerPlayer: number; // Max ₹cr willing to spend on one player
  retainedPlayers?: string[]; // Players this team retained
  rivalryBonus?: Record<string, number>; // Extra willingness for rival teams' players
  preferredNationalities?: string[]; // Preferred player countries
}

/**
 * Complete team strategy profile
 */
export interface TeamStrategy {
  teamCode: TeamCode;
  teamName: string;
  homeVenue: string;

  // Bidding behavior
  aggression: Aggression;
  riskTolerance: number; // 0.0 to 1.0

  // Squad building preferences
  priorities: TeamPriorities;
  roleDistribution: RoleDistribution;

  // Special constraints
  specialRules: SpecialRules;

  // Strategic philosophy (for LLM context)
  philosophy: string;
}

/**
 * Budget allocation phase
 */
export type BudgetPhase = 'early' | 'mid' | 'late';

/**
 * Budget allocation strategy
 */
export interface BudgetAllocation {
  phase: BudgetPhase;
  maxBidPercent: number; // % of spendable budget for single player
  reservePerSlot: number; // Reserve budget per remaining slot (lakhs)
}

/**
 * Squad composition analysis
 */
export interface SquadAnalysis {
  currentSize: number;
  overseasCount: number;
  roleDistribution: Record<PlayerRole, number>;
  roleGaps: Record<PlayerRole, number>; // Negative = surplus, Positive = deficit
  budgetRemaining: number;
  budgetPerSlot: number; // Average budget per remaining slot
  phase: BudgetPhase;
}

/**
 * Player quality assessment
 */
export interface PlayerQuality {
  overall: number; // 0-10 rating
  roleSpecific: number; // 0-10 rating for their role
  venueBonus: number; // 0-1 multiplier for home venue
  formTrend: 'improving' | 'declining' | 'stable';
  experience: 'high' | 'medium' | 'low';
}

/**
 * Bid decision context
 */
export interface BidContext {
  player: {
    name: string;
    role: PlayerRole;
    country: string;
    basePrice: number;
    currentBid: number;
    isCapped: boolean;
    isOverseas: boolean;
  };
  squad: SquadAnalysis;
  strategy: TeamStrategy;
  quality?: PlayerQuality;
}
