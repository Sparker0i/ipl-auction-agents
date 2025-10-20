import type { RootState } from './index';

// Auction selectors
export const selectAuction = (state: RootState) => state.auction;
export const selectAuctionId = (state: RootState) => state.auction.id;
export const selectAuctionName = (state: RootState) => state.auction.name;
export const selectAuctionStatus = (state: RootState) => state.auction.status;
export const selectCurrentRound = (state: RootState) => state.auction.currentRound;
export const selectCurrentSet = (state: RootState) => state.auction.currentSet;
export const selectRoomCode = (state: RootState) => state.auction.roomCode;
export const selectBidHistory = (state: RootState) => state.auction.bidHistory;
export const selectRTMState = (state: RootState) => state.auction.rtmState;

// Teams selectors
export const selectAllTeams = (state: RootState) => state.teams?.teams || [];
export const selectMyTeamId = (state: RootState) => state.teams?.myTeamId || null;

export const selectMyTeam = (state: RootState) => {
  const myTeamId = state.teams?.myTeamId;
  if (!myTeamId || !state.teams?.teams) return null;
  return state.teams.teams.find((team: any) => team.id === myTeamId) || null;
};

export const selectTeamById = (teamId: string) => (state: RootState) => {
  if (!state.teams?.teams) return null;
  return state.teams.teams.find((team: any) => team.id === teamId) || null;
};

export const selectAvailableTeams = (state: RootState) => {
  if (!state.teams?.teams) return [];
  return state.teams.teams.filter((team: any) => !team.ownerSessionId);
};

export const selectTeamsSortedByPurse = (state: RootState) => {
  if (!state.teams?.teams) return [];
  return [...state.teams.teams].sort((a, b) => b.purseRemainingCr - a.purseRemainingCr);
};

// Players selectors
export const selectCurrentPlayer = (state: RootState) => state.players.currentPlayer;
export const selectCurrentBid = (state: RootState) => state.players.currentBid;
export const selectPlayerPool = (state: RootState) => state.players.playerPool;

// Derived selectors
export const selectIsMyTurn = (state: RootState) => {
  const myTeamId = state.teams.myTeamId;
  const currentBid = state.players.currentBid;

  if (!myTeamId || !currentBid) return false;
  return currentBid.biddingTeamId !== myTeamId;
};

export const selectCanPlaceBid = (state: RootState) => {
  const myTeam = selectMyTeam(state);
  const currentPlayer = state.players.currentPlayer;
  const currentBid = state.players.currentBid;

  if (!myTeam || !currentPlayer || !currentBid) return false;

  // Check if user has enough purse
  // If no bids yet, use base price for first bid
  const currentBidAmount = currentBid.currentBidLakh || currentPlayer.basePriceLakh;
  const increment = getNextBidIncrement(currentBidAmount);
  const nextBid = currentBidAmount + increment;

  return myTeam.purseRemainingCr * 100 >= nextBid;
};

export const selectMyTeamStats = (state: RootState) => {
  const myTeam = selectMyTeam(state);
  if (!myTeam) return null;

  return {
    purseRemainingCr: myTeam.purseRemainingCr,
    playerCount: myTeam.playerCount,
    overseasCount: myTeam.overseasCount,
    rtmCardsRemaining: myTeam.rtmCardsTotal - myTeam.rtmCardsUsed,
    squadSlotsRemaining: 25 - myTeam.playerCount,
    overseasSlotsRemaining: 8 - myTeam.overseasCount,
  };
};

export const selectIsRTMActive = (state: RootState) => {
  return state.auction.rtmState !== null;
};

export const selectCanUseRTM = (state: RootState) => {
  const rtmState = state.auction.rtmState;
  const myTeamId = state.teams.myTeamId;

  if (!rtmState || !myTeamId) return false;

  return rtmState.rtmTeamId === myTeamId && rtmState.counterBidAllowed;
};

export const selectCanCounterBid = (state: RootState) => {
  const rtmState = state.auction.rtmState;
  const myTeamId = state.teams.myTeamId;

  if (!rtmState || !myTeamId) return false;

  return rtmState.originalWinnerTeamId === myTeamId && rtmState.counterBidAllowed;
};

// Helper function (matching AuctionPage logic)
function getNextBidIncrement(currentBidLakh: number): number {
  if (currentBidLakh < 100) return 5;
  if (currentBidLakh < 200) return 10;
  if (currentBidLakh < 500) return 20;
  return 25;
}
