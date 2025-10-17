import { Player } from './player.types';

export type IPLTeam =
  | 'RCB'
  | 'CSK'
  | 'MI'
  | 'KKR'
  | 'DC'
  | 'RR'
  | 'PBKS'
  | 'SRH'
  | 'GT'
  | 'LSG';

export interface TeamPlayer {
  id: string;
  teamId: string;
  playerId: string;
  purchasePriceCr: number;
  isRetained: boolean;
  retentionPriceCr: number | null;
  acquiredAt: Date;
  player?: Player;
}

export interface TeamWithPlayers {
  id: string;
  teamName: IPLTeam;
  purseRemainingCr: number;
  rtmCardsTotal: number;
  rtmCardsUsed: number;
  playerCount: number;
  overseasCount: number;
  players: TeamPlayer[];
}

export interface TeamConstraints {
  minPlayers: number;
  maxPlayers: number;
  maxOverseas: number;
  basePurseCr: number;
}

export const TEAM_CONSTRAINTS: TeamConstraints = {
  minPlayers: 18,
  maxPlayers: 25,
  maxOverseas: 8,
  basePurseCr: 120,
};
