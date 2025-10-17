export type PlayerRole = 'BATTER' | 'BOWLER' | 'ALL-ROUNDER' | 'WICKETKEEPER';

export interface Player {
  id: string;
  name: string;
  country: string;
  age: number | null;
  role: PlayerRole;
  specialism: string | null;
  basePriceLakh: number;
  auctionSet: string;
  isCapped: boolean;
  isOverseas: boolean;
  iplTeam2024: string | null;
  iplMatches: number | null;
  createdAt: Date;
}

export interface PlayerFilters {
  set?: string;
  role?: PlayerRole;
  isCapped?: boolean;
  isOverseas?: boolean;
}

export interface PlayerWithBid extends Player {
  currentBidLakh: number | null;
  biddingTeamId: string | null;
  biddingTeamName: string | null;
}
