/**
 * Player and Statistics Type Definitions
 */

export interface Player {
  id: string;
  name: string;
  country: string;
  role: PlayerRole;
  isOverseas: boolean;
  isCapped: boolean;
}

export type PlayerRole = 'BATTER' | 'BOWLER' | 'ALL-ROUNDER' | 'WICKETKEEPER';

export interface BattingStats {
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
    boundaries: {
      fours: number;
      sixes: number;
    };
  };
  byVenue: Map<string, VenueBattingStats>;
  byPhase: {
    powerplay: PhaseStats;
    middle: PhaseStats;
    death: PhaseStats;
  };
  recentForm: {
    runs: number[];
    strikeRates: number[];
    trend: 'improving' | 'declining' | 'stable';
  };
}

export interface BowlingStats {
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
  byVenue: Map<string, VenueBowlingStats>;
  byPhase: {
    powerplay: BowlingPhaseStats;
    middle: BowlingPhaseStats;
    death: BowlingPhaseStats;
  };
  recentForm: {
    wickets: number[];
    economies: number[];
    trend: 'improving' | 'declining' | 'stable';
  };
}

export interface FieldingStats {
  catches: number;
  runOuts: number;
  stumpings: number;
}

export interface VenueBattingStats {
  venueName: string;
  matches: number;
  runs: number;
  balls: number;
  average: number;
  strikeRate: number;
  fifties: number;
  hundreds: number;
}

export interface VenueBowlingStats {
  venueName: string;
  matches: number;
  overs: number;
  wickets: number;
  economy: number;
  average: number;
}

export interface PhaseStats {
  runs: number;
  balls: number;
  strikeRate: number;
}

export interface BowlingPhaseStats {
  overs: number;
  wickets: number;
  economy: number;
}

export interface PlayerStats {
  playerId: string;
  batting: BattingStats | null;
  bowling: BowlingStats | null;
  fielding: FieldingStats;
  lastUpdated: Date;
}

export interface MatchData {
  matchId: string;
  date: string;
  venue: string;
  matchType: string;
  teams: string[];
  players: {
    [shortName: string]: string; // shortName -> playerId mapping
  };
  innings: InningsData[];
}

export interface InningsData {
  team: string;
  deliveries: DeliveryData[];
}

export interface DeliveryData {
  over: number;
  ball: number;
  batter: string;
  bowler: string;
  nonStriker: string;
  runs: {
    batter: number;
    extras: number;
    total: number;
  };
  wickets?: WicketData[];
  extras?: {
    wides?: number;
    noballs?: number;
    byes?: number;
    legbyes?: number;
  };
}

export interface WicketData {
  kind: string;
  playerOut: string;
  fielders?: string[];
}

export interface PlayerPerformance {
  playerId: string;
  matchId: string;
  batting?: {
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    dismissal: string | null;
    phase: {
      powerplay: { runs: number; balls: number };
      middle: { runs: number; balls: number };
      death: { runs: number; balls: number };
    };
  };
  bowling?: {
    overs: number;
    runs: number;
    wickets: number;
    maidens: number;
    wides: number;
    noballs: number;
    phase: {
      powerplay: { overs: number; runs: number; wickets: number };
      middle: { overs: number; runs: number; wickets: number };
      death: { overs: number; runs: number; wickets: number };
    };
  };
  fielding?: {
    catches: number;
    runOuts: number;
    stumpings: number;
  };
}

export interface AuctionPlayer {
  id: string;
  name: string;
  country: string;
  role: PlayerRole;
  basePriceLakh: number;
  auctionSet: string;
  isCapped: boolean;
  isOverseas: boolean;
  iplTeam2024?: string;
}
