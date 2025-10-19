/**
 * Prisma Database Manager for PostgreSQL
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Player, PlayerStats, PlayerPerformance, MatchData } from '../types/player.types.js';

export class PrismaDatabase {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient({
      log: ['error', 'warn'],
    });
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
      role: player.role ?? undefined,
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
      role: player.role ?? undefined,
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
        teams: match.teams as Prisma.JsonValue,
      },
      create: {
        matchId: match.matchId,
        date: match.date ? new Date(match.date) : null,
        venue: match.venue,
        matchType: match.matchType,
        teams: match.teams as Prisma.JsonValue,
      },
    });
  }

  // Performance operations
  async insertPerformance(performance: PlayerPerformance): Promise<void> {
    try {
      await this.prisma.playerPerformance.create({
        data: {
          playerName: '',
          batting: performance.batting as Prisma.JsonValue,
          bowling: performance.bowling as Prisma.JsonValue,
          fielding: performance.fielding as Prisma.JsonValue,
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
        battingStats: stats.batting as Prisma.JsonValue,
        bowlingStats: stats.bowling as Prisma.JsonValue,
        fieldingStats: stats.fielding as Prisma.JsonValue,
      },
      create: {
        playerId,
        battingStats: stats.batting as Prisma.JsonValue,
        bowlingStats: stats.bowling as Prisma.JsonValue,
        fieldingStats: stats.fielding as Prisma.JsonValue,
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
      batting: stats.battingStats as any,
      bowling: stats.bowlingStats as any,
      fielding: stats.fieldingStats as any,
      lastUpdated: stats.lastUpdated,
    };
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

  async close() {
    await this.prisma.$disconnect();
  }
}
