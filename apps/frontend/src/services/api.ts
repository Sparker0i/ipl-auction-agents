import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Auction endpoints
export const auctionApi = {
  // Create new auction
  createAuction: async (data: { name: string; type: 'public' | 'private' }) => {
    const response = await api.post('/auctions', data);
    return response.data;
  },

  // Get auction by ID
  getAuction: async (auctionId: string) => {
    const response = await api.get(`/auctions/${auctionId}`);
    return response.data;
  },

  // Get auction by room code
  getAuctionByRoomCode: async (roomCode: string) => {
    const response = await api.get(`/auctions/room/${roomCode}`);
    return response.data;
  },

  // Join auction
  joinAuction: async (auctionId: string, data: { teamId: string; sessionId: string }) => {
    const response = await api.post(`/auctions/${auctionId}/join`, data);
    return response.data;
  },

  // Start auction (admin only)
  startAuction: async (auctionId: string, adminSessionId: string) => {
    const response = await api.post(`/auctions/${auctionId}/start`, { adminSessionId });
    return response.data;
  },

  // Skip player (admin only)
  skipPlayer: async (auctionId: string, adminSessionId: string, playerId: string) => {
    const response = await api.post(`/auctions/${auctionId}/skip-player`, {
      adminSessionId,
      playerId,
    });
    return response.data;
  },

  // Transition to Accelerated Round 1 (admin only)
  transitionToAR1: async (auctionId: string, adminSessionId: string) => {
    const response = await api.post(`/auctions/${auctionId}/transition-ar1`, {
      adminSessionId,
    });
    return response.data;
  },

  // Transition to Accelerated Round 2 (admin only)
  transitionToAR2: async (auctionId: string, adminSessionId: string) => {
    const response = await api.post(`/auctions/${auctionId}/transition-ar2`, {
      adminSessionId,
    });
    return response.data;
  },

  // Load specific player (admin only, for accelerated rounds)
  loadSpecificPlayer: async (
    auctionId: string,
    adminSessionId: string,
    playerId: string
  ) => {
    const response = await api.post(`/auctions/${auctionId}/load-player`, {
      adminSessionId,
      playerId,
    });
    return response.data;
  },

  // Get available AR1 players
  getAvailableAR1Players: async (auctionId: string) => {
    const response = await api.get(`/auctions/${auctionId}/available-ar1-players`);
    return response.data;
  },

  // Queue multiple AR1 players (admin only)
  queueAR1Players: async (auctionId: string, adminSessionId: string, playerIds: string[]) => {
    const response = await api.post(`/auctions/${auctionId}/queue-ar1-players`, {
      adminSessionId,
      playerIds,
    });
    return response.data;
  },

  // Get available AR2 players
  getAvailableAR2Players: async (auctionId: string) => {
    const response = await api.get(`/auctions/${auctionId}/available-ar2-players`);
    return response.data;
  },

  // End auction (admin only)
  endAuction: async (auctionId: string, adminSessionId: string) => {
    const response = await api.post(`/auctions/${auctionId}/end`, { adminSessionId });
    return response.data;
  },

  // Get pool data (sold, pending, unsold players)
  getPoolData: async (auctionId: string) => {
    const response = await api.get(`/auctions/${auctionId}/pool`);
    return response.data;
  },

  // Get squads data (all teams with their players)
  getSquadsData: async (auctionId: string) => {
    const response = await api.get(`/auctions/${auctionId}/squads`);
    return response.data;
  },
};

// Session management
export const sessionApi = {
  // Generate or retrieve session ID
  getSessionId: (): string => {
    let sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('sessionId', sessionId);
    }
    return sessionId;
  },

  // Store admin token
  setAdminToken: (auctionId: string, token: string) => {
    localStorage.setItem(`admin_${auctionId}`, token);
  },

  // Get admin token
  getAdminToken: (auctionId: string): string | null => {
    return localStorage.getItem(`admin_${auctionId}`);
  },

  // Check if user is admin
  isAdmin: (auctionId: string): boolean => {
    return !!localStorage.getItem(`admin_${auctionId}`);
  },

  // Store team ID for auction
  setTeamId: (auctionId: string, teamId: string) => {
    localStorage.setItem(`team_${auctionId}`, teamId);
  },

  // Get team ID for auction
  getTeamId: (auctionId: string): string | null => {
    return localStorage.getItem(`team_${auctionId}`);
  },
};

export default api;
