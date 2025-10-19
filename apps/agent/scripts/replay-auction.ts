#!/usr/bin/env tsx
/**
 * Auction Replay CLI Script
 * Reconstructs auction from logs and generates reports
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuctionReplay } from '../src/monitoring/auction-replay.js';

const LOGS_DIR = path.join(process.cwd(), 'logs');
const REPORTS_DIR = path.join(process.cwd(), 'reports');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npm run replay <auction-code> [--html]');
    console.log('');
    console.log('Options:');
    console.log('  --html    Generate HTML report instead of markdown');
    console.log('');
    console.log('Example:');
    console.log('  npm run replay ABCD12');
    console.log('  npm run replay ABCD12 --html');
    process.exit(1);
  }

  const auctionCode = args[0];
  const format = args.includes('--html') ? 'html' : 'markdown';

  console.log(`🔍 Reconstructing auction: ${auctionCode}`);
  console.log(`📂 Logs directory: ${LOGS_DIR}`);

  // Create replay instance
  const replay = new AuctionReplay(LOGS_DIR);

  try {
    // Reconstruct timeline
    console.log('📊 Parsing log files...');
    const timeline = await replay.reconstructAuction(auctionCode);

    console.log(`✅ Found ${timeline.players.length} players`);
    console.log(`✅ Duration: ${formatDuration(timeline.startTime, timeline.endTime)}`);

    // Generate report
    console.log(`📝 Generating ${format} report...`);

    const report =
      format === 'html'
        ? replay.generateHTMLReplay(timeline)
        : replay.generateReport(timeline);

    // Create reports directory
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    // Save report
    const extension = format === 'html' ? 'html' : 'md';
    const filename = `auction-replay-${auctionCode}.${extension}`;
    const filepath = path.join(REPORTS_DIR, filename);

    fs.writeFileSync(filepath, report, 'utf-8');

    console.log(`✅ Report saved: ${filepath}`);

    // Print summary
    console.log('');
    console.log('📊 Auction Summary:');
    console.log(`   Players sold: ${timeline.players.length}`);

    const sortedTeams = Array.from(timeline.teamStats.values()).sort(
      (a, b) => b.totalSpent - a.totalSpent
    );

    console.log('');
    console.log('   Top Spenders:');
    for (let i = 0; i < Math.min(3, sortedTeams.length); i++) {
      const team = sortedTeams[i];
      console.log(
        `   ${i + 1}. ${team.teamCode}: ₹${team.totalSpent}L (${team.playersWon} players)`
      );
    }

    if (format === 'html') {
      console.log('');
      console.log('💡 Open the HTML file in your browser to view the interactive replay');
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function formatDuration(start: Date, end: Date): string {
  const durationMs = end.getTime() - start.getTime();
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

main();
