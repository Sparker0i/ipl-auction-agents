import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Player {
  id: string;
  name: string;
  role: string;
  country: string;
  soldPriceLakh: number;
  isRetained?: boolean;
  isOverseas: boolean;
}

interface Team {
  id: string;
  teamName: string;
  purseRemainingCr: number;
  rtmCardsTotal: number;
  rtmCardsUsed: number;
  rtmCappedUsed: number;
  rtmUncappedUsed: number;
  playerCount: number;
  overseasCount: number;
  ownerSessionId: string | null;
  players?: Player[];
}

interface TeamsState {
  teams: Team[];
  myTeamId: string | null;
}

const initialState: TeamsState = {
  teams: [],
  myTeamId: null,
};

const teamsSlice = createSlice({
  name: 'teams',
  initialState,
  reducers: {
    setTeams: (state, action: PayloadAction<Team[]>) => {
      state.teams = action.payload;
    },
    updateTeam: (state, action: PayloadAction<Team>) => {
      const index = state.teams.findIndex((t) => t.id === action.payload.id);
      if (index !== -1) {
        state.teams[index] = action.payload;
      }
    },
    updateTeamPurse: (state, action: PayloadAction<{ teamId: string; purseRemainingCr: number }>) => {
      const team = state.teams.find((t) => t.id === action.payload.teamId);
      if (team) {
        team.purseRemainingCr = action.payload.purseRemainingCr;
      }
    },
    updateTeamCounts: (
      state,
      action: PayloadAction<{ teamId: string; playerCount: number; overseasCount: number }>
    ) => {
      const team = state.teams.find((t) => t.id === action.payload.teamId);
      if (team) {
        team.playerCount = action.payload.playerCount;
        team.overseasCount = action.payload.overseasCount;
      }
    },
    updateTeamRTM: (state, action: PayloadAction<{
      teamId: string;
      rtmCardsUsed: number;
      rtmCappedUsed?: number;
      rtmUncappedUsed?: number;
    }>) => {
      const team = state.teams.find((t) => t.id === action.payload.teamId);
      if (team) {
        team.rtmCardsUsed = action.payload.rtmCardsUsed;
        if (action.payload.rtmCappedUsed !== undefined) {
          team.rtmCappedUsed = action.payload.rtmCappedUsed;
        }
        if (action.payload.rtmUncappedUsed !== undefined) {
          team.rtmUncappedUsed = action.payload.rtmUncappedUsed;
        }
      }
    },
    addPlayerToTeam: (state, action: PayloadAction<{ teamId: string; player: Player }>) => {
      const team = state.teams.find((t) => t.id === action.payload.teamId);
      if (team) {
        if (!team.players) team.players = [];
        team.players.push(action.payload.player);
      }
    },
    setMyTeamId: (state, action: PayloadAction<string>) => {
      state.myTeamId = action.payload;
    },
  },
});

export const {
  setTeams,
  updateTeam,
  updateTeamPurse,
  updateTeamCounts,
  updateTeamRTM,
  addPlayerToTeam,
  setMyTeamId,
} = teamsSlice.actions;

export default teamsSlice.reducer;
