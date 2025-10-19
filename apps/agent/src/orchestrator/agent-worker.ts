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
import { loadConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { TeamCode, AgentConfig } from '../types/agent.types.js';
import { SquadOptimizer } from '../strategy/squad-optimizer.js';

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
    // Get team strategy
    const strategy = getTeamStrategy(teamCode);

    // Initialize database and stats engine
    const db = new PrismaDatabase();
    const statsEngine = new StatsEngine(db);

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
