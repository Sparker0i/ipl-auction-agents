import { PrismaDatabase } from './prisma-database.js';
import { StatsCache } from './stats-cache.js';
import { PlayerStats } from '../types/player.types.js';
import { PlayerQuality } from '../types/strategy.types.js';

/**
 * Player statistics query engine
 * Uses shared cache to reduce database queries
 */
export class StatsEngine {
  private db: PrismaDatabase;
  private cache: StatsCache;

  constructor(db: PrismaDatabase) {
    this.db = db;
    this.cache = StatsCache.getInstance();
  }

  /**
   * Get player statistics by name (with caching)
   */
  async getPlayerStats(playerName: string): Promise<PlayerStats | null> {
    return await this.cache.getPlayerStats(playerName, async () => {
      return await this.db.getPlayerStats(playerName);
    });
  }

  /**
   * Get player statistics by ID (with caching)
   */
  async getPlayerStatsById(playerId: string): Promise<PlayerStats | null> {
    return await this.cache.getPlayerStatsById(playerId, async () => {
      return await this.db.getPlayerStats(playerId);
    });
  }

  /**
   * Batch get player stats (optimized for multiple players)
   */
  async getBatchPlayerStats(playerIds: string[]): Promise<Map<string, PlayerStats>> {
    if (playerIds.length === 0) {
      return new Map();
    }

    // Check cache first for all players
    const results = new Map<string, PlayerStats>();
    const missingPlayers: string[] = [];

    for (const playerId of playerIds) {
      const cached = await this.cache.getPlayerStatsById(playerId, async () => null);
      if (cached) {
        results.set(playerId, cached);
      } else {
        missingPlayers.push(playerId);
      }
    }

    // Batch fetch missing players from database
    if (missingPlayers.length > 0) {
      const batchStats = await this.db.getBatchPlayerStats(missingPlayers);

      // Add to cache and results
      for (const [playerId, stats] of batchStats) {
        results.set(playerId, stats);
        // Warm cache for future single queries
        await this.cache.getPlayerStatsById(playerId, async () => stats);
      }
    }

    return results;
  }

  /**
   * Evaluate player quality from statistics
   */
  async evaluatePlayerQuality(
    playerName: string,
    homeVenue?: string
  ): Promise<PlayerQuality | null> {
    const stats = await this.getPlayerStats(playerName);

    if (!stats) {
      return null;
    }

    // Calculate overall rating (0-10)
    const overall = this.calculateOverallRating(stats);

    // Calculate role-specific rating
    const roleSpecific = this.calculateRoleRating(stats);

    // Calculate venue bonus if home venue provided
    const venueBonus = homeVenue ? this.calculateVenueBonus(stats, homeVenue) : 0;

    // Determine form trend
    const formTrend = this.determineFormTrend(stats);

    // Determine experience level
    const experience = this.determineExperience(stats);

    return {
      overall,
      roleSpecific,
      venueBonus,
      formTrend,
      experience,
    };
  }

  /**
   * Calculate overall player rating (0-10)
   */
  private calculateOverallRating(stats: PlayerStats): number {
    let rating = 5.0; // Start at average

    // Batting contribution
    if (stats.battingStats) {
      const batting = stats.battingStats.overall;

      // Strike rate score (0-2 points)
      if (batting.strikeRate > 150) rating += 2;
      else if (batting.strikeRate > 130) rating += 1.5;
      else if (batting.strikeRate > 120) rating += 1;
      else if (batting.strikeRate < 100) rating -= 0.5;

      // Average score (0-1.5 points)
      if (batting.average > 35) rating += 1.5;
      else if (batting.average > 25) rating += 1;
      else if (batting.average < 20) rating -= 0.5;

      // Experience (0-0.5 points)
      if (batting.matches > 50) rating += 0.5;
      else if (batting.matches < 10) rating -= 0.3;
    }

    // Bowling contribution
    if (stats.bowlingStats) {
      const bowling = stats.bowlingStats.overall;

      // Economy score (0-2 points)
      if (bowling.economy < 7.5) rating += 2;
      else if (bowling.economy < 8.5) rating += 1.5;
      else if (bowling.economy < 9.5) rating += 1;
      else if (bowling.economy > 10.5) rating -= 0.5;

      // Average score (0-1.5 points)
      if (bowling.average < 25) rating += 1.5;
      else if (bowling.average < 30) rating += 1;
      else if (bowling.average > 35) rating -= 0.5;

      // Experience (0-0.5 points)
      if (bowling.matches > 50) rating += 0.5;
      else if (bowling.matches < 10) rating -= 0.3;
    }

    // Clamp to 0-10 range
    return Math.max(0, Math.min(10, rating));
  }

  /**
   * Calculate role-specific rating (0-10)
   */
  private calculateRoleRating(stats: PlayerStats): number {
    // Simplified role rating based on primary stats
    if (stats.battingStats && !stats.bowlingStats) {
      // Pure batter
      return this.calculateBattingRating(stats.battingStats.overall);
    } else if (stats.bowlingStats && !stats.battingStats) {
      // Pure bowler
      return this.calculateBowlingRating(stats.bowlingStats.overall);
    } else if (stats.battingStats && stats.bowlingStats) {
      // All-rounder
      const battingRating = this.calculateBattingRating(stats.battingStats.overall);
      const bowlingRating = this.calculateBowlingRating(stats.bowlingStats.overall);
      return (battingRating + bowlingRating) / 2;
    }

    return 5.0; // Default
  }

  /**
   * Calculate batting-specific rating
   */
  private calculateBattingRating(batting: any): number {
    let rating = 5.0;

    if (batting.strikeRate > 140) rating += 2.5;
    else if (batting.strikeRate > 120) rating += 1.5;

    if (batting.average > 30) rating += 2.5;
    else if (batting.average > 20) rating += 1;

    return Math.max(0, Math.min(10, rating));
  }

  /**
   * Calculate bowling-specific rating
   */
  private calculateBowlingRating(bowling: any): number {
    let rating = 5.0;

    if (bowling.economy < 7.5) rating += 2.5;
    else if (bowling.economy < 9.0) rating += 1.5;

    if (bowling.average < 25) rating += 2.5;
    else if (bowling.average < 30) rating += 1;

    return Math.max(0, Math.min(10, rating));
  }

  /**
   * Calculate venue bonus (0-1)
   */
  private calculateVenueBonus(stats: PlayerStats, homeVenue: string): number {
    // Check batting stats at venue
    if (stats.battingStats?.byVenue) {
      const venueStats = Array.from(stats.battingStats.byVenue.values()).find(
        (v) => v.venueName === homeVenue
      );

      if (venueStats && venueStats.matches >= 3) {
        // Good performance at venue
        if (venueStats.strikeRate > 130) return 0.8;
        if (venueStats.strikeRate > 115) return 0.5;
        if (venueStats.strikeRate > 100) return 0.3;
      }
    }

    // Check bowling stats at venue
    if (stats.bowlingStats?.byVenue) {
      const venueStats = Array.from(stats.bowlingStats.byVenue.values()).find(
        (v) => v.venueName === homeVenue
      );

      if (venueStats && venueStats.matches >= 3) {
        // Good performance at venue
        if (venueStats.economy < 7.5) return 0.8;
        if (venueStats.economy < 8.5) return 0.5;
        if (venueStats.economy < 9.5) return 0.3;
      }
    }

    return 0; // No significant venue bonus
  }

  /**
   * Determine form trend
   */
  private determineFormTrend(stats: PlayerStats): 'improving' | 'declining' | 'stable' {
    // Check batting recent form
    if (stats.battingStats?.recentForm) {
      const recent = stats.battingStats.recentForm;
      if (recent.trend === 'improving') return 'improving';
      if (recent.trend === 'declining') return 'declining';
    }

    // Check bowling recent form
    if (stats.bowlingStats?.recentForm) {
      const recent = stats.bowlingStats.recentForm;
      if (recent.trend === 'improving') return 'improving';
      if (recent.trend === 'declining') return 'declining';
    }

    return 'stable';
  }

  /**
   * Determine experience level
   */
  private determineExperience(stats: PlayerStats): 'high' | 'medium' | 'low' {
    let totalMatches = 0;

    if (stats.battingStats) {
      totalMatches = Math.max(totalMatches, stats.battingStats.overall.matches);
    }

    if (stats.bowlingStats) {
      totalMatches = Math.max(totalMatches, stats.bowlingStats.overall.matches);
    }

    if (totalMatches > 50) return 'high';
    if (totalMatches > 20) return 'medium';
    return 'low';
  }

  /**
   * Get quick player summary for decision making
   */
  async getPlayerSummary(playerName: string): Promise<string | null> {
    const stats = await this.getPlayerStats(playerName);

    if (!stats) {
      return null;
    }

    const parts: string[] = [];

    if (stats.battingStats) {
      const b = stats.battingStats.overall;
      parts.push(
        `Batting: ${b.matches} matches, ${b.runs} runs, avg ${b.average.toFixed(1)}, SR ${b.strikeRate.toFixed(1)}`
      );
    }

    if (stats.bowlingStats) {
      const b = stats.bowlingStats.overall;
      parts.push(
        `Bowling: ${b.wickets} wickets, avg ${b.average.toFixed(1)}, econ ${b.economy.toFixed(2)}`
      );
    }

    return parts.join('. ');
  }
}
