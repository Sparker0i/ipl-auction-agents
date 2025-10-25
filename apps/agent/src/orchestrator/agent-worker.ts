#!/usr/bin/env node
/**
 * Agent worker process
 * This script runs as a separate process for each agent
 */

import { AuctionAgent } from '../agent/agent.js';
import { getTeamStrategy } from '../strategy/team-strategies.js';
import { DecisionEngine } from '../strategy/decision-engine.js';
import { StatsEngine } from '../data/stats-engine.js';
import { PrismaDatabase } from '../data/prisma-database.js';
import { DatabasePool } from '../data/database-pool.js';
import { StatsCache } from '../data/stats-cache.js';
import { loadConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { TeamCode, AgentConfig } from '../types/agent.types.js';
// Unused: import { SquadOptimizer } from '../strategy/squad-optimizer.js';

// Get team code and auction code from environment
const teamCode = (process.env.TEAM_CODE as TeamCode) || 'CSK';
const auctionCode = process.env.AUCTION_CODE || 'TEST01';

// Heartbeat interval (every 30 seconds - optimized for performance)
const HEARTBEAT_INTERVAL = 30000;

let heartbeatTimer: NodeJS.Timeout | null = null;
let agent: AuctionAgent | null = null;

/**
 * Send heartbeat to parent process
 */
function sendHeartbeat() {
  if (process.send) {
    process.send({
      type: 'heartbeat',
      data: {
        timestamp: new Date().toISOString(),
        status: agent?.getState().status || 'unknown',
      },
    });
  }
}

/**
 * Start heartbeat
 */
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    sendHeartbeat();
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop heartbeat
 */
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Main agent worker function
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(teamCode, config.logging);

  logger.info('Agent worker starting', { teamCode, auctionCode });

  try {
    // Initialize database pool for this worker process
    // Note: Each agent worker is a separate process, so each has its own pool instance
    // The singleton ensures only one connection per worker process
    const dbPool = DatabasePool.getInstance();
    await dbPool.initialize(logger);
    logger.info('Database pool initialized in worker process');

    // Initialize stats cache for this worker process
    const statsCache = StatsCache.getInstance();
    statsCache.initialize(logger);
    logger.info('Stats cache initialized in worker process');

    // Get team strategy
    const strategy = getTeamStrategy(teamCode);

    // Initialize database and stats engine
    const db = new PrismaDatabase();
    const statsEngine = new StatsEngine(db);

    // CRITICAL: Fetch team's actual budget from database
    logger.info('Fetching team budget from database', { teamCode, auctionCode });
    const teamBudget = await db.getTeamBudget(auctionCode, teamCode);
    if (!teamBudget) {
      throw new Error(`Team budget not found for ${teamCode} in auction ${auctionCode}`);
    }
    logger.info('Team budget fetched', {
      teamCode,
      basePurseCr: teamBudget.basePurseCr,
      retentionCostCr: teamBudget.retentionCostCr,
      purseRemainingCr: teamBudget.purseRemainingCr,
    });

    // Create decision engine
    const decisionEngine = new DecisionEngine(
      strategy,
      statsEngine,
      config.llm,
      logger
    );

    // Warmup LLM model
    logger.info('Warming up LLM model');
    await decisionEngine.warmup();

    // Create agent config
    const agentConfig: AgentConfig = {
      teamCode,
      auctionCode,
      browser: config.browser,
      frontendUrl: config.auction.frontendUrl,
      bidDelayMs: config.auction.bidDelayMs,
      stateCheckIntervalMs: config.auction.stateCheckIntervalMs,
      initialBudgetLakh: Math.floor(Number(teamBudget.purseRemainingCr) * 100), // Convert cr to lakhs
    };

    // Create and initialize agent with AI decision engine
    agent = new AuctionAgent(agentConfig, logger, decisionEngine, strategy);

    // Start heartbeat
    startHeartbeat();

    // Send ready message
    if (process.send) {
      process.send({ type: 'ready' });
    }

    // Initialize and run agent
    await agent.initialize();

    logger.info('Agent initialized and running', { teamCode });

    // Keep process alive
    await new Promise(() => {}); // Infinite promise
  } catch (error) {
    logger.error('Agent worker error', { error });

    if (process.send) {
      process.send({
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    process.exit(1);
  }
}

/**
 * Handle shutdown signal
 */
async function shutdown() {
  console.log('Agent worker shutting down', { teamCode });

  stopHeartbeat();

  if (agent) {
    try {
      await agent.cleanup();
    } catch (error) {
      console.error('Error during cleanup', error);
    }
  }

  // Disconnect database pool
  try {
    const dbPool = DatabasePool.getInstance();
    await dbPool.disconnect();
    console.log('Database pool disconnected in worker');
  } catch (error) {
    console.error('Error disconnecting database pool', error);
  }

  process.exit(0);
}

// Handle messages from parent
process.on('message', (message: any) => {
  if (message && message.type === 'shutdown') {
    shutdown();
  }
});

// Handle process signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in agent worker', error);
  if (process.send) {
    process.send({ type: 'error', error: error.message });
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in agent worker', reason);
  if (process.send) {
    process.send({ type: 'error', error: String(reason) });
  }
  process.exit(1);
});

// Start the worker
main().catch((error) => {
  console.error('Fatal error in agent worker', error);
  process.exit(1);
});
