/**
 * Prisma Database Manager for PostgreSQL
 * Uses shared DatabasePool singleton to reduce connection overhead
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Player, PlayerStats, PlayerPerformance, MatchData } from '../types/player.types.js';
import { PlayerRole } from '../types/agent.types.js';
import { DatabasePool } from './database-pool.js';

export class PrismaDatabase {
  private prisma: PrismaClient;

  constructor() {
    // Use shared database pool instead of creating new connection
    const dbPool = DatabasePool.getInstance();
    if (!dbPool.isInitialized()) {
      throw new Error('DatabasePool not initialized. Initialize it in orchestrator first.');
    }
    this.prisma = dbPool.getClient();
  }

  // Player operations
  async insertPlayer(player: Player): Promise<void> {
    await this.prisma.player.upsert({
      where: { id: player.id },
      update: {
        name: player.name,
        country: player.country,
        role: player.role,
        isOverseas: player.isOverseas,
        isCapped: player.isCapped,
      },
      create: {
        id: player.id,
        name: player.name,
        country: player.country,
        role: player.role,
        isOverseas: player.isOverseas,
        isCapped: player.isCapped,
      },
    });
  }

  async insertPlayers(players: Player[]): Promise<void> {
    // Use transaction for bulk insert
    await this.prisma.$transaction(
      players.map((player) =>
        this.prisma.player.upsert({
          where: { id: player.id },
          update: {
            name: player.name,
            country: player.country,
            role: player.role,
            isOverseas: player.isOverseas,
            isCapped: player.isCapped,
          },
          create: {
            id: player.id,
            name: player.name,
            country: player.country,
            role: player.role,
            isOverseas: player.isOverseas,
            isCapped: player.isCapped,
          },
        })
      )
    );
  }

  async getPlayer(id: string): Promise<Player | null> {
    const player = await this.prisma.player.findUnique({
      where: { id },
    });

    if (!player) return null;

    return {
      id: player.id,
      name: player.name,
      country: player.country ?? undefined,
      role: (player.role as PlayerRole) ?? undefined,
      isOverseas: player.isOverseas,
      isCapped: player.isCapped,
    };
  }

  async getPlayerByName(name: string): Promise<Player | null> {
    const player = await this.prisma.player.findFirst({
      where: { name },
    });

    if (!player) return null;

    return {
      id: player.id,
      name: player.name,
      country: player.country ?? undefined,
      role: (player.role as PlayerRole) ?? undefined,
      isOverseas: player.isOverseas,
      isCapped: player.isCapped,
    };
  }

  // Match operations
  async insertMatch(match: MatchData): Promise<void> {
    await this.prisma.match.upsert({
      where: { matchId: match.matchId },
      update: {
        date: match.date ? new Date(match.date) : null,
        venue: match.venue,
        matchType: match.matchType,
        teams: match.teams as unknown as Prisma.InputJsonValue,
      },
      create: {
        matchId: match.matchId,
        date: match.date ? new Date(match.date) : null,
        venue: match.venue,
        matchType: match.matchType,
        teams: match.teams as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // Performance operations
  async insertPerformance(performance: PlayerPerformance): Promise<void> {
    try {
      await this.prisma.playerPerformance.create({
        data: {
          playerName: '',
          batting: (performance.batting ?? null) as Prisma.InputJsonValue,
          bowling: (performance.bowling ?? null) as Prisma.InputJsonValue,
          fielding: (performance.fielding ?? null) as Prisma.InputJsonValue,
          match: {
            connect: { matchId: performance.matchId },
          },
          player: {
            connect: { id: performance.playerId },
          },
        },
      });
    } catch (error: any) {
      // Skip if player/match doesn't exist or performance already exists
      if (error.code !== 'P2025' && error.code !== 'P2002') {
        throw error;
      }
    }
  }

  async insertPerformances(performances: PlayerPerformance[]): Promise<void> {
    // Insert performances one by one (createMany doesn't support relations)
    for (const perf of performances) {
      await this.insertPerformance(perf);
    }
  }

  // Stats operations
  async upsertPlayerStats(playerId: string, stats: Partial<PlayerStats>): Promise<void> {
    await this.prisma.playerStats.upsert({
      where: { playerId },
      update: {
        battingStats: (stats.battingStats ?? null) as unknown as Prisma.InputJsonValue,
        bowlingStats: (stats.bowlingStats ?? null) as unknown as Prisma.InputJsonValue,
        fieldingStats: (stats.fieldingStats ?? null) as unknown as Prisma.InputJsonValue,
      },
      create: {
        playerId,
        battingStats: (stats.battingStats ?? null) as unknown as Prisma.InputJsonValue,
        bowlingStats: (stats.bowlingStats ?? null) as unknown as Prisma.InputJsonValue,
        fieldingStats: (stats.fieldingStats ?? null) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async getPlayerStats(playerId: string): Promise<PlayerStats | null> {
    const stats = await this.prisma.playerStats.findUnique({
      where: { playerId },
    });

    if (!stats) return null;

    return {
      playerId: stats.playerId,
      battingStats: stats.battingStats as any,
      bowlingStats: stats.bowlingStats as any,
      fieldingStats: stats.fieldingStats as any,
      lastUpdated: stats.lastUpdated,
    };
  }

  /**
   * Batch query for multiple player stats (more efficient than individual queries)
   */
  async getBatchPlayerStats(playerIds: string[]): Promise<Map<string, PlayerStats>> {
    const statsRecords = await this.prisma.playerStats.findMany({
      where: {
        playerId: { in: playerIds }
      },
    });

    const statsMap = new Map<string, PlayerStats>();

    for (const stats of statsRecords) {
      statsMap.set(stats.playerId, {
        playerId: stats.playerId,
        battingStats: stats.battingStats as any,
        bowlingStats: stats.bowlingStats as any,
        fieldingStats: stats.fieldingStats as any,
        lastUpdated: stats.lastUpdated,
      });
    }

    return statsMap;
  }

  // Query operations
  async getPlayerPerformances(playerId: string): Promise<PlayerPerformance[]> {
    const performances = await this.prisma.playerPerformance.findMany({
      where: { playerId },
      orderBy: { createdAt: 'desc' },
    });

    return performances.map((perf) => ({
      playerId: perf.playerId,
      matchId: perf.matchId,
      batting: perf.batting as any,
      bowling: perf.bowling as any,
      fielding: perf.fielding as any,
    }));
  }

  async getMatchesByVenue(venue: string): Promise<MatchData[]> {
    const matches = await this.prisma.match.findMany({
      where: { venue },
    });

    return matches.map((match) => ({
      matchId: match.matchId,
      date: match.date?.toISOString() ?? '',
      venue: match.venue ?? '',
      matchType: match.matchType ?? '',
      teams: match.teams as any,
      players: {},
      innings: [],
    }));
  }

  // Statistics
  async getStats() {
    const [players, matches, performances, playerStats] = await Promise.all([
      this.prisma.player.count(),
      this.prisma.match.count(),
      this.prisma.playerPerformance.count(),
      this.prisma.playerStats.count(),
    ]);

    return {
      players,
      matches,
      performances,
      playerStats,
    };
  }

  // Auction team operations
  async getTeamBudget(auctionCode: string, teamCode: string): Promise<{
    basePurseCr: Prisma.Decimal;
    retentionCostCr: Prisma.Decimal;
    purseRemainingCr: Prisma.Decimal;
  } | null> {
    // auctionCode can be either a UUID (auction ID) or a 6-char room code
    // Detect which one based on length: UUIDs are 36 chars, room codes are 6
    const isUUID = auctionCode.length > 10;

    const auction = await this.prisma.auction.findFirst({
      where: isUUID ? { id: auctionCode } : { roomCode: auctionCode },
      include: {
        teams: {
          where: { teamName: teamCode },
          select: {
            basePurseCr: true,
            retentionCostCr: true,
            purseRemainingCr: true,
          },
        },
      },
    });

    if (!auction || auction.teams.length === 0) {
      return null;
    }

    return auction.teams[0];
  }

  async close() {
    // Don't disconnect - shared pool is managed by orchestrator
    // Pool will be disconnected during orchestrator shutdown
  }
}
