import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Player {
  id: string;
  name: string;
  role: string;
  country: string;
  age: number | null;
  basePriceLakh: number;
  auctionSet: string;
  isCapped: boolean;
  isOverseas: boolean;
}

interface CurrentBid {
  playerId: string;
  currentBidLakh: number | null;
  biddingTeamId: string | null;
}

interface PlayersState {
  currentPlayer: Player | null;
  currentBid: CurrentBid | null;
  playerPool: Player[];
}

const initialState: PlayersState = {
  currentPlayer: null,
  currentBid: null,
  playerPool: [],
};

const playersSlice = createSlice({
  name: 'players',
  initialState,
  reducers: {
    setCurrentPlayer: (state, action: PayloadAction<Player | null>) => {
      state.currentPlayer = action.payload;
    },
    setCurrentBid: (state, action: PayloadAction<CurrentBid | null>) => {
      state.currentBid = action.payload;
    },
    setPlayerPool: (state, action: PayloadAction<Player[]>) => {
      state.playerPool = action.payload;
    },
  },
});

export const { setCurrentPlayer, setCurrentBid, setPlayerPool } = playersSlice.actions;
export default playersSlice.reducer;
