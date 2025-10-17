import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UserState {
  sessionId: string | null;
  myTeamId: string | null;
  myTeamName: string | null;
  isAdmin: boolean;
}

const initialState: UserState = {
  sessionId: null,
  myTeamId: null,
  myTeamName: null,
  isAdmin: false,
};

const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<Partial<UserState>>) => {
      return { ...state, ...action.payload };
    },
    clearUser: () => initialState,
  },
});

export const { setUser, clearUser } = userSlice.actions;
export default userSlice.reducer;
