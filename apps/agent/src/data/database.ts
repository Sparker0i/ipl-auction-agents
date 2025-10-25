/**
 * SQLite Database Manager
 */

import Database from 'better-sqlite3';
import { Player, PlayerStats, PlayerPerformance, MatchData } from '../types/player.types.js';

export class PlayerDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.exec(`
      -- Players table
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT,
        role TEXT,
        is_overseas BOOLEAN,
        is_capped BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Player stats (aggregated)
      CREATE TABLE IF NOT EXISTS player_stats (
        player_id TEXT PRIMARY KEY,
        batting_stats TEXT,
        bowling_stats TEXT,
        fielding_stats TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      -- Matches table
      CREATE TABLE IF NOT EXISTS matches (
        match_id TEXT PRIMARY KEY,
        date DATE,
        venue TEXT,
        match_type TEXT,
        competition TEXT,
        teams TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Player performances (match-level)
      CREATE TABLE IF NOT EXISTS player_performances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id TEXT NOT NULL,
        player_id TEXT NOT NULL,
        player_name TEXT,
        batting TEXT,
        bowling TEXT,
        fielding TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_player_perf ON player_performances(player_id);
      CREATE INDEX IF NOT EXISTS idx_match_date ON matches(date);
      CREATE INDEX IF NOT EXISTS idx_match_venue ON matches(venue);
      CREATE INDEX IF NOT EXISTS idx_player_name ON players(name);
    `);
  }

  // Player operations
  insertPlayer(player: Player): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO players (id, name, country, role, is_overseas, is_capped)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      player.id,
      player.name,
      player.country,
      player.role,
      player.isOverseas ? 1 : 0,
      player.isCapped ? 1 : 0
    );
  }

  insertPlayers(players: Player[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO players (id, name, country, role, is_overseas, is_capped)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((players: Player[]) => {
      for (const player of players) {
        stmt.run(
          player.id,
          player.name,
          player.country,
          player.role,
          player.isOverseas ? 1 : 0,
          player.isCapped ? 1 : 0
        );
      }
    });

    insertMany(players);
  }

  getPlayer(id: string): Player | null {
    const stmt = this.db.prepare('SELECT * FROM players WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      country: row.country,
      role: row.role,
      isOverseas: Boolean(row.is_overseas),
      isCapped: Boolean(row.is_capped),
    };
  }

  getPlayerByName(name: string): Player | null {
    const stmt = this.db.prepare('SELECT * FROM players WHERE name = ? LIMIT 1');
    const row = stmt.get(name) as any;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      country: row.country,
      role: row.role,
      isOverseas: Boolean(row.is_overseas),
      isCapped: Boolean(row.is_capped),
    };
  }

  // Match operations
  insertMatch(match: MatchData): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO matches (match_id, date, venue, match_type, teams)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      match.matchId,
      match.date,
      match.venue,
      match.matchType,
      JSON.stringify(match.teams)
    );
  }

  // Performance operations
  insertPerformance(performance: PlayerPerformance): void {
    const stmt = this.db.prepare(`
      INSERT INTO player_performances (match_id, player_id, player_name, batting, bowling, fielding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      performance.matchId,
      performance.playerId,
      '', // player_name will be updated later
      performance.batting ? JSON.stringify(performance.batting) : null,
      performance.bowling ? JSON.stringify(performance.bowling) : null,
      performance.fielding ? JSON.stringify(performance.fielding) : null
    );
  }

  insertPerformances(performances: PlayerPerformance[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO player_performances (match_id, player_id, player_name, batting, bowling, fielding)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((perfs: PlayerPerformance[]) => {
      for (const perf of perfs) {
        stmt.run(
          perf.matchId,
          perf.playerId,
          '',
          perf.batting ? JSON.stringify(perf.batting) : null,
          perf.bowling ? JSON.stringify(perf.bowling) : null,
          perf.fielding ? JSON.stringify(perf.fielding) : null
        );
      }
    });

    insertMany(performances);
  }

  // Stats operations
  upsertPlayerStats(playerId: string, stats: Partial<PlayerStats>): void {
    const stmt = this.db.prepare(`
      INSERT INTO player_stats (player_id, batting_stats, bowling_stats, fielding_stats, last_updated)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(player_id) DO UPDATE SET
        batting_stats = excluded.batting_stats,
        bowling_stats = excluded.bowling_stats,
        fielding_stats = excluded.fielding_stats,
        last_updated = CURRENT_TIMESTAMP
    `);

    stmt.run(
      playerId,
      stats.battingStats ? JSON.stringify(stats.battingStats) : null,
      stats.bowlingStats ? JSON.stringify(stats.bowlingStats) : null,
      stats.fieldingStats ? JSON.stringify(stats.fieldingStats) : null
    );
  }

  getPlayerStats(playerId: string): PlayerStats | null {
    const stmt = this.db.prepare('SELECT * FROM player_stats WHERE player_id = ?');
    const row = stmt.get(playerId) as any;

    if (!row) return null;

    return {
      playerId: row.player_id,
      battingStats: row.batting_stats ? JSON.parse(row.batting_stats) : null,
      bowlingStats: row.bowling_stats ? JSON.parse(row.bowling_stats) : null,
      fieldingStats: row.fielding_stats ? JSON.parse(row.fielding_stats) : null,
      lastUpdated: new Date(row.last_updated),
    };
  }

  // Query operations
  getPlayerPerformances(playerId: string): PlayerPerformance[] {
    const stmt = this.db.prepare(`
      SELECT * FROM player_performances WHERE player_id = ? ORDER BY created_at DESC
    `);

    const rows = stmt.all(playerId) as any[];

    return rows.map(row => ({
      playerId: row.player_id,
      matchId: row.match_id,
      batting: row.batting ? JSON.parse(row.batting) : undefined,
      bowling: row.bowling ? JSON.parse(row.bowling) : undefined,
      fielding: row.fielding ? JSON.parse(row.fielding) : undefined,
    }));
  }

  getMatchesByVenue(venue: string): MatchData[] {
    const stmt = this.db.prepare('SELECT * FROM matches WHERE venue = ?');
    const rows = stmt.all(venue) as any[];

    return rows.map(row => ({
      matchId: row.match_id,
      date: row.date,
      venue: row.venue,
      matchType: row.match_type,
      teams: JSON.parse(row.teams),
      players: {},
      innings: [],
    }));
  }

  // Statistics
  getStats() {
    const playerCount = this.db.prepare('SELECT COUNT(*) as count FROM players').get() as any;
    const matchCount = this.db.prepare('SELECT COUNT(*) as count FROM matches').get() as any;
    const perfCount = this.db.prepare('SELECT COUNT(*) as count FROM player_performances').get() as any;
    const statsCount = this.db.prepare('SELECT COUNT(*) as count FROM player_stats').get() as any;

    return {
      players: playerCount.count,
      matches: matchCount.count,
      performances: perfCount.count,
      playerStats: statsCount.count,
    };
  }

  close() {
    this.db.close();
  }
}
