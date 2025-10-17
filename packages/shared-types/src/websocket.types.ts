export interface PlaceBidPayload {
  auctionId: string;
  playerId: string;
  teamId: string;
  bidAmountLakh: number;
}

export interface UseRTMPayload {
  auctionId: string;
  playerId: string;
  teamId: string;
}

export interface SkipPlayerPayload {
  auctionId: string;
  playerId: string;
}

export interface TransitionRoundPayload {
  auctionId: string;
  nextRound: 'accelerated_1' | 'accelerated_2';
  selectedPlayers?: string[];
}

export interface BidPlacedEvent {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  bidAmountLakh: number;
  timestamp: string;
}

export interface PlayerSoldEvent {
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  finalPriceCr: number;
  isRtm: boolean;
}

export interface NewPlayerEvent {
  id: string;
  name: string;
  role: string;
  country: string;
  basePriceLakh: number;
  set: string;
  rtmEligibleTeams: string[];
}

export interface RTMUsedEvent {
  teamId: string;
  teamName: string;
  matchedAmountCr: number;
  counterBidWindowSec: number;
}

export interface ErrorEvent {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export type WebSocketEvent =
  | { event: 'bid_placed'; data: BidPlacedEvent }
  | { event: 'player_sold'; data: PlayerSoldEvent }
  | { event: 'new_player'; data: NewPlayerEvent }
  | { event: 'rtm_used'; data: RTMUsedEvent }
  | { event: 'error'; data: ErrorEvent };
