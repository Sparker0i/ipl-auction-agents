import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface BidHistoryItem {
  id: string;
  timestamp: string;
  teamName: string;
  bidAmountLakh: number;
  playerName: string;
}

// Unified event types for comprehensive auction history
type AuctionEventType =
  | 'bid'
  | 'pass'
  | 'come_back'
  | 'rtm_triggered'
  | 'rtm_counter_bid'
  | 'rtm_accepted'
  | 'rtm_declined'
  | 'player_sold'
  | 'player_unsold';

interface AuctionEvent {
  id: string;
  type: AuctionEventType;
  timestamp: string;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  // Optional fields based on event type
  bidAmountLakh?: number;
  rtmDetails?: {
    isCapped: boolean;
    originalTeamId: string;
    originalTeamName: string;
    counterBidLakh?: number;
  };
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
  eventHistory: AuctionEvent[]; // New unified event history (last 30 events)
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
  eventHistory: [],
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
    // Unified event history management
    addEventToHistory: (state, action: PayloadAction<AuctionEvent>) => {
      // Check for duplicate based on type, timestamp, and key identifiers
      const isDuplicate = state.eventHistory.some(existingEvent => {
        // For bids, passes, and come_back events: check type + playerId + teamId + timestamp
        if (action.payload.type === 'bid' || action.payload.type === 'pass' || action.payload.type === 'come_back') {
          return (
            existingEvent.type === action.payload.type &&
            existingEvent.playerId === action.payload.playerId &&
            existingEvent.teamId === action.payload.teamId &&
            Math.abs(new Date(existingEvent.timestamp).getTime() - new Date(action.payload.timestamp).getTime()) < 1000
          );
        }
        // For player sold/unsold: check type + playerId + timestamp
        if (action.payload.type === 'player_sold' || action.payload.type === 'player_unsold') {
          return (
            existingEvent.type === action.payload.type &&
            existingEvent.playerId === action.payload.playerId &&
            Math.abs(new Date(existingEvent.timestamp).getTime() - new Date(action.payload.timestamp).getTime()) < 1000
          );
        }
        // For RTM events: check type + playerId + timestamp
        if (action.payload.type.startsWith('rtm_')) {
          return (
            existingEvent.type === action.payload.type &&
            existingEvent.playerId === action.payload.playerId &&
            Math.abs(new Date(existingEvent.timestamp).getTime() - new Date(action.payload.timestamp).getTime()) < 1000
          );
        }
        return false;
      });

      // Only add if not duplicate
      if (!isDuplicate) {
        state.eventHistory.unshift(action.payload);
        // Keep only last 30 events
        if (state.eventHistory.length > 30) {
          state.eventHistory = state.eventHistory.slice(0, 30);
        }
      }
    },
    clearEventHistory: (state) => {
      state.eventHistory = [];
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
  addEventToHistory,
  clearEventHistory,
  setRTMState,
  clearRTMState,
  resetAuction,
} = auctionSlice.actions;

// Export types for use in other files
export type { AuctionEvent, AuctionEventType };

export default auctionSlice.reducer;
