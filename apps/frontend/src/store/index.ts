import { configureStore } from '@reduxjs/toolkit';
import auctionReducer from './slices/auctionSlice';
import teamsReducer from './slices/teamsSlice';
import playersReducer from './slices/playersSlice';
import userReducer from './slices/userSlice';

export const store = configureStore({
  reducer: {
    auction: auctionReducer,
    teams: teamsReducer,
    players: playersReducer,
    user: userReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
