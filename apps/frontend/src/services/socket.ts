import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001';

class SocketService {
  private socket: Socket | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(SOCKET_URL, {
        transports: ['websocket'],
        autoConnect: true,
      });

      this.socket.on('connect', () => {
        console.log('🔌 Socket connected:', this.socket?.id);
      });

      this.socket.on('disconnect', () => {
        console.log('🔌 Socket disconnected');
      });

      this.socket.on('error', (error: any) => {
        console.error('❌ Socket error:', error);
      });
    }

    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  // Join auction lobby (before selecting team)
  joinLobby(auctionId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('join_lobby', { auctionId });
  }

  // Join auction room (after selecting team)
  joinAuction(auctionId: string, teamId: string, sessionId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('join_auction', { auctionId, teamId, sessionId });
  }

  // Place bid
  placeBid(auctionId: string, playerId: string, teamId: string, bidAmountLakh: number): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('place_bid', {
      auctionId,
      playerId,
      teamId,
      bidAmountLakh,
    });
  }

  // Admin: Sell player
  sellPlayer(auctionId: string, adminSessionId: string, playerId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('sell_player', {
      auctionId,
      adminSessionId,
      playerId,
    });
  }

  // Admin: Mark unsold
  markUnsold(auctionId: string, adminSessionId: string, playerId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('mark_unsold', {
      auctionId,
      adminSessionId,
      playerId,
    });
  }

  // Admin: Load next player
  loadNextPlayer(auctionId: string, adminSessionId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('next_player', {
      auctionId,
      adminSessionId,
    });
  }

  // RTM: Use RTM card
  useRTM(auctionId: string, playerId: string, teamId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('use_rtm', {
      auctionId,
      playerId,
      teamId,
    });
  }

  // RTM: Counter-bid
  rtmCounterBid(auctionId: string, teamId: string, newBidLakh: number): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('rtm_counter_bid', {
      auctionId,
      teamId,
      newBidLakh,
    });
  }

  // Pass on current player
  passPlayer(auctionId: string, playerId: string, teamId: string, sessionId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('pass_player', {
      auctionId,
      playerId,
      teamId,
      sessionId,
    });
  }

  // Come back to bidding after passing
  comeBack(auctionId: string, playerId: string, teamId: string, sessionId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('come_back', {
      auctionId,
      playerId,
      teamId,
      sessionId,
    });
  }

  // Admin: Finalize RTM
  finalizeRTM(auctionId: string, teamId: string, rtmAccepts: boolean): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('finalize_rtm', {
      auctionId,
      teamId,
      rtmAccepts,
    });
  }

  // Admin: End auction
  endAuction(auctionId: string, adminSessionId: string): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }

    this.socket.emit('end_auction', {
      auctionId,
      adminSessionId,
    });
  }

  // Event listeners
  on(event: string, callback: (...args: any[]) => void): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.on(event, callback);
  }

  off(event: string, callback?: (...args: any[]) => void): void {
    if (!this.socket) {
      return;
    }
    this.socket.off(event, callback);
  }
}

// Singleton instance
const socketService = new SocketService();

export default socketService;
