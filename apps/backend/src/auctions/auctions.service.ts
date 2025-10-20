import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamsInitService } from '../teams/teams-init.service';
import { PlayerProgressionService } from '../players/player-progression.service';
import { AuctionGateway } from '../websocket/auction.gateway';
import { generateRoomCode } from '../common/utils/room-code.util';
import { v4 as uuidv4 } from 'uuid';

interface CreateAuctionData {
  name: string;
  type: 'public' | 'private';
}

@Injectable()
export class AuctionsService {
  constructor(
    private prisma: PrismaService,
    private teamsInitService: TeamsInitService,
    private playerProgressionService: PlayerProgressionService,
    @Inject(forwardRef(() => AuctionGateway))
    private auctionGateway: AuctionGateway,
  ) {}

  /**
   * Create a new auction with all 10 teams initialized
   */
  async create(data: CreateAuctionData) {
    const { name, type } = data;

    // Clean up old abandoned auctions before creating new one
    await this.cleanupAbandonedAuctions();

    // Generate room code for private auctions
    let roomCode: string | null = null;
    if (type === 'private') {
      roomCode = await this.generateUniqueRoomCode();
    }

    // Generate admin session ID
    const adminSessionId = uuidv4();

    // Create auction (no timer)
    const auction = await this.prisma.auction.create({
      data: {
        name,
        roomCode,
        type,
        status: 'waiting',
        timerSeconds: 0, // No timer in flow
        adminSessionId,
      },
    });

    console.log(`✅ Created auction: ${auction.id} (${type})`);

    // Initialize all 10 teams with retentions
    await this.teamsInitService.initializeTeams(auction.id);

    // Clear any residual sold players (in case teams were reused from a previous auction)
    // This should not normally happen, but protects against data inconsistencies
    const teamsInAuction = await this.prisma.auctionTeam.findMany({
      where: { auctionId: auction.id },
      select: { id: true },
    });

    if (teamsInAuction.length > 0) {
      const teamIds = teamsInAuction.map(t => t.id);
      await this.prisma.teamPlayer.deleteMany({
        where: {
          teamId: { in: teamIds },
          isRetained: false,
        },
      });
      console.log(`🧹 Cleared any residual sold players for new auction ${auction.id}`);
    }

    // Get all teams for response
    const teams = await this.teamsInitService.getAllTeamsForAuction(auction.id);

    return {
      auctionId: auction.id,
      name: auction.name,
      type: auction.type,
      roomCode: auction.roomCode,
      adminToken: adminSessionId,
      teams: teams.map((team) => ({
        id: team.id,
        teamName: team.teamName,
        purseRemainingCr: team.purseRemainingCr.toNumber(),
        rtmCardsTotal: team.rtmCardsTotal,
        playerCount: team.playerCount,
        overseasCount: team.overseasCount,
        retainedPlayers: team.players.map((tp) => ({
          name: tp.player.name,
          role: tp.player.role,
          priceCr: tp.purchasePriceCr.toNumber(),
          isOverseas: tp.player.isOverseas,
        })),
      })),
    };
  }

  /**
   * Generate a unique room code that doesn't exist in database
   */
  private async generateUniqueRoomCode(): Promise<string> {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = generateRoomCode();

      // Check if code already exists
      const existing = await this.prisma.auction.findUnique({
        where: { roomCode: code },
      });

      if (!existing) {
        return code;
      }

      attempts++;
    }

    throw new BadRequestException('Failed to generate unique room code');
  }

  /**
   * Find auction by room code
   */
  async findByRoomCode(roomCode: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { roomCode },
      include: {
        teams: {
          include: {
            players: {
              include: {
                player: true,
              },
            },
          },
        },
        currentPlayer: true,
      },
    });

    if (!auction) {
      throw new NotFoundException(`Auction with room code ${roomCode} not found`);
    }

    // Format teams with retained players (same as findById)
    const formattedTeams = auction.teams.map((team) => ({
      id: team.id,
      teamName: team.teamName,
      purseRemainingCr: team.purseRemainingCr.toNumber(),
      rtmCardsTotal: team.rtmCardsTotal,
      rtmCardsUsed: team.rtmCardsUsed,
      playerCount: team.playerCount,
      overseasCount: team.overseasCount,
      ownerSessionId: team.ownerSessionId,
      retainedPlayers: team.players
        .filter((tp) => tp.isRetained)
        .map((tp) => ({
          name: tp.player.name,
          role: tp.player.role,
          priceCr: tp.purchasePriceCr.toNumber(),
          isOverseas: tp.player.isOverseas,
        })),
    }));

    return {
      id: auction.id,
      name: auction.name,
      type: auction.type,
      status: auction.status,
      roomCode: auction.roomCode,
      currentRound: auction.currentRound,
      currentSet: auction.currentSet,
      currentPlayer: auction.currentPlayer,
      adminSessionId: auction.adminSessionId,
      currentPlayerId: auction.currentPlayerId,
      currentBidLakh: auction.currentBidLakh,
      currentBiddingTeamId: auction.currentBiddingTeamId,
      teams: formattedTeams,
    };
  }

  /**
   * Find auction by ID
   */
  async findById(auctionId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        teams: {
          include: {
            players: {
              include: {
                player: true,
              },
            },
          },
        },
        currentPlayer: true,
      },
    });

    if (!auction) {
      throw new NotFoundException(`Auction ${auctionId} not found`);
    }

    // Format teams with retained players
    const formattedTeams = auction.teams.map((team) => ({
      id: team.id,
      teamName: team.teamName,
      purseRemainingCr: team.purseRemainingCr.toNumber(),
      rtmCardsTotal: team.rtmCardsTotal,
      rtmCardsUsed: team.rtmCardsUsed,
      playerCount: team.playerCount,
      overseasCount: team.overseasCount,
      ownerSessionId: team.ownerSessionId,
      retainedPlayers: team.players
        .filter((tp) => tp.isRetained)
        .map((tp) => ({
          name: tp.player.name,
          role: tp.player.role,
          priceCr: tp.purchasePriceCr.toNumber(),
          isOverseas: tp.player.isOverseas,
        })),
    }));

    return {
      id: auction.id,
      name: auction.name,
      type: auction.type,
      status: auction.status,
      roomCode: auction.roomCode,
      currentRound: auction.currentRound,
      currentSet: auction.currentSet,
      currentPlayer: auction.currentPlayer,
      adminSessionId: auction.adminSessionId,
      currentPlayerId: auction.currentPlayerId,
      currentBidLakh: auction.currentBidLakh,
      currentBiddingTeamId: auction.currentBiddingTeamId,
      teams: formattedTeams,
    };
  }

  /**
   * Join auction - assign team to user session
   */
  async joinAuction(auctionId: string, teamId: string, sessionId: string) {
    // Check if auction exists and is waiting
    const auction = await this.findById(auctionId);

    if (auction.status !== 'waiting') {
      throw new BadRequestException('Auction has already started or completed');
    }

    // Check if team exists and is available
    const team = await this.prisma.auctionTeam.findUnique({
      where: { id: teamId },
    });

    if (!team || team.auctionId !== auctionId) {
      throw new BadRequestException('Invalid team for this auction');
    }

    if (team.ownerSessionId) {
      throw new BadRequestException('Team already taken');
    }

    // Assign team to user
    const updatedTeam = await this.prisma.auctionTeam.update({
      where: { id: teamId },
      data: {
        ownerSessionId: sessionId,
        joinedAt: new Date(),
      },
      include: {
        players: {
          include: {
            player: true,
          },
          where: {
            isRetained: true,
          },
        },
      },
    });

    console.log(`✅ User ${sessionId} joined as ${team.teamName}`);

    // Broadcast team_joined event to all users in the auction room (includes both lobby and auction room members)
    const broadcastData = {
      teamId: team.id,
      teamName: team.teamName,
      ownerSessionId: sessionId,
    };
    console.log(`📡 Broadcasting team_joined to room auction:${auctionId}:`, broadcastData);
    // Emit to the auction room - this covers users who have joined via WebSocket (both lobby and auction)
    this.auctionGateway.server.to(`auction:${auctionId}`).emit('team_joined', broadcastData);
    console.log(`📡 Broadcast complete`);

    return updatedTeam;
  }

  /**
   * Start auction - change status to in_progress
   */
  async startAuction(auctionId: string, adminSessionId: string) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can start the auction');
    }

    if (auction.status !== 'waiting') {
      throw new BadRequestException('Auction has already started or completed');
    }

    // Check if at least 2 teams have joined
    const joinedTeams = await this.prisma.auctionTeam.count({
      where: {
        auctionId,
        ownerSessionId: { not: null },
      },
    });

    if (joinedTeams < 2) {
      throw new BadRequestException('At least 2 teams must join to start auction');
    }

    // Clear any sold players from teams in this auction (from previous test runs)
    // This ensures a fresh start for the auction
    const teamsInAuction = await this.prisma.auctionTeam.findMany({
      where: { auctionId },
      select: { id: true },
    });

    const teamIds = teamsInAuction.map(t => t.id);

    // Delete non-retained players (retained players were added during auction creation)
    await this.prisma.teamPlayer.deleteMany({
      where: {
        teamId: { in: teamIds },
        isRetained: false, // Only delete sold players, keep retained players
      },
    });

    console.log(`🧹 Cleared sold players from previous runs for auction ${auctionId}`);

    // Update auction status
    const updatedAuction = await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        status: 'in_progress',
        currentRound: 'normal',
        startedAt: new Date(),
      },
    });

    // Initialize player queue and load first player
    await this.playerProgressionService.initializePlayerQueue(auctionId);
    const firstPlayer = await this.playerProgressionService.loadFirstPlayer(auctionId);

    console.log(`🎬 Auction ${auctionId} started with ${joinedTeams} teams`);

    // Broadcast auction_started event to all users in the lobby
    this.auctionGateway.server.to(`auction:${auctionId}`).emit('auction_started', {
      auctionId,
      status: 'in_progress',
      currentRound: 'normal',
      firstPlayer: firstPlayer ? {
        id: firstPlayer.id,
        name: firstPlayer.name,
        role: firstPlayer.role,
        country: firstPlayer.country,
        basePriceLakh: firstPlayer.basePriceLakh,
        isOverseas: firstPlayer.isOverseas,
        isCapped: firstPlayer.isCapped,
        auctionSet: firstPlayer.auctionSet,
      } : null,
    });
    console.log(`📡 Broadcast auction_started to room auction:${auctionId}`);

    return updatedAuction;
  }

  /**
   * Admin: Skip current player (mark unsold, load next)
   */
  async skipPlayer(auctionId: string, adminSessionId: string, playerId: string) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can skip players');
    }

    // Verify player is current player
    if (auction.currentPlayerId !== playerId) {
      throw new BadRequestException('Can only skip the current player');
    }

    // Note: Player status is tracked via events, not a field on the model

    // Create unsold event
    await this.prisma.auctionEvent.create({
      data: {
        auctionId,
        eventType: 'UNSOLD',
        playerId,
      },
    });

    console.log(`⏭️  Player skipped (unsold): ${playerId}`);

    return { success: true, message: 'Player skipped and marked unsold' };
  }

  /**
   * Admin: Transition to Accelerated Round 1
   */
  async transitionToAcceleratedRound1(auctionId: string, adminSessionId: string) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can transition rounds');
    }

    if (auction.currentRound !== 'normal') {
      throw new BadRequestException('Can only transition to AR1 from Normal round');
    }

    // Use player progression service to transition
    await this.playerProgressionService.transitionToAcceleratedRound1(auctionId);

    console.log(`🚀 Transitioned to Accelerated Round 1`);

    // Broadcast to all clients in the auction room
    this.auctionGateway.server.to(`auction:${auctionId}`).emit('round_transition', {
      round: 'accelerated_1',
      message: 'Transitioned to Accelerated Round 1',
    });

    return {
      success: true,
      message: 'Transitioned to Accelerated Round 1',
      round: 'accelerated_1',
    };
  }

  /**
   * Admin: Transition to Accelerated Round 2
   */
  async transitionToAcceleratedRound2(auctionId: string, adminSessionId: string) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can transition rounds');
    }

    if (auction.currentRound !== 'accelerated_1') {
      throw new BadRequestException('Can only transition to AR2 from Accelerated Round 1');
    }

    // Use player progression service to transition
    await this.playerProgressionService.transitionToAcceleratedRound2(auctionId);

    console.log(`🚀 Transitioned to Accelerated Round 2`);

    // Broadcast to all clients in the auction room
    this.auctionGateway.server.to(`auction:${auctionId}`).emit('round_transition', {
      round: 'accelerated_2',
      message: 'Transitioned to Accelerated Round 2',
    });

    return {
      success: true,
      message: 'Transitioned to Accelerated Round 2',
      round: 'accelerated_2',
    };
  }

  /**
   * Admin: Load specific player (for accelerated rounds)
   */
  async loadSpecificPlayer(auctionId: string, adminSessionId: string, playerId: string) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can load specific players');
    }

    // Verify in accelerated round
    if (auction.currentRound === 'normal') {
      throw new BadRequestException('Can only select specific players in accelerated rounds');
    }

    // Load player via player progression service
    const player = await this.playerProgressionService.loadSpecificPlayer(auctionId, playerId);

    console.log(`🎯 Loaded specific player: ${player.name}`);

    // Broadcast new player to all clients in the auction room
    this.auctionGateway.server.to(`auction:${auctionId}`).emit('new_player', {
      player: {
        id: player.id,
        name: player.name,
        role: player.role,
        country: player.country,
        basePriceLakh: player.basePriceLakh,
        isOverseas: player.isOverseas,
        isCapped: player.isCapped,
        auctionSet: player.auctionSet,
      },
      currentSet: player.auctionSet,
      currentRound: auction.currentRound,
    });

    return {
      success: true,
      player: {
        id: player.id,
        name: player.name,
        role: player.role,
        country: player.country,
        basePriceLakh: player.basePriceLakh,
        isOverseas: player.isOverseas,
        isCapped: player.isCapped,
        auctionSet: player.auctionSet,
      },
    };
  }

  /**
   * Admin: Queue multiple players for accelerated round and load the first one
   */
  async queueAR1Players(auctionId: string, adminSessionId: string, playerIds: string[]) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can queue players');
    }

    // Verify in accelerated round
    if (auction.currentRound !== 'accelerated_1' && auction.currentRound !== 'accelerated_2') {
      throw new BadRequestException('Can only queue players in accelerated rounds');
    }

    if (!playerIds || playerIds.length === 0) {
      throw new BadRequestException('No players provided');
    }

    // Queue all players except the first (which will be loaded immediately)
    for (let i = 1; i < playerIds.length; i++) {
      await this.playerProgressionService.queuePlayer(auctionId, playerIds[i]);
    }

    console.log(`📋 Queued ${playerIds.length - 1} players for accelerated round`);

    // Load the first player immediately
    const result = await this.loadSpecificPlayer(auctionId, adminSessionId, playerIds[0]);

    return {
      success: true,
      queuedCount: playerIds.length - 1,
      firstPlayer: result.player,
    };
  }

  /**
   * Admin: End auction
   */
  async endAuction(auctionId: string, adminSessionId: string, server?: any) {
    const auction = await this.findById(auctionId);

    // Verify admin
    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can end the auction');
    }

    if (auction.status === 'completed') {
      throw new BadRequestException('Auction is already completed');
    }

    // Update auction status
    const updatedAuction = await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        status: 'completed',
        endedAt: new Date(),
        currentPlayerId: null,
        currentBidLakh: null,
        currentBiddingTeamId: null,
      },
    });

    // Get final standings
    const teams = await this.prisma.auctionTeam.findMany({
      where: { auctionId },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
      orderBy: {
        playerCount: 'desc',
      },
    });

    console.log(`🏁 Auction ${auctionId} ended`);

    const response = {
      success: true,
      message: 'Auction completed',
      auction: {
        id: updatedAuction.id,
        name: updatedAuction.name,
        status: updatedAuction.status,
        endedAt: updatedAuction.endedAt,
      },
      finalStandings: teams.map((team) => ({
        teamName: team.teamName,
        playerCount: team.playerCount,
        overseasCount: team.overseasCount,
        purseRemainingCr: team.purseRemainingCr.toNumber(),
        rtmCardsUsed: team.rtmCardsUsed,
        players: team.players.map((tp) => ({
          name: tp.player.name,
          role: tp.player.role,
          purchasePriceCr: tp.purchasePriceCr.toNumber(),
          isRetained: tp.isRetained,
        })),
      })),
    };

    // Emit WebSocket event if server is provided
    if (server) {
      server.to(`auction:${auctionId}`).emit('auction_ended', {
        auctionId,
        status: 'completed',
        endedAt: updatedAuction.endedAt,
        finalStandings: response.finalStandings,
      });
    }

    return response;
  }

  /**
   * Delete old completed auctions to free up database space
   * This helps prevent unique constraint violations when creating new auctions
   */
  async deleteOldAuctions(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Find old completed auctions
    const oldAuctions = await this.prisma.auction.findMany({
      where: {
        status: 'completed',
        createdAt: {
          lt: cutoffDate,
        },
      },
      select: { id: true, name: true },
    });

    console.log(`🧹 Found ${oldAuctions.length} old completed auctions to delete`);

    // Delete auctions (teams and teamPlayers will cascade delete)
    const result = await this.prisma.auction.deleteMany({
      where: {
        id: {
          in: oldAuctions.map(a => a.id),
        },
      },
    });

    console.log(`✅ Deleted ${result.count} old auctions`);
    return result.count;
  }

  /**
   * Delete a specific auction by ID (admin only)
   */
  async deleteAuction(auctionId: string, adminSessionId: string): Promise<void> {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
    });

    if (!auction) {
      throw new NotFoundException('Auction not found');
    }

    if (auction.adminSessionId !== adminSessionId) {
      throw new BadRequestException('Only admin can delete this auction');
    }

    // Delete auction (teams and teamPlayers will cascade delete)
    await this.prisma.auction.delete({
      where: { id: auctionId },
    });

    console.log(`🗑️  Deleted auction ${auctionId} (${auction.name})`);
  }

  /**
   * Clean up old waiting auctions that were never started (older than 1 day)
   */
  async cleanupAbandonedAuctions(): Promise<number> {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const result = await this.prisma.auction.deleteMany({
      where: {
        status: 'waiting',
        createdAt: {
          lt: oneDayAgo,
        },
      },
    });

    if (result.count > 0) {
      console.log(`🧹 Cleaned up ${result.count} abandoned auctions`);
    }

    return result.count;
  }

  /**
   * Delete ALL auctions except the most recent one (for testing/development)
   * WARNING: This is destructive and should only be used in development
   */
  async cleanupAllExceptRecent(): Promise<number> {
    // Get the most recent auction
    const recentAuction = await this.prisma.auction.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!recentAuction) {
      console.log('No auctions found');
      return 0;
    }

    // Delete all auctions except the most recent one
    const result = await this.prisma.auction.deleteMany({
      where: {
        id: {
          not: recentAuction.id,
        },
      },
    });

    console.log(`🧹 Deleted ${result.count} old auctions, kept most recent one`);
    return result.count;
  }

  /**
   * Delete ALL auctions (for testing/development)
   * WARNING: This is very destructive
   */
  async deleteAllAuctions(): Promise<number> {
    const result = await this.prisma.auction.deleteMany({});
    console.log(`🗑️  Deleted ALL ${result.count} auctions`);
    return result.count;
  }

  /**
   * Get available players for Accelerated Round 1
   */
  async getAvailableAR1Players(auctionId: string) {
    const players = await this.playerProgressionService.getAvailableAR1Players(auctionId);

    return {
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        role: player.role,
        country: player.country,
        basePriceLakh: player.basePriceLakh,
        isOverseas: player.isOverseas,
        isCapped: player.isCapped,
        auctionSet: player.auctionSet,
      })),
    };
  }

  async getAvailableAR2Players(auctionId: string) {
    const players = await this.playerProgressionService.getAvailableAR2Players(auctionId);

    return {
      players: players.map((player) => ({
        id: player.id,
        name: player.name,
        role: player.role,
        country: player.country,
        basePriceLakh: player.basePriceLakh,
        isOverseas: player.isOverseas,
        isCapped: player.isCapped,
        auctionSet: player.auctionSet,
      })),
    };
  }

  async getPoolData(auctionId: string) {
    // Get auction to check current round
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { currentRound: true },
    });

    if (!auction) {
      throw new Error('Auction not found');
    }

    // Define sets for each round (from PRD)
    const NORMAL_ROUND_SETS = [
      'M1', 'M2',           // Marquee
      'BA1', 'AL1', 'WK1', 'FA1', 'SP1',  // Capped round 1
      'UBA1', 'UAL1', 'UWK1', 'UFA1', 'USP1', // Uncapped round 1
      'BA2', 'AL2', 'WK2', 'FA2', 'SP2',  // Capped round 2
    ];

    // Get all players
    const allPlayers = await this.prisma.player.findMany({
      where: {
        auctionSet: { not: 'Retained' },
      },
    });

    // Get sold players (in this auction)
    const soldPlayers = await this.prisma.teamPlayer.findMany({
      where: {
        team: { auctionId },
        isRetained: false,
      },
      include: {
        player: true,
        team: true,
      },
    });

    // Get unsold players (from AuctionEvent with eventType = 'UNSOLD')
    const unsoldEvents = await this.prisma.auctionEvent.findMany({
      where: {
        auctionId,
        eventType: 'UNSOLD',
      },
      select: { playerId: true },
    });

    const soldPlayerIds = new Set(soldPlayers.map(sp => sp.playerId));
    const unsoldIds = new Set(unsoldEvents.map((ev: any) => ev.playerId));

    // Pending = not sold AND not unsold
    let pendingPlayers = allPlayers.filter(p => !soldPlayerIds.has(p.id) && !unsoldIds.has(p.id));

    // Filter pending players based on current round
    if (auction.currentRound === 'normal') {
      // Normal round: only show players from M1-SP2
      pendingPlayers = pendingPlayers.filter(p => NORMAL_ROUND_SETS.includes(p.auctionSet));
    } else if (auction.currentRound === 'accelerated_1') {
      // AR1: only show players from UBA2 onwards (not presented in normal round)
      pendingPlayers = pendingPlayers.filter(p => !NORMAL_ROUND_SETS.includes(p.auctionSet));
    }
    // AR2: show all pending players (no filter needed)

    const unsoldPlayers = allPlayers.filter(p => unsoldIds.has(p.id));

    return {
      sold: soldPlayers.map(sp => ({
        id: sp.player.id,
        name: sp.player.name,
        role: sp.player.role,
        country: sp.player.country,
        teamName: sp.team.teamName,
        soldPriceCr: sp.purchasePriceCr.toNumber(),
        basePriceLakh: sp.player.basePriceLakh,
        auctionSet: sp.player.auctionSet,
      })),
      pending: pendingPlayers.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        country: p.country,
        basePriceLakh: p.basePriceLakh,
        auctionSet: p.auctionSet,
      })),
      unsold: unsoldPlayers.map(p => ({
        id: p.id,
        name: p.name,
        role: p.role,
        country: p.country,
        basePriceLakh: p.basePriceLakh,
        auctionSet: p.auctionSet,
      })),
    };
  }

  async getSquadsData(auctionId: string) {
    const teams = await this.prisma.auctionTeam.findMany({
      where: { auctionId },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });

    return {
      teams: teams.map(team => ({
        id: team.id,
        teamName: team.teamName,
        purseRemainingCr: team.purseRemainingCr.toNumber(),
        playerCount: team.playerCount,
        overseasCount: team.overseasCount,
        rtmCardsUsed: team.rtmCardsUsed,
        rtmCardsTotal: team.rtmCardsTotal,
        players: team.players.map(tp => ({
          id: tp.player.id,
          name: tp.player.name,
          role: tp.player.role,
          country: tp.player.country,
          soldPriceLakh: tp.purchasePriceCr.toNumber() * 100, // Convert Cr to Lakh
          isRetained: tp.isRetained,
          isOverseas: tp.player.isOverseas,
        })),
      })),
    };
  }
}
