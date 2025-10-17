import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface BidHistoryItem {
  id: string;
  timestamp: string;
  teamName: string;
  bidAmountLakh: number;
  playerName: string;
}

interface RTMState {
  playerId: string;
  playerName: string;
  isCapped: boolean;
  rtmTeamId: string;
  rtmTeamName: string;
  originalWinnerTeamId: string;
  originalWinnerTeamName: string;
  matchedBidLakh: number;
  counterBidAllowed: boolean;
  expiresAt: number;
}

interface AuctionState {
  id: string | null;
  name: string;
  status: 'waiting' | 'in_progress' | 'completed';
  currentRound: 'normal' | 'accelerated_1' | 'accelerated_2' | null;
  currentSet: string | null;
  timerSeconds: number;
  roomCode: string | null;
  bidHistory: BidHistoryItem[];
  rtmState: RTMState | null;
}

const initialState: AuctionState = {
  id: null,
  name: '',
  status: 'waiting',
  currentRound: null,
  currentSet: null,
  timerSeconds: 0,
  roomCode: null,
  bidHistory: [],
  rtmState: null,
};

const auctionSlice = createSlice({
  name: 'auction',
  initialState,
  reducers: {
    setAuction: (state, action: PayloadAction<Partial<AuctionState>>) => {
      return { ...state, ...action.payload };
    },
    updateTimer: (state, action: PayloadAction<number>) => {
      state.timerSeconds = action.payload;
    },
    setStatus: (state, action: PayloadAction<'waiting' | 'in_progress' | 'completed'>) => {
      state.status = action.payload;
    },
    setCurrentRound: (state, action: PayloadAction<'normal' | 'accelerated_1' | 'accelerated_2'>) => {
      state.currentRound = action.payload;
    },
    setCurrentSet: (state, action: PayloadAction<string>) => {
      state.currentSet = action.payload;
    },
    addBidToHistory: (state, action: PayloadAction<BidHistoryItem>) => {
      state.bidHistory.unshift(action.payload);
    },
    clearBidHistory: (state) => {
      state.bidHistory = [];
    },
    setRTMState: (state, action: PayloadAction<RTMState | null>) => {
      state.rtmState = action.payload;
    },
    clearRTMState: (state) => {
      state.rtmState = null;
    },
    resetAuction: () => initialState,
  },
});

export const {
  setAuction,
  updateTimer,
  setStatus,
  setCurrentRound,
  setCurrentSet,
  addBidToHistory,
  clearBidHistory,
  setRTMState,
  clearRTMState,
  resetAuction,
} = auctionSlice.actions;

export default auctionSlice.reducer;
