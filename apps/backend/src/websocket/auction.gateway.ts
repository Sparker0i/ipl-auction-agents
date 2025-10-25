import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { BiddingService } from '../bidding/bidding.service';
import { RTMService } from '../bidding/rtm.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlayerProgressionService } from '../players/player-progression.service';
import { AuctionsService } from '../auctions/auctions.service';

interface PlaceBidPayload {
  auctionId: string;
  playerId: string;
  teamId: string;
  bidAmountLakh: number;
}

interface JoinAuctionPayload {
  auctionId: string;
  teamId: string;
  sessionId: string;
}

interface AdminActionPayload {
  auctionId: string;
  adminSessionId: string;
  playerId?: string;
}

/**
 * Helper function to safely convert purseRemainingCr to number
 * Handles both Prisma Decimal objects (from DB) and plain numbers (from cache)
 */
function toNumber(value: any): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return parseFloat(value);
  }
  if (value && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return Number(value);
}

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class AuctionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private biddingService: BiddingService,
    private rtmService: RTMService,
    private redis: RedisService,
    private prisma: PrismaService,
    private playerProgressionService: PlayerProgressionService,
    @Inject(forwardRef(() => AuctionsService))
    private auctionsService: AuctionsService,
  ) {}

  handleConnection(_client: Socket) {
    // Client connected (debug logging removed to reduce spam)
  }

  async handleDisconnect(client: Socket) {
    // Client disconnected (debug logging removed to reduce spam)

    // Remove user from any auction rooms in Redis
    const rooms = Array.from(client.rooms).filter(room => room !== client.id);
    for (const room of rooms) {
      if (room.startsWith('auction:')) {
        const auctionId = room.split(':')[1];
        await this.redis.removeAuctionUser(auctionId, client.id);
      }
    }
  }

  /**
   * Client joins auction lobby (before selecting team)
   */
  @SubscribeMessage('join_lobby')
  async handleJoinLobby(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string },
  ) {
    try {
      const { auctionId } = payload;

      // Verify auction exists
      const auction = await this.prisma.auction.findUnique({
        where: { id: auctionId },
      });

      if (!auction) {
        client.emit('error', {
          code: 'AUCTION_NOT_FOUND',
          message: 'Auction not found',
        });
        return;
      }

      // Join Socket.io room (no team ownership check for lobby)
      const roomName = `auction:${auctionId}`;
      await client.join(roomName);

      client.emit('lobby_joined', {
        auctionId,
        roomName,
      });
    } catch (error) {
      console.error('Error joining lobby:', error);
      client.emit('error', {
        code: 'JOIN_LOBBY_FAILED',
        message: error.message || 'Failed to join lobby',
      });
    }
  }

  /**
   * Client joins an auction room
   */
  @SubscribeMessage('join_auction')
  async handleJoinAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinAuctionPayload,
  ) {
    try {
      const { auctionId, teamId, sessionId } = payload;

      // Try to get auction from cache first
      let auction = await this.redis.getCachedAuction(auctionId);

      if (!auction) {
        // Cache miss - fetch from database
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
          include: {
            teams: true,
            currentPlayer: true,
          },
        });

        // Cache for 30 seconds
        if (auction) {
          await this.redis.cacheAuction(auctionId, auction, 30);
        }
      }

      if (!auction) {
        client.emit('error', {
          code: 'AUCTION_NOT_FOUND',
          message: 'Auction not found',
        });
        return;
      }

      // Verify teams array exists (cache might be corrupted)
      if (!auction.teams || !Array.isArray(auction.teams)) {
        console.error('Auction teams array missing or corrupted, invalidating cache');
        await this.redis.invalidateAuctionCache(auctionId);

        // Fetch fresh from database
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
          include: {
            teams: true,
            currentPlayer: true,
          },
        });

        if (!auction || !auction.teams) {
          client.emit('error', {
            code: 'AUCTION_DATA_CORRUPTED',
            message: 'Auction data is corrupted',
          });
          return;
        }

        // Cache the fresh data
        await this.redis.cacheAuction(auctionId, auction, 30);
      }

      // Verify team belongs to this user
      const team = auction.teams.find((t: any) => t.id === teamId);
      if (!team || team.ownerSessionId !== sessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED_TEAM',
          message: 'You do not own this team',
        });
        return;
      }

      // Join Socket.io room
      const roomName = `auction:${auctionId}`;
      await client.join(roomName);

      // Track user in Redis
      await this.redis.addAuctionUser(auctionId, client.id);

      // Get RTM state if active
      const rtmState = await this.redis.getRTMState(auctionId);

      // Send current auction state to client
      client.emit('auction_joined', {
        auction: {
          id: auction.id,
          name: auction.name,
          status: auction.status,
          currentRound: auction.currentRound,
          currentSet: auction.currentSet,
        },
        myTeam: {
          id: team.id,
          teamName: team.teamName,
          purseRemainingCr: toNumber(team.purseRemainingCr),
          rtmCardsTotal: team.rtmCardsTotal,
          rtmCardsUsed: team.rtmCardsUsed,
          rtmCappedUsed: team.rtmCappedUsed,
          rtmUncappedUsed: team.rtmUncappedUsed,
          playerCount: team.playerCount,
          overseasCount: team.overseasCount,
        },
        allTeams: auction.teams.map((t: any) => ({
          id: t.id,
          teamName: t.teamName,
          purseRemainingCr: toNumber(t.purseRemainingCr),
          rtmCardsTotal: t.rtmCardsTotal,
          rtmCardsUsed: t.rtmCardsUsed,
          rtmCappedUsed: t.rtmCappedUsed,
          rtmUncappedUsed: t.rtmUncappedUsed,
          playerCount: t.playerCount,
          overseasCount: t.overseasCount,
        })),
        currentPlayer: auction.currentPlayer ? {
          id: auction.currentPlayer.id,
          name: auction.currentPlayer.name,
          role: auction.currentPlayer.role,
          country: auction.currentPlayer.country,
          basePriceLakh: auction.currentPlayer.basePriceLakh,
          isOverseas: auction.currentPlayer.isOverseas,
          isCapped: auction.currentPlayer.isCapped,
          currentBidLakh: auction.currentBidLakh,
          biddingTeamId: auction.currentBiddingTeamId,
        } : null,
        rtmState: rtmState || null,
      });

      // Broadcast to room that user joined
      this.server.to(roomName).emit('user_joined', {
        teamName: team.teamName,
      });
    } catch (error) {
      console.error('Error joining auction:', error);
      client.emit('error', {
        code: 'JOIN_FAILED',
        message: error.message || 'Failed to join auction',
      });
    }
  }

  /**
   * Rejoin auction (for agents reopening browser contexts)
   * Bypasses lobby/team-selection, directly reconnects to auction
   */
  @SubscribeMessage('rejoin_auction')
  async handleRejoinAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinAuctionPayload,
  ) {
    try {
      const { auctionId, teamId, sessionId } = payload;

      // Try to get auction from cache first
      let auction = await this.redis.getCachedAuction(auctionId);

      if (!auction) {
        // Cache miss - fetch from database
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
          include: {
            teams: true,
            currentPlayer: true,
          },
        });

        // Cache for 30 seconds
        if (auction) {
          await this.redis.cacheAuction(auctionId, auction, 30);
        }
      }

      if (!auction) {
        client.emit('error', {
          code: 'AUCTION_NOT_FOUND',
          message: 'Auction not found',
        });
        return;
      }

      // Verify teams array exists (cache might be corrupted)
      if (!auction.teams || !Array.isArray(auction.teams)) {
        console.error('Auction teams array missing or corrupted during rejoin, invalidating cache');
        await this.redis.invalidateAuctionCache(auctionId);

        // Fetch fresh from database
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
          include: {
            teams: true,
            currentPlayer: true,
          },
        });

        if (!auction || !auction.teams) {
          client.emit('error', {
            code: 'AUCTION_DATA_CORRUPTED',
            message: 'Auction data is corrupted',
          });
          return;
        }

        // Cache the fresh data
        await this.redis.cacheAuction(auctionId, auction, 30);
      }

      // Verify team belongs to this user (critical for security)
      const team = auction.teams.find((t: any) => t.id === teamId);
      if (!team || team.ownerSessionId !== sessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED_TEAM',
          message: 'You do not own this team',
        });
        return;
      }

      // Join Socket.io room
      const roomName = `auction:${auctionId}`;
      await client.join(roomName);

      // Track user in Redis
      await this.redis.addAuctionUser(auctionId, client.id);

      // Get RTM state if active
      const rtmState = await this.redis.getRTMState(auctionId);

      // Send current auction state to client (same as join_auction)
      client.emit('auction_rejoined', {
        auction: {
          id: auction.id,
          name: auction.name,
          status: auction.status,
          currentRound: auction.currentRound,
          currentSet: auction.currentSet,
        },
        myTeam: {
          id: team.id,
          teamName: team.teamName,
          purseRemainingCr: toNumber(team.purseRemainingCr),
          rtmCardsTotal: team.rtmCardsTotal,
          rtmCardsUsed: team.rtmCardsUsed,
          rtmCappedUsed: team.rtmCappedUsed,
          rtmUncappedUsed: team.rtmUncappedUsed,
          playerCount: team.playerCount,
          overseasCount: team.overseasCount,
        },
        allTeams: auction.teams.map((t: any) => ({
          id: t.id,
          teamName: t.teamName,
          purseRemainingCr: toNumber(t.purseRemainingCr),
          rtmCardsTotal: t.rtmCardsTotal,
          rtmCardsUsed: t.rtmCardsUsed,
          rtmCappedUsed: t.rtmCappedUsed,
          rtmUncappedUsed: t.rtmUncappedUsed,
          playerCount: t.playerCount,
          overseasCount: t.overseasCount,
        })),
        currentPlayer: auction.currentPlayer ? {
          id: auction.currentPlayer.id,
          name: auction.currentPlayer.name,
          role: auction.currentPlayer.role,
          country: auction.currentPlayer.country,
          basePriceLakh: auction.currentPlayer.basePriceLakh,
          isOverseas: auction.currentPlayer.isOverseas,
          isCapped: auction.currentPlayer.isCapped,
          currentBidLakh: auction.currentBidLakh,
          biddingTeamId: auction.currentBiddingTeamId,
        } : null,
        rtmState: rtmState || null,
      });

      // Log rejoin for monitoring
      console.log(`[REJOIN] Team ${team.teamName} rejoined auction ${auctionId}`);

      // Broadcast to room that user rejoined (optional, can be silent)
      this.server.to(roomName).emit('user_rejoined', {
        teamName: team.teamName,
      });
    } catch (error) {
      console.error('Error rejoining auction:', error);
      client.emit('error', {
        code: 'REJOIN_FAILED',
        message: error.message || 'Failed to rejoin auction',
      });
    }
  }

  /**
   * Place a bid
   */
  @SubscribeMessage('place_bid')
  async handlePlaceBid(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: PlaceBidPayload,
  ) {
    try {
      const { auctionId, playerId, teamId, bidAmountLakh } = payload;

      // Place bid through service
      const result = await this.biddingService.placeBid(
        auctionId,
        teamId,
        playerId,
        bidAmountLakh,
      );

      const roomName = `auction:${auctionId}`;

      // Broadcast bid to all clients in auction room
      this.server.to(roomName).emit('bid_placed', {
        playerId: result.player?.id,
        playerName: result.player?.name,
        teamId: result.biddingTeam?.id,
        teamName: result.biddingTeam?.teamName,
        bidAmountLakh: result.bidAmountLakh,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error placing bid:', error);
      client.emit('error', {
        code: 'BID_FAILED',
        message: error.message || 'Failed to place bid',
      });
    }
  }

  /**
   * Team passes on a player (opts out of bidding)
   */
  @SubscribeMessage('pass_player')
  async handlePassPlayer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string; playerId: string; teamId: string; sessionId: string },
  ) {
    try {
      const { auctionId, playerId, teamId, sessionId } = payload;

      // Verify team ownership
      const team = await this.prisma.auctionTeam.findUnique({
        where: { id: teamId },
      });

      if (!team || team.ownerSessionId !== sessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED_TEAM',
          message: 'You do not own this team',
        });
        return;
      }

      // Check if team has already passed
      const alreadyPassed = await this.redis.checkTeamPassed(auctionId, playerId, teamId);
      if (alreadyPassed) {
        client.emit('error', {
          code: 'ALREADY_PASSED',
          message: 'You have already passed on this player',
        });
        return;
      }

      // Mark team as passed
      await this.redis.markTeamPassed(auctionId, playerId, teamId);

      // Log for analytics
      console.log(`[PASS] Team ${team.teamName} passed on player ${playerId} in auction ${auctionId}`);

      // Broadcast to room
      const roomName = `auction:${auctionId}`;
      this.server.to(roomName).emit('player_passed', {
        playerId,
        teamId,
        teamName: team.teamName,
        timestamp: new Date().toISOString(),
      });

      // Send confirmation to client
      client.emit('pass_confirmed', {
        playerId,
        teamId,
      });
    } catch (error) {
      console.error('Error passing player:', error);
      client.emit('error', {
        code: 'PASS_FAILED',
        message: error.message || 'Failed to pass on player',
      });
    }
  }

  /**
   * Team comes back to bidding after passing
   */
  @SubscribeMessage('come_back')
  async handleComeBack(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string; playerId: string; teamId: string; sessionId: string },
  ) {
    try {
      const { auctionId, playerId, teamId, sessionId } = payload;

      // Verify team ownership
      const team = await this.prisma.auctionTeam.findUnique({
        where: { id: teamId },
      });

      if (!team || team.ownerSessionId !== sessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED_TEAM',
          message: 'You do not own this team',
        });
        return;
      }

      // Check if team has actually passed
      const hasPassed = await this.redis.checkTeamPassed(auctionId, playerId, teamId);
      if (!hasPassed) {
        client.emit('error', {
          code: 'NOT_PASSED',
          message: 'You have not passed on this player',
        });
        return;
      }

      // Fetch player info for the event
      const player = await this.prisma.player.findUnique({
        where: { id: playerId },
      });

      // Clear the pass status
      await this.redis.clearTeamPass(auctionId, playerId, teamId);

      // Log for analytics
      console.log(`[COME_BACK] Team ${team.teamName} came back for player ${player?.name || playerId} in auction ${auctionId}`);

      // Broadcast to room
      const roomName = `auction:${auctionId}`;
      this.server.to(roomName).emit('team_came_back', {
        playerId,
        playerName: player?.name,
        teamId,
        teamName: team.teamName,
        timestamp: new Date().toISOString(),
      });

      // Send confirmation to client
      client.emit('come_back_confirmed', {
        playerId,
        teamId,
      });
    } catch (error) {
      console.error('Error coming back:', error);
      client.emit('error', {
        code: 'COME_BACK_FAILED',
        message: error.message || 'Failed to come back',
      });
    }
  }

  /**
   * Admin: Sell player
   */
  @SubscribeMessage('sell_player')
  async handleSellPlayer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AdminActionPayload,
  ) {
    try {
      const { auctionId, adminSessionId, playerId } = payload;

      if (!playerId) {
        client.emit('error', {
          code: 'MISSING_PLAYER_ID',
          message: 'Player ID is required',
        });
        return;
      }

      // Try cache first, then database
      let auction = await this.redis.getCachedAuction(auctionId);

      if (!auction) {
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
          include: {
            currentPlayer: true,
            currentBiddingTeam: true,
          },
        });

        if (auction) {
          await this.redis.cacheAuction(auctionId, auction, 30);
        }
      }

      if (!auction || auction.adminSessionId !== adminSessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Only admin can sell players',
        });
        return;
      }

      if (!auction.currentBiddingTeamId || !auction.currentBidLakh) {
        client.emit('error', {
          code: 'NO_BIDS',
          message: 'No bids placed for this player',
        });
        return;
      }

      const roomName = `auction:${auctionId}`;

      // Check RTM eligibility BEFORE selling
      const rtmState = await this.rtmService.triggerRTM(
        auctionId,
        playerId,
        auction.currentBiddingTeamId,
        auction.currentBidLakh,
      );

      if (rtmState) {
        // RTM triggered - DO NOT sell yet, just broadcast RTM opportunity
        this.server.to(roomName).emit('rtm_triggered', {
          playerId: rtmState.playerId,
          playerName: rtmState.playerName,
          isCapped: rtmState.isCapped,
          originalWinnerTeamId: rtmState.originalWinnerTeamId,
          originalWinnerTeamName: rtmState.originalWinnerTeamName,
          rtmTeamId: rtmState.rtmTeamId,
          rtmTeamName: rtmState.rtmTeamName,
          matchedBidLakh: rtmState.matchedBidLakh,
          expiresAt: rtmState.expiresAt,
        });

        console.log(`🎯 RTM: ${rtmState.rtmTeamName} can match ₹${rtmState.matchedBidLakh}L`);
      } else {
        // No RTM - sell player normally
        const result = await this.biddingService.sellPlayer(auctionId, playerId);

        if (!result.team) {
          client.emit('error', {
            code: 'NO_WINNING_TEAM',
            message: 'No winning team found',
          });
          return;
        }

        // Invalidate caches after sale (auction and team changed)
        await this.redis.invalidateAuctionCache(auctionId);
        await this.redis.invalidateTeamCache(result.team.id);

        // Fetch updated team stats after sale
        const updatedTeam = await this.prisma.auctionTeam.findUnique({
          where: { id: result.team.id },
        });

        // Player sold normally (no RTM)
        this.server.to(roomName).emit('player_sold', {
          playerId: result.player.id,
          playerName: result.player.name,
          teamId: result.team.id,
          teamName: result.team.teamName,
          finalPriceCr: result.finalPriceCr,
          isRtm: false,
          winningTeam: updatedTeam ? {
            id: updatedTeam.id,
            teamName: updatedTeam.teamName,
            purseRemainingCr: toNumber(updatedTeam.purseRemainingCr),
            playerCount: updatedTeam.playerCount,
            overseasCount: updatedTeam.overseasCount,
          } : undefined,
        });

        console.log(`✅ SOLD: ${result.player?.name} → ${result.team.teamName} for ₹${result.finalPriceCr}Cr`);

        // Auto-advance to next player (async to not block UI response)
        setImmediate(async () => {
          try {
            const nextResult = await this.playerProgressionService.loadNextPlayer(auctionId);

            // Check if round completed
            if (nextResult.completed) {
              this.server.to(roomName).emit('round_completed', {
                message: nextResult.message,
              });
              console.log(`🎊 ${nextResult.message}`);
              return;
            }

            // Get fresh auction state
            const updatedAuction = await this.prisma.auction.findUnique({
              where: { id: auctionId },
              include: { currentPlayer: true },
            });

            // Get RTM state if active, to ensure it's sent with the new player
            const rtmState = await this.redis.getRTMState(auctionId);

            // Check RTM eligibility for this player
            const rtmEligibility = await this.rtmService.checkRTMEligibility(auctionId, nextResult.id);

            // Broadcast new player
            this.server.to(roomName).emit('new_player', {
              player: {
                id: nextResult.id,
                name: nextResult.name,
                role: nextResult.role,
                country: nextResult.country,
                basePriceLakh: nextResult.basePriceLakh,
                isOverseas: nextResult.isOverseas,
                isCapped: nextResult.isCapped,
                auctionSet: nextResult.auctionSet,
                iplTeam2024: nextResult.iplTeam2024, // ✅ NEW: Previous team
                rtmEligible: rtmEligibility.eligible, // ✅ NEW: Is RTM available
                rtmTeamId: rtmEligibility.teamId || null, // ✅ NEW: Which team can RTM
                rtmTeamName: rtmEligibility.teamName || null, // ✅ NEW: RTM team name
              },
              currentSet: updatedAuction?.currentSet,
              currentRound: updatedAuction?.currentRound,
              rtmState: rtmState || null, // ✅ NEW: Include RTM state
            });

            console.log(`🎯 Next: ${nextResult.name}`);
          } catch (nextError) {
            console.error('❌ Failed to auto-advance after sale:', nextError);
            console.error('Error details:', nextError.stack);
            // Don't fail the sale operation if next player fails
          }
        });
      }
    } catch (error) {
      console.error('Error selling player:', error);
      client.emit('error', {
        code: 'SELL_FAILED',
        message: error.message || 'Failed to sell player',
      });
    }
  }

  /**
   * Admin: Mark player as unsold
   */
  @SubscribeMessage('mark_unsold')
  async handleMarkUnsold(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AdminActionPayload,
  ) {
    try {
      const { auctionId, adminSessionId, playerId } = payload;

      if (!playerId) {
        client.emit('error', {
          code: 'MISSING_PLAYER_ID',
          message: 'Player ID is required',
        });
        return;
      }

      // Try cache first for admin verification
      let auction = await this.redis.getCachedAuction(auctionId);

      if (!auction) {
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
        });

        if (auction) {
          await this.redis.cacheAuction(auctionId, auction, 30);
        }
      }

      if (!auction || auction.adminSessionId !== adminSessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Only admin can mark players unsold',
        });
        return;
      }

      // Mark unsold
      const result = await this.biddingService.markUnsold(auctionId, playerId);

      if (!result.player) {
        client.emit('error', {
          code: 'PLAYER_NOT_FOUND',
          message: 'Player not found',
        });
        return;
      }

      const roomName = `auction:${auctionId}`;

      // Broadcast unsold event
      this.server.to(roomName).emit('player_unsold', {
        playerId: result.player.id,
        playerName: result.player.name,
      });

      console.log(`⏭️  UNSOLD: ${result.player.name}`);

      // Auto-advance to next player (async to not block UI response)
      setImmediate(async () => {
        try {
          const nextResult = await this.playerProgressionService.loadNextPlayer(auctionId);

          // Check if round completed
          if (nextResult.completed) {
            this.server.to(roomName).emit('round_completed', {
              message: nextResult.message,
            });
            console.log(`🎊 ${nextResult.message}`);
            return;
          }

          // Get fresh auction state
          const updatedAuction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
            include: { currentPlayer: true },
          });

          // Get RTM state if active, to ensure it's sent with the new player
          const rtmState = await this.redis.getRTMState(auctionId);

          // Check RTM eligibility for this player
          const rtmEligibility = await this.rtmService.checkRTMEligibility(auctionId, nextResult.id);

          // Broadcast new player
          this.server.to(roomName).emit('new_player', {
            player: {
              id: nextResult.id,
              name: nextResult.name,
              role: nextResult.role,
              country: nextResult.country,
              basePriceLakh: nextResult.basePriceLakh,
              isOverseas: nextResult.isOverseas,
              isCapped: nextResult.isCapped,
              auctionSet: nextResult.auctionSet,
              iplTeam2024: nextResult.iplTeam2024, // ✅ NEW: Previous team
              rtmEligible: rtmEligibility.eligible, // ✅ NEW: Is RTM available
              rtmTeamId: rtmEligibility.teamId || null, // ✅ NEW: Which team can RTM
              rtmTeamName: rtmEligibility.teamName || null, // ✅ NEW: RTM team name
            },
            currentSet: updatedAuction?.currentSet,
            currentRound: updatedAuction?.currentRound,
            rtmState: rtmState || null, // ✅ NEW: Include RTM state
          });

          console.log(`🎯 Next: ${nextResult.name}`);
        } catch (nextError) {
          console.error('Failed to auto-advance after unsold:', nextError);
          // Don't fail the unsold operation if next player fails
        }
      });
    } catch (error) {
      console.error('Error marking unsold:', error);
      client.emit('error', {
        code: 'UNSOLD_FAILED',
        message: error.message || 'Failed to mark player unsold',
      });
    }
  }

  /**
   * Admin: Load next player
   */
  @SubscribeMessage('next_player')
  async handleNextPlayer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: AdminActionPayload,
  ) {
    try {
      const { auctionId, adminSessionId } = payload;

      // Try cache first for admin verification
      let auction = await this.redis.getCachedAuction(auctionId);

      if (!auction) {
        auction = await this.prisma.auction.findUnique({
          where: { id: auctionId },
        });

        if (auction) {
          await this.redis.cacheAuction(auctionId, auction, 30);
        }
      }

      if (!auction || auction.adminSessionId !== adminSessionId) {
        client.emit('error', {
          code: 'UNAUTHORIZED',
          message: 'Only admin can load next player',
        });
        return;
      }

      // Load next player
      const result = await this.playerProgressionService.loadNextPlayer(auctionId);

      // Check if round completed
      if (result.completed) {
        const roomName = `auction:${auctionId}`;
        this.server.to(roomName).emit('round_completed', {
          message: result.message,
        });
        console.log(`🎊 ${result.message}`);
        return;
      }

      // Get fresh auction state
      const updatedAuction = await this.prisma.auction.findUnique({
        where: { id: auctionId },
        include: { currentPlayer: true },
      });

      // Get RTM state if active, to ensure it's sent with the new player
      const rtmState = await this.redis.getRTMState(auctionId);

      // Broadcast new player to all clients
      const roomName = `auction:${auctionId}`;

      // Check RTM eligibility for this player
      const rtmEligibility = await this.rtmService.checkRTMEligibility(auctionId, result.id);

      this.server.to(roomName).emit('new_player', {
        player: {
          id: result.id,
          name: result.name,
          role: result.role,
          country: result.country,
          basePriceLakh: result.basePriceLakh,
          isOverseas: result.isOverseas,
          isCapped: result.isCapped,
          auctionSet: result.auctionSet,
          iplTeam2024: result.iplTeam2024, // ✅ NEW: Previous team
          rtmEligible: rtmEligibility.eligible, // ✅ NEW: Is RTM available
          rtmTeamId: rtmEligibility.teamId || null, // ✅ NEW: Which team can RTM
          rtmTeamName: rtmEligibility.teamName || null, // ✅ NEW: RTM team name
        },
        currentSet: updatedAuction?.currentSet,
        currentRound: updatedAuction?.currentRound,
        rtmState: rtmState || null, // ✅ NEW: Include RTM state
      });

      console.log(`🎯 NEW PLAYER: ${result.name} (${result.auctionSet})`);
    } catch (error) {
      console.error('Error loading next player:', error);
      client.emit('error', {
        code: 'NEXT_PLAYER_FAILED',
        message: error.message || 'Failed to load next player',
      });
    }
  }

  /**
   * RTM team uses RTM card to match bid
   */
  @SubscribeMessage('use_rtm')
  async handleUseRTM(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string; teamId: string },
  ) {
    try {
      const { auctionId, teamId } = payload;

      // Use RTM
      const result = await this.rtmService.useRTM(auctionId, teamId);

      // Fetch full player details to include in the event payload
      const player = await this.prisma.player.findUnique({
        where: { id: result.state.playerId },
      });

      // Broadcast RTM used - waiting for counter-bid
      const roomName = `auction:${auctionId}`;
      this.server.to(roomName).emit('rtm_used', {
        // Add full player context for agents
        playerId: result.state.playerId,
        playerName: result.state.playerName,
        // Use fresh player data from DB
        isCapped: player?.isCapped ?? result.state.isCapped,
        isOverseas: player?.isOverseas ?? false,
        role: player?.role ?? 'UNKNOWN',
        // Continue with RTM state
        rtmTeamId: result.state.rtmTeamId,
        rtmTeamName: result.state.rtmTeamName,
        matchedBidLakh: result.state.matchedBidLakh,
        originalWinnerTeamId: result.state.originalWinnerTeamId,
        originalWinnerTeamName: result.state.originalWinnerTeamName,
        counterBidAllowed: result.state.counterBidAllowed,
        message: result.message,
      });

      console.log(`✅ RTM used: ${result.state.rtmTeamName}`);
    } catch (error) {
      console.error('Error using RTM:', error);
      client.emit('error', {
        code: 'RTM_FAILED',
        message: error.message || 'Failed to use RTM',
      });
    }
  }

  /**
   * Original winner makes counter-bid after RTM
   */
  @SubscribeMessage('rtm_counter_bid')
  async handleRTMCounterBid(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string; teamId: string; newBidLakh: number },
  ) {
    try {
      const { auctionId, teamId, newBidLakh } = payload;

      // Make counter-bid
      const result = await this.rtmService.counterBid(auctionId, teamId, newBidLakh);

      // Get updated RTM state
      const rtmState = await this.redis.getRTMState(auctionId);

      // Broadcast counter-bid with full RTM state
      const roomName = `auction:${auctionId}`;
      this.server.to(roomName).emit('rtm_counter_bid_placed', {
        ...rtmState,
        message: result.message,
      });

      console.log(`💰 Counter-bid: ₹${newBidLakh}L`);
    } catch (error) {
      console.error('Error placing counter-bid:', error);
      client.emit('error', {
        code: 'COUNTER_BID_FAILED',
        message: error.message || 'Failed to place counter-bid',
      });
    }
  }

  /**
   * RTM team finalizes decision (accepts/passes)
   */
  @SubscribeMessage('finalize_rtm')
  async handleFinalizeRTM(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string; teamId: string; rtmAccepts: boolean },
  ) {
    try {
      const { auctionId, teamId, rtmAccepts } = payload;

      // Get RTM state to verify authorization
      const rtmState = await this.redis.getRTMState(auctionId);

      if (!rtmState) {
        client.emit('error', {
          code: 'NO_RTM_ACTIVE',
          message: 'No active RTM process',
        });
        return;
      }

      // Authorization logic:
      // - If counter-bid was made (Stage 3): Only RTM team can finalize
      // - If counter-bid allowed but not made (Stage 2): Only original winner can finalize (Pass)
      // - If RTM not used yet (Stage 1): Only RTM team can pass (decline RTM opportunity)

      if (rtmState.counterBidMade) {
        // Stage 3: Counter-bid was made, only RTM team can accept/pass
        if (rtmState.rtmTeamId !== teamId && rtmState.originalWinnerTeamId !== teamId) {
          client.emit('error', {
            code: 'UNAUTHORIZED',
            message: 'Only the RTM team can finalize after a counter-bid',
          });
          return;
        }
      } else if (rtmState.counterBidAllowed) {
        // Stage 2: RTM used, counter-bid allowed, only original winner can pass
        if (rtmState.originalWinnerTeamId !== teamId) {
          client.emit('error', {
            code: 'UNAUTHORIZED',
            message: 'Only the original winner can finalize at this stage',
          });
          return;
        }
        // When original winner passes (rtmAccepts should be ignored, always goes to RTM team)
        // Override rtmAccepts to true because original winner passing means RTM team gets player
      } else {
        // Stage 1: RTM triggered but card not used yet, RTM team can pass
        if (rtmState.rtmTeamId !== teamId) {
          client.emit('error', {
            code: 'UNAUTHORIZED',
            message: 'Only the RTM team can pass at this stage',
          });
          return;
        }
        // RTM team is passing without using card - player goes to original winner
        if (rtmAccepts) {
          client.emit('error', {
            code: 'INVALID_ACTION',
            message: 'Cannot accept RTM without using RTM card first. Use "Use RTM" button instead.',
          });
          return;
        }
      }

      // Get player info before finalizing
      const player = await this.prisma.player.findUnique({
        where: { id: rtmState.playerId },
      });

      if (!player) {
        client.emit('error', {
          code: 'PLAYER_NOT_FOUND',
          message: 'Player not found',
        });
        return;
      }

      // Determine final decision based on stage
      let finalRtmAccepts: boolean;
      if (rtmState.counterBidMade) {
        // Stage 3: RTM team's decision (accept or pass)
        finalRtmAccepts = rtmAccepts;
      } else if (rtmState.counterBidAllowed) {
        // Stage 2: Original winner is passing, player goes to RTM team
        finalRtmAccepts = true; // Player always goes to RTM team when original winner passes
      } else {
        // Stage 1: RTM team is passing without using card, player goes to original winner
        finalRtmAccepts = false; // Player goes to original winner when RTM team passes
      }

      // Finalize RTM (assigns player, updates purse, creates event)
      const result = await this.rtmService.finalizeRTM(auctionId, finalRtmAccepts);

      // Clear current player and bid from auction
      await this.prisma.auction.update({
        where: { id: auctionId },
        data: {
          currentPlayerId: null,
          currentBidLakh: null,
          currentBiddingTeamId: null,
        },
      });

      // Auto-advance to next player (async to not block UI response)
      setImmediate(async () => {
        try {
          const roomName = `auction:${auctionId}`;
          const nextResult = await this.playerProgressionService.loadNextPlayer(auctionId);

          // Check if round completed
          if (nextResult.completed) {
            this.server.to(roomName).emit('round_completed', {
              message: nextResult.message,
            });
            console.log(`🎊 ${nextResult.message}`);
            return;
          }

          // Get fresh auction state
          const updatedAuction = await this.prisma.auction.findUnique({
            where: { id: auctionId },
            include: { currentPlayer: true },
          });

          // Check RTM eligibility for this player
          const rtmEligibility = await this.rtmService.checkRTMEligibility(auctionId, nextResult.id);

          // Broadcast new player
          this.server.to(roomName).emit('new_player', {
            player: {
              id: nextResult.id,
              name: nextResult.name,
              role: nextResult.role,
              country: nextResult.country,
              basePriceLakh: nextResult.basePriceLakh,
              isOverseas: nextResult.isOverseas,
              isCapped: nextResult.isCapped,
              auctionSet: nextResult.auctionSet,
              iplTeam2024: nextResult.iplTeam2024,
              rtmEligible: rtmEligibility.eligible,
              rtmTeamId: rtmEligibility.teamId || null,
              rtmTeamName: rtmEligibility.teamName || null,
            },
            currentSet: updatedAuction?.currentSet,
            currentRound: updatedAuction?.currentRound,
            rtmState: null, // RTM is finalized, so no active RTM state
          });
        } catch (nextError) {
          console.error('Failed to auto-advance after RTM finalization:', nextError);
        }
      });
    } catch (error) {
      console.error('Error finalizing RTM:', error);
      client.emit('error', {
        code: 'FINALIZE_RTM_FAILED',
        message: error.message || 'Failed to finalize RTM',
      });
    }
  }

  /**
   * Admin ends the auction
   */
  @SubscribeMessage('end_auction')
  async handleEndAuction(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { auctionId: string; adminSessionId: string },
  ) {
    try {
      const { auctionId, adminSessionId } = payload;

      // Call service method with WebSocket server for broadcasting
      const result = await this.auctionsService.endAuction(auctionId, adminSessionId, this.server);

      console.log(`🏁 Auction ended: ${auctionId}`);

      // Emit success to requester
      client.emit('auction_end_success', result);
    } catch (error) {
      console.error('Error ending auction:', error);
      client.emit('error', {
        code: 'END_AUCTION_FAILED',
        message: error.message || 'Failed to end auction',
      });
    }
  }
}
