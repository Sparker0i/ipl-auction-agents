#!/usr/bin/env tsx

import { AuctionAgent } from '../src/agent/agent.js';
import { loadConfig } from '../src/utils/config.js';
import { createLogger } from '../src/utils/logger.js';
import { AgentConfig, TeamCode } from '../src/types/agent.types.js';
import readline from 'readline';

/**
 * Test script for manual agent testing
 *
 * Usage:
 *   npm run test-agent
 *   npm run test-agent -- --team CSK --code ABCD12
 */

// Parse command line arguments
function parseArgs(): { team: TeamCode; code: string } {
  const args = process.argv.slice(2);

  let team: TeamCode = 'CSK';
  let code = 'TEST01';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--team' && args[i + 1]) {
      team = args[i + 1] as TeamCode;
      i++;
    } else if (args[i] === '--code' && args[i + 1]) {
      code = args[i + 1];
      i++;
    }
  }

  return { team, code };
}

// Prompt user for inputs
async function promptUser(): Promise<{ team: TeamCode; code: string }> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter auction code (default: TEST01): ', (code) => {
      rl.question('Enter team code (default: CSK): ', (team) => {
        rl.close();
        resolve({
          team: (team.toUpperCase() || 'CSK') as TeamCode,
          code: code || 'TEST01',
        });
      });
    });
  });
}

// Main test function
async function main() {
  console.log('🤖 IPL Auction Agent - Test Script\n');

  // Get config
  const config = loadConfig();

  // Get team and code
  const { team, code } = process.argv.length > 2 ? parseArgs() : await promptUser();

  console.log(`\nTest Configuration:`);
  console.log(`  Team: ${team}`);
  console.log(`  Auction Code: ${code}`);
  console.log(`  Frontend URL: ${config.auction.frontendUrl}\n`);

  // Create logger
  const logger = createLogger(team, config.logging);

  // Create agent config
  const agentConfig: AgentConfig = {
    teamCode: team,
    auctionCode: code,
    browser: config.browser,
    frontendUrl: config.auction.frontendUrl,
    bidDelayMs: config.auction.bidDelayMs,
    stateCheckIntervalMs: config.auction.stateCheckIntervalMs,
  };

  // Create agent
  const agent = new AuctionAgent(agentConfig, logger);

  // Handle graceful shutdown
  let isShuttingDown = false;

  async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\n\n🛑 Shutting down agent...');
    try {
      await agent.cleanup();
      console.log('✅ Agent shut down successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Initialize and run agent
  try {
    console.log('🚀 Starting agent...\n');
    await agent.initialize();

    console.log('\n✅ Agent running successfully');
    console.log('📊 Current State:', JSON.stringify(agent.getState(), null, 2));
    console.log('\nPress Ctrl+C to stop the agent');

    // Keep the process running
    await new Promise(() => {}); // Infinite promise
  } catch (error) {
    console.error('❌ Agent failed:', error);
    await agent.cleanup();
    process.exit(1);
  }
}

// Run the test
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
