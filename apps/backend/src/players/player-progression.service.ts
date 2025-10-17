import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Normal round sets (from PRD section 4.3)
const NORMAL_ROUND_SETS = [
  'M1', 'M2',           // Marquee
  'BA1', 'AL1', 'WK1', 'FA1', 'SP1',  // Capped round 1
  'UBA1', 'UAL1', 'UWK1', 'UFA1', 'USP1', // Uncapped round 1
  'BA2', 'AL2', 'WK2', 'FA2', 'SP2',  // Capped round 2
];

// Complete set order for sorting (from PRD)
const SET_ORDER = [
  'M1', 'M2',           // Marquee
  'BA1', 'AL1', 'WK1', 'FA1', 'SP1',  // Capped round 1
  'UBA1', 'UAL1', 'UWK1', 'UFA1', 'USP1', // Uncapped round 1
  'BA2', 'AL2', 'WK2', 'FA2', 'SP2',  // Capped round 2
  'UBA2', 'UAL2', 'UWK2', 'UFA2', 'USP2', // Uncapped round 2 (AR1 starts)
  'BA3', 'AL3', 'WK3', 'FA3', 'SP3',  // Capped round 3
  'UBA3', 'UAL3', 'UWK3', 'UFA3', 'USP3', // Uncapped round 3
  'BA4', 'AL4', 'WK4', 'FA4', 'SP4',  // Capped round 4
  'UBA4', 'UAL4', 'UWK4', 'UFA4', 'USP4', // Uncapped round 4
  'BA5', 'AL5', 'WK5', 'FA5', 'SP5',  // Capped round 5
  'UBA5', 'UAL5', 'UWK5', 'UFA5', 'USP5', // Uncapped round 5
  'BA6', 'AL6', 'WK6', 'FA6', 'SP6',  // Capped round 6
  'UBA6', 'UAL6', 'UWK6', 'UFA6', 'USP6', // Uncapped round 6
  'BA7', 'AL7', 'WK7', 'FA7', 'SP7',  // Capped round 7
  'UBA7', 'UAL7', 'UWK7', 'UFA7', 'USP7', // Uncapped round 7
  'BA8', 'AL8', 'WK8', 'FA8', 'SP8',  // Capped round 8
  'UBA8', 'UAL8', 'UWK8', 'UFA8', 'USP8', // Uncapped round 8
  'BA9', 'AL9', 'WK9', 'FA9', 'SP9',  // Capped round 9
  'UBA9', 'UAL9', 'UWK9', 'UFA9', 'USP9', // Uncapped round 9
  'BA10', 'AL10', 'WK10', 'FA10', 'SP10',  // Capped round 10
  'UBA10', 'UAL10', 'UWK10', 'UFA10', 'USP10', // Uncapped round 10
];

// Helper function to get set order index for sorting
function getSetOrderIndex(auctionSet: string): number {
  const index = SET_ORDER.indexOf(auctionSet);
  return index >= 0 ? index : 999; // Unknown sets go to the end
}

// Accelerated Round 1 starts from UBA2 onwards
const ACCELERATED_1_START_SET = 'UBA2';

@Injectable()
export class PlayerProgressionService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Initialize player queue for an auction
   * Loads all non-retained players by sets
   * Randomizes order within each set for presentation
   */
  async initializePlayerQueue(auctionId: string): Promise<void> {
    console.log(`🎯 Initializing player queue for auction ${auctionId}`);

    // Get all non-retained players - NO sorting to preserve DB insertion order
    const players = await this.prisma.player.findMany({
      where: {
        auctionSet: { not: 'Retained' },
      },
    });

    // Group players by set
    const playersBySet: Record<string, string[]> = {};
    for (const player of players) {
      if (!playersBySet[player.auctionSet]) {
        playersBySet[player.auctionSet] = [];
      }
      playersBySet[player.auctionSet].push(player.id);
    }

    // Randomize order within each set (Fisher-Yates shuffle)
    for (const set of Object.keys(playersBySet)) {
      const playerIds = playersBySet[set];
      for (let i = playerIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerIds[i], playerIds[j]] = [playerIds[j], playerIds[i]];
      }
    }

    // Store in Redis
    for (const [set, playerIds] of Object.entries(playersBySet)) {
      for (const playerId of playerIds) {
        await this.redis.pushToPlayerQueue(auctionId, set, playerId);
      }
    }

    console.log(`✅ Initialized queues for ${Object.keys(playersBySet).length} sets (randomized within each set)`);
  }

  /**
   * Load the first player for the auction
   */
  async loadFirstPlayer(auctionId: string): Promise<any> {
    // Start with M1 (first marquee set)
    const firstSet = NORMAL_ROUND_SETS[0];

    return this.loadNextPlayerFromSet(auctionId, firstSet);
  }

  /**
   * Load next player from a specific set
   */
  private async loadNextPlayerFromSet(auctionId: string, set: string): Promise<any> {
    // Get next player from queue
    const playerId = await this.redis.popFromPlayerQueue(auctionId, set);

    if (!playerId) {
      console.log(`⚠️  No more players in set ${set}`);
      return null;
    }

    // Get player details
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      console.error(`❌ Player ${playerId} not found`);
      return this.loadNextPlayerFromSet(auctionId, set); // Try next in queue
    }

    // Update auction with current player
    await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        currentPlayerId: player.id,
        currentSet: set,
        currentBidLakh: null, // Reset bid
        currentBiddingTeamId: null, // Reset bidding team
      },
    });

    console.log(`🎯 Loaded player: ${player.name} (${set})`);

    return player;
  }

  /**
   * Load next player in sequence
   */
  async loadNextPlayer(auctionId: string): Promise<any> {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
    });

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    const currentSet = auction.currentSet;
    const currentRound = auction.currentRound;

    if (currentRound === 'normal') {
      return this.loadNextPlayerInNormalRound(auctionId, currentSet);
    } else if (currentRound === 'accelerated_1' || currentRound === 'accelerated_2') {
      // For accelerated rounds, check if there are queued players
      return this.loadNextPlayerFromQueue(auctionId);
    }

    throw new BadRequestException(`Unknown round: ${currentRound}`);
  }

  /**
   * Load next player in normal round
   */
  private async loadNextPlayerInNormalRound(auctionId: string, currentSet: string | null): Promise<any> {
    // If no current set, start from beginning
    if (!currentSet) {
      return this.loadFirstPlayer(auctionId);
    }

    // Try to get next player from current set
    const player = await this.loadNextPlayerFromSet(auctionId, currentSet);

    if (player) {
      return player;
    }

    // Current set exhausted, move to next set
    const currentIndex = NORMAL_ROUND_SETS.indexOf(currentSet);

    if (currentIndex === -1) {
      throw new BadRequestException(`Invalid set: ${currentSet}`);
    }

    if (currentIndex >= NORMAL_ROUND_SETS.length - 1) {
      // Normal round complete - clear current player
      await this.prisma.auction.update({
        where: { id: auctionId },
        data: {
          currentPlayerId: null,
          currentSet: null,
          currentBidLakh: null,
          currentBiddingTeamId: null,
        },
      });
      console.log('🎊 Normal round complete');
      return { completed: true, message: 'Normal round complete. Ready for Accelerated Round 1' };
    }

    // Move to next set
    const nextSet = NORMAL_ROUND_SETS[currentIndex + 1];
    console.log(`➡️  Moving from ${currentSet} to ${nextSet}`);

    return this.loadNextPlayerFromSet(auctionId, nextSet);
  }

  /**
   * Get RTM eligible team for a player
   */
  async getRTMEligibleTeam(auctionId: string, playerId: string): Promise<string | null> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player || !player.iplTeam2024) {
      return null;
    }

    // Find the team in this auction that matches player's 2024 team
    const team = await this.prisma.auctionTeam.findFirst({
      where: {
        auctionId,
        teamName: player.iplTeam2024,
      },
    });

    if (!team) {
      return null;
    }

    // Check if team has RTM cards available
    if (team.rtmCardsUsed >= team.rtmCardsTotal) {
      return null;
    }

    return team.id;
  }

  /**
   * Transition to accelerated round 1
   */
  async transitionToAcceleratedRound1(auctionId: string): Promise<void> {
    await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        currentRound: 'accelerated_1',
        currentSet: null,
        currentPlayerId: null,
        currentBidLakh: null,
        currentBiddingTeamId: null,
      },
    });

    console.log('🚀 Transitioned to Accelerated Round 1');
  }

  /**
   * Transition to accelerated round 2
   */
  async transitionToAcceleratedRound2(auctionId: string): Promise<void> {
    await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        currentRound: 'accelerated_2',
        currentSet: null,
        currentPlayerId: null,
        currentBidLakh: null,
        currentBiddingTeamId: null,
      },
    });

    console.log('🚀 Transitioned to Accelerated Round 2');
  }

  /**
   * Load specific player (for accelerated rounds)
   */
  async loadSpecificPlayer(auctionId: string, playerId: string): Promise<any> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new BadRequestException('Player not found');
    }

    // Check if player is already sold
    const existingPurchase = await this.prisma.teamPlayer.findFirst({
      where: { playerId },
      include: { team: true },
    });

    if (existingPurchase && existingPurchase.team.auctionId === auctionId) {
      throw new BadRequestException('Player already sold in this auction');
    }

    // Update auction
    await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        currentPlayerId: player.id,
        currentSet: player.auctionSet,
        currentBidLakh: null,
        currentBiddingTeamId: null,
      },
    });

    console.log(`🎯 Loaded specific player: ${player.name} (${player.auctionSet})`);

    return player;
  }

  /**
   * Get available players for Accelerated Round 1
   * Per PRD 4.4.2: Returns "not presented" players from UBA2 onwards
   * Does NOT include unsold players from normal round (M1-SP2)
   */
  async getAvailableAR1Players(auctionId: string): Promise<any[]> {
    // Get all players NOT in the normal round sets (M1-SP2) and not retained
    // This gives us ONLY "not presented" players from UBA2 onwards
    // Unsold players from normal round (e.g., unsold from BA1, SP1) are excluded
    const players = await this.prisma.player.findMany({
      where: {
        auctionSet: {
          notIn: [...NORMAL_ROUND_SETS, 'Retained']
        },
      },
    });

    console.log(`📊 AR1 Total: ${players.length} players from UBA2 onwards (not presented in normal round)`);

    // Filter out players that have been sold in this auction (including AR1 sales)
    const soldPlayerIds = await this.prisma.teamPlayer.findMany({
      where: {
        team: {
          auctionId,
        },
        isRetained: false, // Only check sold players, not retained
      },
      select: { playerId: true },
    });

    const soldIds = new Set(soldPlayerIds.map(tp => tp.playerId));
    const availablePlayers = players.filter(p => !soldIds.has(p.id));

    console.log(`📊 AR1 Sold: ${soldIds.size} players already sold in this auction`);

    // Sort by set order (M1, M2, BA1, AL1, etc.) then by name
    availablePlayers.sort((a, b) => {
      const setOrderDiff = getSetOrderIndex(a.auctionSet) - getSetOrderIndex(b.auctionSet);
      if (setOrderDiff !== 0) return setOrderDiff;
      return a.name.localeCompare(b.name);
    });

    console.log(`📋 AR1 Available: ${availablePlayers.length} players ready for selection (not presented, not sold)`);

    return availablePlayers;
  }

  /**
   * Get available players for Accelerated Round 2
   * Per PRD 4.4.3: Returns ALL unsold + remaining not presented players
   * This includes: unsold from normal round (M1-SP2) + unsold from AR1 (UBA2+) + not presented
   */
  async getAvailableAR2Players(auctionId: string): Promise<any[]> {
    // Get all players that have been sold in this auction (normal round + AR1)
    const soldPlayerIds = await this.prisma.teamPlayer.findMany({
      where: {
        team: { auctionId },
        isRetained: false, // Exclude retained players
      },
      select: { playerId: true },
    });

    const soldIds = new Set(soldPlayerIds.map(tp => tp.playerId));

    console.log(`📊 AR2 Sold: ${soldIds.size} players sold in this auction (normal + AR1, excluding retained)`);

    // Get all non-retained players
    const players = await this.prisma.player.findMany({
      where: {
        auctionSet: {
          not: 'Retained',
        },
      },
    });

    console.log(`📊 AR2 Total: ${players.length} non-retained players in database`);

    // Filter out sold players - leaves us with unsold + not presented
    const availablePlayers = players.filter(p => !soldIds.has(p.id));

    // Sort by set order (M1, M2, BA1, AL1, etc.) then by name
    availablePlayers.sort((a, b) => {
      const setOrderDiff = getSetOrderIndex(a.auctionSet) - getSetOrderIndex(b.auctionSet);
      if (setOrderDiff !== 0) return setOrderDiff;
      return a.name.localeCompare(b.name);
    });

    console.log(`📋 AR2 Available: ${availablePlayers.length} players ready for selection (unsold + not presented)`);

    return availablePlayers;
  }

  /**
   * Queue a player for accelerated round
   */
  async queuePlayer(auctionId: string, playerId: string): Promise<void> {
    // Use a generic key for all accelerated round queues
    await this.redis.pushToPlayerQueue(auctionId, 'AR', playerId);
    console.log(`➕ Queued player ${playerId} for accelerated round`);
  }

  /**
   * Load next player from accelerated round queue
   */
  private async loadNextPlayerFromQueue(auctionId: string): Promise<any> {
    // Check queue
    const queueLength = await this.redis.getPlayerQueueLength(auctionId, 'AR');

    if (queueLength === 0) {
      // No more players in queue - clear current player and show selection UI
      await this.prisma.auction.update({
        where: { id: auctionId },
        data: {
          currentPlayerId: null,
          currentSet: null,
          currentBidLakh: null,
          currentBiddingTeamId: null,
        },
      });
      return {
        completed: true,
        message: 'No more players in queue. Select more players to continue.',
      };
    }

    // Pop next player from queue
    const playerId = await this.redis.popFromPlayerQueue(auctionId, 'AR');

    if (!playerId) {
      // Clear current player
      await this.prisma.auction.update({
        where: { id: auctionId },
        data: {
          currentPlayerId: null,
          currentSet: null,
          currentBidLakh: null,
          currentBiddingTeamId: null,
        },
      });
      return {
        completed: true,
        message: 'No more players in queue. Select more players to continue.',
      };
    }

    // Load the player
    const player = await this.loadSpecificPlayer(auctionId, playerId);

    console.log(`🎯 Loaded next player from queue: ${player.name} (${queueLength - 1} remaining)`);

    return player;
  }
}
