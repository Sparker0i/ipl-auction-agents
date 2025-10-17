import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const prisma = new PrismaClient();

interface CSVRow {
  'List Sr.No.': string;
  'Set No.': string;
  '2025 Set': string;
  Name: string;
  Country: string;
  Age: string;
  Specialism: string;
  '2024 Team': string;
  '2024 IPL': string;
  'C/U/A': string;
  'Reserve Price Rs Lakh': string;
}

function mapRole(specialism: string): string {
  const spec = specialism.toUpperCase();
  if (spec.includes('BATTER')) return 'BATTER';
  if (spec.includes('BOWLER')) return 'BOWLER';
  if (spec.includes('WICKETKEEPER')) return 'WICKETKEEPER';
  if (spec.includes('ALL-ROUNDER')) return 'ALL-ROUNDER';

  // Fallback: check for bowling types
  if (spec.includes('FAST') || spec.includes('MEDIUM') || spec.includes('SLOW') || spec.includes('SPIN') || spec.includes('LEG') || spec.includes('OFF')) {
    return 'BOWLER';
  }

  return 'BATTER'; // Default
}

function isOverseas(country: string): boolean {
  return country.toUpperCase() !== 'INDIA';
}

function isCappedPlayer(cappedStatus: string): boolean {
  return cappedStatus.toUpperCase() === 'CAPPED';
}

async function seed() {
  console.log('🌱 Starting seed process...');

  // Read and parse CSV
  const csvPath = path.join(__dirname, '../../../auction.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`📄 Found ${records.length} records in CSV`);

  // Clear existing players
  await prisma.player.deleteMany({});
  console.log('🗑️  Cleared existing players');

  let inserted = 0;
  let skipped = 0;

  for (const row of records) {
    try {
      // Skip header or empty rows
      if (!row.Name || row.Name === 'Name') {
        skipped++;
        continue;
      }

      const name = row.Name.trim();
      const country = row.Country.trim();
      const age = row.Age ? parseInt(row.Age) : null;

      // Determine role from Specialism column
      const specialism = row.Specialism ? row.Specialism.trim() : '';
      const role = mapRole(specialism);

      // Auction set - for retained players, set as 'Retained'
      const auctionSet = row['2025 Set'].trim() || 'Unknown';

      // Base price
      const basePriceLakh = parseInt(row['Reserve Price Rs Lakh']) || 0;

      // Capped status
      const cappedStatus = row['C/U/A'].trim();
      const isCapped = isCappedPlayer(cappedStatus);

      // IPL 2024 team
      const iplTeam2024 = row['2024 Team'].trim() || null;

      // IPL matches
      const iplMatches = row['2024 IPL'] ? parseInt(row['2024 IPL']) : null;

      // Overseas status
      const overseas = isOverseas(country);

      await prisma.player.create({
        data: {
          name,
          country,
          age,
          role,
          specialism: specialism || null,
          basePriceLakh,
          auctionSet,
          isCapped,
          isOverseas: overseas,
          iplTeam2024,
          iplMatches,
        },
      });

      inserted++;

      if (inserted % 50 === 0) {
        console.log(`✅ Inserted ${inserted} players...`);
      }
    } catch (error) {
      console.error(`❌ Error inserting player ${row.Name}:`, error);
      skipped++;
    }
  }

  console.log(`\n🎉 Seed completed!`);
  console.log(`   ✅ Inserted: ${inserted} players`);
  console.log(`   ⏭️  Skipped: ${skipped} records`);

  // Print some statistics
  const totalPlayers = await prisma.player.count();
  const cappedCount = await prisma.player.count({ where: { isCapped: true } });
  const uncappedCount = await prisma.player.count({ where: { isCapped: false } });
  const overseasCount = await prisma.player.count({ where: { isOverseas: true } });
  const retainedCount = await prisma.player.count({ where: { auctionSet: 'Retained' } });

  console.log(`\n📊 Database Statistics:`);
  console.log(`   Total Players: ${totalPlayers}`);
  console.log(`   Capped: ${cappedCount}`);
  console.log(`   Uncapped: ${uncappedCount}`);
  console.log(`   Overseas: ${overseasCount}`);
  console.log(`   Retained: ${retainedCount}`);
  console.log(`   Available for Auction: ${totalPlayers - retainedCount}`);
}

seed()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
