/**
 * YAML Match Data Parser
 */

import { parse } from 'yaml';
import { readFileSync } from 'fs';
import { MatchData, DeliveryData, PlayerPerformance } from '../types/player.types.js';

export class MatchParser {
  /**
   * Parse a match YAML file
   */
  static parseMatchFile(filePath: string): MatchData | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = parse(content);

      // Extract match metadata
      if (!data.info) {
        console.warn(`No info section in ${filePath}`);
        return null;
      }

      const matchType = data.info.match_type;
      const date = data.info.dates?.[0] || '';
      const venue = data.info.venue || '';
      const teams = data.info.teams || [];

      // Build player registry (short name -> ID mapping)
      const playerRegistry: { [shortName: string]: string } = {};
      if (data.info.registry?.people) {
        for (const [shortName, playerId] of Object.entries(data.info.registry.people)) {
          playerRegistry[shortName] = playerId as string;
        }
      }

      const matchId = filePath.split('/').pop()?.replace('.yaml', '') || '';

      return {
        matchId,
        date,
        venue,
        matchType,
        teams,
        players: playerRegistry,
        innings: data.innings || [],
      };
    } catch (error) {
      console.error(`Error parsing match file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Check if match is T20 format (T20, T20I, IT20)
   */
  static isT20Match(matchData: MatchData): boolean {
    const t20Types = ['T20', 'T20I', 'IT20'];
    const matchType = matchData.matchType.toUpperCase();
    return t20Types.includes(matchType);
  }

  /**
   * Check if match date is after 2015
   */
  static isAfter2015(matchData: MatchData): boolean {
    const matchYear = new Date(matchData.date).getFullYear();
    return matchYear >= 2015;
  }

  /**
   * Extract player performances from match
   */
  static extractPerformances(matchData: MatchData): PlayerPerformance[] {
    const performances: Map<string, PlayerPerformance> = new Map();

    // Helper to get or create performance
    const getPerf = (playerId: string): PlayerPerformance => {
      if (!performances.has(playerId)) {
        performances.set(playerId, {
          playerId,
          matchId: matchData.matchId,
        });
      }
      return performances.get(playerId)!;
    };

    // Process each innings
    for (const innings of matchData.innings) {
      const inningsData = Object.values(innings)[0] as any;

      if (!inningsData?.deliveries) continue;

      // Process deliveries
      for (const delivery of inningsData.deliveries) {
        const ballData = Object.values(delivery)[0] as any;

        if (!ballData) continue;

        const overNum = parseFloat(Object.keys(delivery)[0]);
        const batterShortName = ballData.batsman || ballData.batter;
        const bowlerShortName = ballData.bowler;
        const runs = ballData.runs || {};

        // Get player IDs
        const batterId = matchData.players[batterShortName];
        const bowlerId = matchData.players[bowlerShortName];

        if (!batterId || !bowlerId) continue;

        // Determine phase (powerplay: 0-6, middle: 6-15, death: 15-20)
        const phase = overNum < 6 ? 'powerplay' : overNum < 15 ? 'middle' : 'death';

        // Update batting performance
        const batterPerf = getPerf(batterId);
        if (!batterPerf.batting) {
          batterPerf.batting = {
            runs: 0,
            balls: 0,
            fours: 0,
            sixes: 0,
            dismissal: null,
            phase: {
              powerplay: { runs: 0, balls: 0 },
              middle: { runs: 0, balls: 0 },
              death: { runs: 0, balls: 0 },
            },
          };
        }

        batterPerf.batting.runs += runs.batter || 0;
        batterPerf.batting.balls += 1;
        batterPerf.batting.phase[phase].runs += runs.batter || 0;
        batterPerf.batting.phase[phase].balls += 1;

        // Count boundaries
        if (runs.batter === 4) batterPerf.batting.fours += 1;
        if (runs.batter === 6) batterPerf.batting.sixes += 1;

        // Check for dismissal
        if (ballData.wickets && ballData.wickets.length > 0) {
          const wicket = ballData.wickets[0];
          if (wicket.player_out === batterShortName) {
            batterPerf.batting.dismissal = wicket.kind;
          }

          // Update fielding stats
          if (wicket.kind === 'caught' && wicket.fielders) {
            for (const fielderShortName of wicket.fielders) {
              const fielderId = matchData.players[fielderShortName];
              if (fielderId) {
                const fielderPerf = getPerf(fielderId);
                if (!fielderPerf.fielding) {
                  fielderPerf.fielding = { catches: 0, runOuts: 0, stumpings: 0 };
                }
                fielderPerf.fielding.catches += 1;
              }
            }
          }

          if (wicket.kind === 'run out' && wicket.fielders) {
            for (const fielderShortName of wicket.fielders) {
              const fielderId = matchData.players[fielderShortName];
              if (fielderId) {
                const fielderPerf = getPerf(fielderId);
                if (!fielderPerf.fielding) {
                  fielderPerf.fielding = { catches: 0, runOuts: 0, stumpings: 0 };
                }
                fielderPerf.fielding.runOuts += 1;
              }
            }
          }

          if (wicket.kind === 'stumped' && wicket.fielders) {
            const stumperId = matchData.players[wicket.fielders[0]];
            if (stumperId) {
              const stumperPerf = getPerf(stumperId);
              if (!stumperPerf.fielding) {
                stumperPerf.fielding = { catches: 0, runOuts: 0, stumpings: 0 };
              }
              stumperPerf.fielding.stumpings += 1;
            }
          }
        }

        // Update bowling performance
        const bowlerPerf = getPerf(bowlerId);
        if (!bowlerPerf.bowling) {
          bowlerPerf.bowling = {
            overs: 0,
            runs: 0,
            wickets: 0,
            maidens: 0,
            wides: 0,
            noballs: 0,
            phase: {
              powerplay: { overs: 0, runs: 0, wickets: 0 },
              middle: { overs: 0, runs: 0, wickets: 0 },
              death: { overs: 0, runs: 0, wickets: 0 },
            },
          };
        }

        // Count runs (excluding wides/noballs from batter runs)
        const bowlingRuns = runs.total || 0;
        bowlerPerf.bowling.runs += bowlingRuns;
        bowlerPerf.bowling.phase[phase].runs += bowlingRuns;

        // Count extras
        if (ballData.extras) {
          if (ballData.extras.wides) {
            bowlerPerf.bowling.wides += ballData.extras.wides;
          }
          if (ballData.extras.noballs) {
            bowlerPerf.bowling.noballs += ballData.extras.noballs;
          }
        }

        // Count wickets
        if (ballData.wickets && ballData.wickets.length > 0) {
          // Only count wickets that are not run-outs
          const validWickets = ballData.wickets.filter((w: any) => w.kind !== 'run out');
          bowlerPerf.bowling.wickets += validWickets.length;
          bowlerPerf.bowling.phase[phase].wickets += validWickets.length;
        }
      }

      // Calculate overs for bowlers
      // Count balls bowled per bowler in this innings
      const bowlerBalls: Map<string, Map<string, number>> = new Map(); // bowlerId -> phase -> balls

      for (const delivery of inningsData.deliveries) {
        const ballData = Object.values(delivery)[0] as any;
        const overNum = parseFloat(Object.keys(delivery)[0]);
        const bowlerShortName = ballData?.bowler;
        const bowlerId = matchData.players[bowlerShortName];

        if (!bowlerId) continue;

        const phase = overNum < 6 ? 'powerplay' : overNum < 15 ? 'middle' : 'death';

        if (!bowlerBalls.has(bowlerId)) {
          bowlerBalls.set(bowlerId, new Map());
        }

        const phaseBalls = bowlerBalls.get(bowlerId)!;
        phaseBalls.set(phase, (phaseBalls.get(phase) || 0) + 1);
      }

      // Update overs in performances
      for (const [bowlerId, phaseBalls] of bowlerBalls) {
        const perf = performances.get(bowlerId);
        if (perf?.bowling) {
          let totalBalls = 0;
          for (const [phase, balls] of phaseBalls) {
            const overs = Math.floor(balls / 6) + (balls % 6) / 10;
            perf.bowling.phase[phase as keyof typeof perf.bowling.phase].overs += overs;
            totalBalls += balls;
          }
          perf.bowling.overs = Math.floor(totalBalls / 6) + (totalBalls % 6) / 10;
        }
      }
    }

    return Array.from(performances.values());
  }
}
