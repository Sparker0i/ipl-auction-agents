#!/usr/bin/env tsx
/**
 * Match Data Processing Script
 *
 * Processes T20 match data from YAML files and builds player statistics database
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { PrismaDatabase } from '../src/data/prisma-database.js';
import { MatchParser } from '../src/data/match-parser.js';
import { StatsAggregator } from '../src/data/stats-aggregator.js';
import { Player, AuctionPlayer } from '../src/types/player.types.js';

// Configuration
const MATCH_DATA_DIR = process.env.MATCH_DATA_DIR || '../../data/matchdata/all';
const NAMES_CSV_PATH = process.env.NAMES_CSV_PATH || '../../data/players/names.csv';
const PLAYERS_CSV_PATH = process.env.PLAYERS_CSV_PATH || '../../data/players/people.csv';
const AUCTION_CSV_PATH = process.env.AUCTION_CSV_PATH || '../../auction.csv';
const MIN_YEAR = parseInt(process.env.MIN_YEAR || '2015');

console.log('🏏 IPL Auction Agent - Match Data Processor\n');
console.log('Configuration:');
console.log(`  Match Data: ${MATCH_DATA_DIR}`);
console.log(`  Names CSV: ${NAMES_CSV_PATH}`);
console.log(`  Players CSV: ${PLAYERS_CSV_PATH}`);
console.log(`  Auction CSV: ${AUCTION_CSV_PATH}`);
console.log(`  Database: PostgreSQL (Prisma)`);
console.log(`  Min Year: ${MIN_YEAR}\n`);

// Step 1: Load player name mappings from names.csv (name variations -> ID)
console.log('📋 Step 1: Loading player name mappings...');

// Map: Player Name (lowercase) -> Player ID
const nameToIdMap = new Map<string, string>();
// Map: Player ID -> Primary Name
const idToNameMap = new Map<string, string>();

try {
  // First, load names.csv for name variations
  const namesContent = readFileSync(NAMES_CSV_PATH, 'utf-8');
  const namesRecords = parse(namesContent, {
    columns: true,
    skip_empty_lines: true,
  });

  for (const record of namesRecords) {
    const playerId = record.identifier;
    const playerName = record.name;

    // Map each name variation to the player ID
    nameToIdMap.set(playerName.toLowerCase(), playerId);

    // Keep the first name as primary (or update if it's longer/more complete)
    if (!idToNameMap.has(playerId) || playerName.length > (idToNameMap.get(playerId)?.length || 0)) {
      idToNameMap.set(playerId, playerName);
    }
  }

  console.log(`  ✅ Loaded ${nameToIdMap.size} name variations for ${idToNameMap.size} players from names.csv`);

  // Then, load people.csv as fallback for players not in names.csv
  const peopleContent = readFileSync(PLAYERS_CSV_PATH, 'utf-8');
  const peopleRecords = parse(peopleContent, {
    columns: true,
    skip_empty_lines: true,
  });

  let fallbackCount = 0;
  for (const record of peopleRecords) {
    const playerId = record.identifier;
    const playerName = record.name || record.unique_name;

    if (!idToNameMap.has(playerId)) {
      nameToIdMap.set(playerName.toLowerCase(), playerId);
      idToNameMap.set(playerId, playerName);
      fallbackCount++;
    }
  }

  console.log(`  ✅ Added ${fallbackCount} additional players from people.csv`);
  console.log(`  ✅ Total: ${idToNameMap.size} unique players\n`);
} catch (error) {
  console.error('  ❌ Error loading player mappings:', error);
  process.exit(1);
}

// Create playerMappings for backward compatibility
interface PlayerMapping {
  identifier: string;
  name: string;
  uniqueName: string;
}

const playerMappings = new Map<string, PlayerMapping>();
for (const [playerId, playerName] of idToNameMap) {
  playerMappings.set(playerId, {
    identifier: playerId,
    name: playerName,
    uniqueName: playerName,
  });
}

// Step 2: Load auction players
console.log('📋 Step 2: Loading auction players...');

interface AuctionPlayerCSV {
  Name: string;
  Country: string;
  Specialism: string;
  'Reserve Price Rs Lakh': string;
  '2025 Set': string;
  'C/U/A': string;
  '2024 Team': string;
}

const auctionPlayers = new Map<string, AuctionPlayer>();

try {
  const csvContent = readFileSync(AUCTION_CSV_PATH, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as AuctionPlayerCSV[];

  for (const record of records) {
    if (!record.Name || record.Name === 'Name') continue;

    // Determine role from specialism
    let role: 'BATTER' | 'BOWLER' | 'ALL-ROUNDER' | 'WICKETKEEPER' = 'BATTER';

    const specialism = record.Specialism?.toLowerCase() || '';
    if (specialism.includes('wicket')) {
      role = 'WICKETKEEPER';
    } else if (specialism.includes('all-round')) {
      role = 'ALL-ROUNDER';
    } else if (specialism.includes('bowl') || specialism.includes('spin') || specialism.includes('fast')) {
      role = 'BOWLER';
    }

    // Find player ID from mapping with advanced matching
    let playerId = '';
    const normalizedName = record.Name.toLowerCase().trim();
    const nameParts = normalizedName.split(/\s+/);
    const lastName = nameParts[nameParts.length - 1];

    // Strategy 0: Direct lookup in nameToIdMap (from names.csv)
    if (nameToIdMap.has(normalizedName)) {
      playerId = nameToIdMap.get(normalizedName)!;
    }

    // Helper function to calculate string similarity (Levenshtein distance)
    function similarity(s1: string, s2: string): number {
      const len1 = s1.length, len2 = s2.length;
      const matrix: number[][] = [];

      for (let i = 0; i <= len1; i++) matrix[i] = [i];
      for (let j = 0; j <= len2; j++) matrix[0][j] = j;

      for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
          if (s1[i - 1] === s2[j - 1]) {
            matrix[i][j] = matrix[i - 1][j - 1];
          } else {
            matrix[i][j] = Math.min(
              matrix[i - 1][j - 1] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j] + 1
            );
          }
        }
      }

      return 1 - matrix[len1][len2] / Math.max(len1, len2);
    }

    // Strategy 1: Exact match
    for (const [id, mapping] of playerMappings) {
      if (mapping.name.toLowerCase() === normalizedName ||
          mapping.uniqueName.toLowerCase() === normalizedName) {
        playerId = id;
        break;
      }
    }

    // Strategy 2: All initials + last name (handles "Andrew J Tye" → "AJ Tye")
    if (!playerId && nameParts.length >= 2) {
      const initials = nameParts.slice(0, -1).map(p => p[0]).join('');
      const initialsName = `${initials} ${lastName}`;

      for (const [id, mapping] of playerMappings) {
        const mappingName = mapping.name.toLowerCase();
        if (mappingName === initialsName || mapping.uniqueName.toLowerCase() === initialsName) {
          playerId = id;
          break;
        }
      }
    }

    // Strategy 3: First initial + last name (handles "Virat Kohli" → "V Kohli")
    if (!playerId && nameParts.length >= 2) {
      const firstInitial = nameParts[0][0];
      const shortName = `${firstInitial} ${lastName}`;

      for (const [id, mapping] of playerMappings) {
        const mappingName = mapping.name.toLowerCase();
        if (mappingName === shortName || mapping.uniqueName.toLowerCase() === shortName) {
          playerId = id;
          break;
        }
      }
    }

    // Strategy 4: Fuzzy last name matching with spelling variations (handles "Klassen" vs "Klaasen")
    if (!playerId && lastName.length > 4) {
      let bestMatch = { id: '', similarity: 0 };

      for (const [id, mapping] of playerMappings) {
        const mappingParts = mapping.name.toLowerCase().split(/\s+/);
        const mappingLastName = mappingParts[mappingParts.length - 1];

        // Only consider if mapping has at least 2 parts (avoid matching single-name players)
        if (mappingParts.length >= 2) {
          const sim = similarity(lastName, mappingLastName);

          // If last names are very similar (>85% match) and first initials match
          if (sim > 0.85 && sim > bestMatch.similarity) {
            const firstInitialsMatch = mappingParts[0][0] === nameParts[0][0];
            if (firstInitialsMatch) {
              bestMatch = { id, similarity: sim };
            }
          }
        }
      }

      if (bestMatch.similarity > 0.85) {
        playerId = bestMatch.id;
      }
    }

    // Strategy 5: Last name match with initial prefix (handles "Shreyas Iyer" → "SS Iyer")
    if (!playerId && nameParts.length >= 2) {
      const firstInitial = nameParts[0][0];

      for (const [id, mapping] of playerMappings) {
        const mappingParts = mapping.name.toLowerCase().split(/\s+/);
        const mappingLastName = mappingParts[mappingParts.length - 1];

        // Check if last names match exactly
        if (mappingLastName === lastName && mappingParts.length >= 2) {
          const mappingFirstPart = mappingParts[0];

          // Only match if mapping first part is ALL UPPERCASE initials (<=3 chars, all caps)
          // Check the ORIGINAL (non-lowercased) name from mapping
          const originalFirstPart = mapping.name.split(/\s+/)[0];
          const isAllInitials = originalFirstPart.length <= 3 && originalFirstPart === originalFirstPart.toUpperCase();

          if (isAllInitials && mappingFirstPart.startsWith(firstInitial)) {
            playerId = id;
            break;
          }
        }
      }
    }

    // Strategy 6: Reversed name order (handles "KM Asif" vs "Asif K M")
    if (!playerId && nameParts.length >= 2) {
      // Try reversing the name parts
      const reversedName = [...nameParts].reverse().join(' ');

      for (const [id, mapping] of playerMappings) {
        const mappingName = mapping.name.toLowerCase();
        if (mappingName === reversedName || mapping.uniqueName.toLowerCase() === reversedName) {
          playerId = id;
          break;
        }
      }
    }

    if (!playerId) {
      // Generate ID from name if not found
      playerId = record.Name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    }

    const country = record.Country || 'Unknown';
    const isOverseas = country !== 'India';
    const isCapped = record['C/U/A'] === 'Capped';

    auctionPlayers.set(record.Name, {
      id: playerId,
      name: record.Name,
      country,
      role,
      basePriceLakh: parseInt(record['Reserve Price Rs Lakh']) || 30,
      auctionSet: record['2025 Set'] || '',
      isCapped,
      isOverseas,
      iplTeam2024: record['2024 Team'] || undefined,
    });
  }

  console.log(`  ✅ Loaded ${auctionPlayers.size} auction players\n`);
} catch (error) {
  console.error('  ❌ Error loading auction players:', error);
  process.exit(1);
}

// Main async function
async function main() {
  // Step 3: Initialize database
  console.log('💾 Step 3: Initializing database...');

  // Initialize DatabasePool with a simple console logger
  const { DatabasePool } = await import('../src/data/database-pool.js');
  const winston = await import('winston');

  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.simple(),
    transports: [new winston.transports.Console()],
  });

  const dbPool = DatabasePool.getInstance();
  await dbPool.initialize(logger);

  const db = new PrismaDatabase();
  console.log('  ✅ Database initialized\n');

// Step 4: Process match files
console.log('📊 Step 4: Processing match files...');

const matchFiles = readdirSync(MATCH_DATA_DIR).filter(f => f.endsWith('.yaml'));
console.log(`  Found ${matchFiles.length} match files\n`);

let processedMatches = 0;
let t20Matches = 0;
let validMatches = 0;
let totalPerformances = 0;

const matchVenues = new Map<string, string>(); // matchId -> venue

console.log('  Processing matches...');

for (const file of matchFiles) {
  const filePath = join(MATCH_DATA_DIR, file);

  try {
    const matchData = MatchParser.parseMatchFile(filePath);

    if (!matchData) continue;

    processedMatches++;

    // Filter: T20 matches only
    if (!MatchParser.isT20Match(matchData)) continue;
    t20Matches++;

    // Filter: 2015 onwards
    if (!MatchParser.isAfter2015(matchData)) continue;
    validMatches++;

    // Store match
    await db.insertMatch(matchData);
    matchVenues.set(matchData.matchId, matchData.venue);

    // Extract performances
    const performances = MatchParser.extractPerformances(matchData);

    // Map short names to full names and insert
    for (const perf of performances) {
      const mapping = playerMappings.get(perf.playerId);

      if (mapping) {
        // Use mapped name
        const player: Player = {
          id: perf.playerId,
          name: mapping.name,
          country: '', // Will be filled from auction data
          role: 'BATTER', // Will be filled from auction data
          isOverseas: false,
          isCapped: false,
        };

        await db.insertPlayer(player);
        await db.insertPerformance(perf);
        totalPerformances++;
      }
      // Skip performances for unmapped players
    }

    if (validMatches % 100 === 0) {
      process.stdout.write(`\r  Processed: ${validMatches} valid T20 matches`);
    }
  } catch (error) {
    console.error(`\n  ⚠️  Error processing ${file}:`, error);
  }
}

console.log(`\n  ✅ Processed ${processedMatches} total matches`);
console.log(`  ✅ Found ${t20Matches} T20 matches`);
console.log(`  ✅ Filtered ${validMatches} matches from ${MIN_YEAR}+`);
console.log(`  ✅ Extracted ${totalPerformances} player performances\n`);

// Step 5: Update players from auction data
console.log('📋 Step 5: Updating player information from auction data...');

let updatedPlayers = 0;
let insertedPlayers = 0;

for (const [name, auctionPlayer] of auctionPlayers) {
  // Check if player exists
  const existing = await db.getPlayer(auctionPlayer.id);

  if (existing) {
    // Update existing player with auction data
    await db.insertPlayer({
      id: auctionPlayer.id,
      name: auctionPlayer.name,
      country: auctionPlayer.country,
      role: auctionPlayer.role,
      isOverseas: auctionPlayer.isOverseas,
      isCapped: auctionPlayer.isCapped,
    });
    updatedPlayers++;
  } else {
    // Insert new auction player (no match data available)
    await db.insertPlayer({
      id: auctionPlayer.id,
      name: auctionPlayer.name,
      country: auctionPlayer.country,
      role: auctionPlayer.role,
      isOverseas: auctionPlayer.isOverseas,
      isCapped: auctionPlayer.isCapped,
    });
    insertedPlayers++;
  }
}

console.log(`  ✅ Updated ${updatedPlayers} existing players`);
console.log(`  ✅ Inserted ${insertedPlayers} new auction players\n`);

// Step 6: Aggregate statistics
console.log('📈 Step 6: Aggregating player statistics...');

const playerIds = new Set<string>();

// Get all unique player IDs
for (const [_, auctionPlayer] of auctionPlayers) {
  playerIds.add(auctionPlayer.id);
}

console.log(`  Processing stats for ${playerIds.size} players...\n`);

let statsGenerated = 0;
let playersWithBatting = 0;
let playersWithBowling = 0;

for (const playerId of playerIds) {
  const performances = await db.getPlayerPerformances(playerId);

  if (performances.length === 0) {
    // No performance data for this player
    continue;
  }

  // Aggregate stats
  const battingStats = StatsAggregator.aggregateBattingStats(performances, matchVenues);
  const bowlingStats = StatsAggregator.aggregateBowlingStats(performances, matchVenues);
  const fieldingStats = StatsAggregator.aggregateFieldingStats(performances);

  if (battingStats) playersWithBatting++;
  if (bowlingStats) playersWithBowling++;

  // Store in database
  await db.upsertPlayerStats(playerId, {
    playerId,
    batting: battingStats,
    bowling: bowlingStats,
    fielding: fieldingStats,
    lastUpdated: new Date(),
  });

  statsGenerated++;

  if (statsGenerated % 50 === 0) {
    process.stdout.write(`\r  Generated stats: ${statsGenerated}/${playerIds.size} players`);
  }
}

console.log(`\n  ✅ Generated stats for ${statsGenerated} players`);
console.log(`  ✅ Players with batting stats: ${playersWithBatting}`);
console.log(`  ✅ Players with bowling stats: ${playersWithBowling}\n`);

// Step 7: Generate report
console.log('📊 Step 7: Final Statistics\n');

const dbStats = await db.getStats();

console.log('Database Summary:');
console.log(`  Total Players: ${dbStats.players}`);
console.log(`  Total Matches: ${dbStats.matches}`);
console.log(`  Total Performances: ${dbStats.performances}`);
console.log(`  Players with Stats: ${dbStats.playerStats}`);

// Identify missing players
console.log('\n🔍 Missing Player Data:\n');

let missingCount = 0;
const missingPlayers: string[] = [];

for (const [name, auctionPlayer] of auctionPlayers) {
  const stats = await db.getPlayerStats(auctionPlayer.id);

  if (!stats) {
    missingCount++;
    missingPlayers.push(name);
  }
}

if (missingCount > 0) {
  console.log(`  ⚠️  ${missingCount} auction players have no T20 data:`);
  missingPlayers.slice(0, 10).forEach(name => {
    console.log(`    - ${name}`);
  });

  if (missingPlayers.length > 10) {
    console.log(`    ... and ${missingPlayers.length - 10} more`);
  }
} else {
  console.log('  ✅ All auction players have T20 data!');
}

const coveragePercent = ((auctionPlayers.size - missingCount) / auctionPlayers.size * 100).toFixed(1);
console.log(`\n  Data Coverage: ${coveragePercent}% of auction players\n`);

  // Close database
  await db.close();

  // Disconnect DatabasePool
  await dbPool.disconnect();

  console.log('✅ Data processing complete!\n');
  console.log('Database: PostgreSQL with Prisma');
}

// Run the main function
main()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
