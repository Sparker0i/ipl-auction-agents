/**
 * Player Statistics Aggregator
 */

import {
  BattingStats,
  BowlingStats,
  FieldingStats,
  PlayerPerformance,
  VenueBattingStats,
  VenueBowlingStats,
} from '../types/player.types.js';

export class StatsAggregator {
  /**
   * Aggregate batting statistics from performances
   */
  static aggregateBattingStats(
    performances: PlayerPerformance[],
    matchVenues: Map<string, string>
  ): BattingStats | null {
    const battingPerfs = performances.filter(p => p.batting);

    if (battingPerfs.length === 0) return null;

    // Overall stats
    let totalRuns = 0;
    let totalBalls = 0;
    let fours = 0;
    let sixes = 0;
    let innings = 0;
    let notOuts = 0;
    let fifties = 0;
    let hundreds = 0;
    let highestScore = 0;

    // Phase stats
    const phaseStats = {
      powerplay: { runs: 0, balls: 0, strikeRate: 0 },
      middle: { runs: 0, balls: 0, strikeRate: 0 },
      death: { runs: 0, balls: 0, strikeRate: 0 },
    };

    // Venue stats
    const venueStatsMap = new Map<string, VenueBattingStats>();

    // Recent form (last 10 innings)
    const recentRuns: number[] = [];
    const recentSRs: number[] = [];

    for (const perf of battingPerfs) {
      if (!perf.batting) continue;

      const batting = perf.batting;
      totalRuns += batting.runs;
      totalBalls += batting.balls;
      fours += batting.fours;
      sixes += batting.sixes;
      innings++;

      if (!batting.dismissal) {
        notOuts++;
      }

      if (batting.runs >= 50 && batting.runs < 100) fifties++;
      if (batting.runs >= 100) hundreds++;

      if (batting.runs > highestScore) {
        highestScore = batting.runs;
      }

      // Phase stats
      phaseStats.powerplay.runs += batting.phase.powerplay.runs;
      phaseStats.powerplay.balls += batting.phase.powerplay.balls;
      phaseStats.middle.runs += batting.phase.middle.runs;
      phaseStats.middle.balls += batting.phase.middle.balls;
      phaseStats.death.runs += batting.phase.death.runs;
      phaseStats.death.balls += batting.phase.death.balls;

      // Venue stats
      const venue = matchVenues.get(perf.matchId) || 'Unknown';
      if (!venueStatsMap.has(venue)) {
        venueStatsMap.set(venue, {
          venueName: venue,
          matches: 0,
          runs: 0,
          balls: 0,
          average: 0,
          strikeRate: 0,
          fifties: 0,
          hundreds: 0,
        });
      }

      const venueStats = venueStatsMap.get(venue)!;
      venueStats.matches++;
      venueStats.runs += batting.runs;
      venueStats.balls += batting.balls;
      if (batting.runs >= 50 && batting.runs < 100) venueStats.fifties++;
      if (batting.runs >= 100) venueStats.hundreds++;

      // Recent form (last 10)
      recentRuns.push(batting.runs);
      recentSRs.push(batting.balls > 0 ? (batting.runs / batting.balls) * 100 : 0);
    }

    // Calculate averages and strike rates
    const average = innings - notOuts > 0 ? totalRuns / (innings - notOuts) : 0;
    const strikeRate = totalBalls > 0 ? (totalRuns / totalBalls) * 100 : 0;

    phaseStats.powerplay.strikeRate = phaseStats.powerplay.balls > 0
      ? (phaseStats.powerplay.runs / phaseStats.powerplay.balls) * 100
      : 0;
    phaseStats.middle.strikeRate = phaseStats.middle.balls > 0
      ? (phaseStats.middle.runs / phaseStats.middle.balls) * 100
      : 0;
    phaseStats.death.strikeRate = phaseStats.death.balls > 0
      ? (phaseStats.death.runs / phaseStats.death.balls) * 100
      : 0;

    // Calculate venue averages and strike rates
    for (const venueStats of venueStatsMap.values()) {
      venueStats.average = venueStats.runs / venueStats.matches;
      venueStats.strikeRate = venueStats.balls > 0
        ? (venueStats.runs / venueStats.balls) * 100
        : 0;
    }

    // Recent form analysis (last 10 innings)
    const last10Runs = recentRuns.slice(-10);
    const last10SRs = recentSRs.slice(-10);

    // Calculate trend
    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (last10Runs.length >= 5) {
      const firstHalf = last10Runs.slice(0, Math.floor(last10Runs.length / 2));
      const secondHalf = last10Runs.slice(Math.floor(last10Runs.length / 2));

      const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      if (secondHalfAvg > firstHalfAvg * 1.2) {
        trend = 'improving';
      } else if (secondHalfAvg < firstHalfAvg * 0.8) {
        trend = 'declining';
      }
    }

    return {
      overall: {
        matches: battingPerfs.length,
        innings,
        runs: totalRuns,
        balls: totalBalls,
        strikeRate,
        average,
        fifties,
        hundreds,
        highestScore,
        boundaries: { fours, sixes },
      },
      byVenue: venueStatsMap,
      byPhase: phaseStats,
      recentForm: {
        runs: last10Runs,
        strikeRates: last10SRs,
        trend,
      },
    };
  }

  /**
   * Aggregate bowling statistics from performances
   */
  static aggregateBowlingStats(
    performances: PlayerPerformance[],
    matchVenues: Map<string, string>
  ): BowlingStats | null {
    const bowlingPerfs = performances.filter(p => p.bowling);

    if (bowlingPerfs.length === 0) return null;

    // Overall stats
    let totalOvers = 0;
    let totalRuns = 0;
    let totalWickets = 0;
    let bestWickets = 0;
    let bestRuns = 999;
    let fiveWicketHauls = 0;

    // Phase stats
    const phaseStats = {
      powerplay: { overs: 0, runs: 0, wickets: 0, economy: 0 },
      middle: { overs: 0, runs: 0, wickets: 0, economy: 0 },
      death: { overs: 0, runs: 0, wickets: 0, economy: 0 },
    };

    // Venue stats
    const venueStatsMap = new Map<string, VenueBowlingStats>();

    // Recent form (last 10 innings)
    const recentWickets: number[] = [];
    const recentEconomies: number[] = [];

    for (const perf of bowlingPerfs) {
      if (!perf.bowling) continue;

      const bowling = perf.bowling;
      totalOvers += bowling.overs;
      totalRuns += bowling.runs;
      totalWickets += bowling.wickets;

      // Best figures
      if (bowling.wickets > bestWickets ||
          (bowling.wickets === bestWickets && bowling.runs < bestRuns)) {
        bestWickets = bowling.wickets;
        bestRuns = bowling.runs;
      }

      if (bowling.wickets >= 5) fiveWicketHauls++;

      // Phase stats
      phaseStats.powerplay.overs += bowling.phase.powerplay.overs;
      phaseStats.powerplay.runs += bowling.phase.powerplay.runs;
      phaseStats.powerplay.wickets += bowling.phase.powerplay.wickets;
      phaseStats.middle.overs += bowling.phase.middle.overs;
      phaseStats.middle.runs += bowling.phase.middle.runs;
      phaseStats.middle.wickets += bowling.phase.middle.wickets;
      phaseStats.death.overs += bowling.phase.death.overs;
      phaseStats.death.runs += bowling.phase.death.runs;
      phaseStats.death.wickets += bowling.phase.death.wickets;

      // Venue stats
      const venue = matchVenues.get(perf.matchId) || 'Unknown';
      if (!venueStatsMap.has(venue)) {
        venueStatsMap.set(venue, {
          venueName: venue,
          matches: 0,
          overs: 0,
          wickets: 0,
          economy: 0,
          average: 0,
        });
      }

      const venueStats = venueStatsMap.get(venue)!;
      venueStats.matches++;
      venueStats.overs += bowling.overs;
      venueStats.wickets += bowling.wickets;

      // Recent form
      recentWickets.push(bowling.wickets);
      recentEconomies.push(bowling.overs > 0 ? bowling.runs / bowling.overs : 0);
    }

    // Calculate averages and rates
    const economy = totalOvers > 0 ? totalRuns / totalOvers : 0;
    const average = totalWickets > 0 ? totalRuns / totalWickets : 0;
    const strikeRate = totalWickets > 0 ? (totalOvers * 6) / totalWickets : 0;

    // Phase economies
    phaseStats.powerplay.economy = phaseStats.powerplay.overs > 0
      ? phaseStats.powerplay.runs / phaseStats.powerplay.overs
      : 0;
    phaseStats.middle.economy = phaseStats.middle.overs > 0
      ? phaseStats.middle.runs / phaseStats.middle.overs
      : 0;
    phaseStats.death.economy = phaseStats.death.overs > 0
      ? phaseStats.death.runs / phaseStats.death.overs
      : 0;

    // Venue stats
    for (const [venue, stats] of venueStatsMap) {
      stats.economy = stats.overs > 0 ? (totalRuns / stats.overs) : 0;
      stats.average = stats.wickets > 0 ? (totalRuns / stats.wickets) : 0;
    }

    // Recent form analysis
    const last10Wickets = recentWickets.slice(-10);
    const last10Economies = recentEconomies.slice(-10);

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (last10Economies.length >= 5) {
      const firstHalf = last10Economies.slice(0, Math.floor(last10Economies.length / 2));
      const secondHalf = last10Economies.slice(Math.floor(last10Economies.length / 2));

      const firstHalfAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

      // Lower economy is better
      if (secondHalfAvg < firstHalfAvg * 0.9) {
        trend = 'improving';
      } else if (secondHalfAvg > firstHalfAvg * 1.1) {
        trend = 'declining';
      }
    }

    return {
      overall: {
        matches: bowlingPerfs.length,
        innings: bowlingPerfs.length,
        overs: totalOvers,
        wickets: totalWickets,
        economy,
        average,
        strikeRate,
        bestFigures: `${bestWickets}/${bestRuns}`,
        fiveWicketHauls,
      },
      byVenue: venueStatsMap,
      byPhase: phaseStats,
      recentForm: {
        wickets: last10Wickets,
        economies: last10Economies,
        trend,
      },
    };
  }

  /**
   * Aggregate fielding statistics from performances
   */
  static aggregateFieldingStats(performances: PlayerPerformance[]): FieldingStats {
    let catches = 0;
    let runOuts = 0;
    let stumpings = 0;

    for (const perf of performances) {
      if (perf.fielding) {
        catches += perf.fielding.catches;
        runOuts += perf.fielding.runOuts;
        stumpings += perf.fielding.stumpings;
      }
    }

    return { catches, runOuts, stumpings };
  }
}
