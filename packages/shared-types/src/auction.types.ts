export type AuctionStatus = 'waiting' | 'in_progress' | 'completed';
export type AuctionRound = 'normal' | 'accelerated_1' | 'accelerated_2';
export type AuctionType = 'public' | 'private';

export interface Auction {
  id: string;
  name: string;
  roomCode: string | null;
  type: AuctionType;
  status: AuctionStatus;
  currentRound: AuctionRound | null;
  currentSet: string | null;
  currentPlayerId: string | null;
  currentBidLakh: number | null;
  currentBiddingTeamId: string | null;
  timerSeconds: number;
  adminSessionId: string;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface CreateAuctionDto {
  name: string;
  type: AuctionType;
  timerSeconds?: number;
}

export interface CreateAuctionResponse {
  auctionId: string;
  roomCode: string | null;
  adminToken: string;
  teams: AuctionTeam[];
}

export interface AuctionTeam {
  id: string;
  auctionId: string;
  teamName: string;
  ownerSessionId: string | null;
  basePurseCr: number;
  retentionCostCr: number;
  purseRemainingCr: number;
  rtmCardsTotal: number;
  rtmCardsUsed: number;
  playerCount: number;
  overseasCount: number;
  joinedAt: Date | null;
}

export interface JoinAuctionDto {
  auctionId: string;
  teamId: string;
  sessionId: string;
}

export type EventType = 'BID' | 'SOLD' | 'UNSOLD' | 'RTM_USED' | 'PASSED';

export interface AuctionEvent {
  id: string;
  auctionId: string;
  playerId: string;
  eventType: EventType;
  teamId: string | null;
  bidAmountCr: number | null;
  metadata: Record<string, any> | null;
  timestamp: Date;
}
