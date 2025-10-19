#!/usr/bin/env tsx
/**
 * Quick test to see actual AI decision error
 */

import { DecisionEngine } from './src/strategy/decision-engine.js';
import { StatsEngine } from './src/data/stats-engine.js';
import { PrismaDatabase } from './src/data/prisma-database.js';
import { getTeamStrategy } from './src/strategy/team-strategies.js';
import { createLogger } from './src/utils/logger.js';
import { loadConfig } from './src/utils/config.js';
import type { PlayerInAuction, PlayerRole } from './src/types/agent.types.js';
import type { SquadAnalysis, BudgetPhase } from './src/types/strategy.types.js';

async function testDecision() {
  const config = loadConfig();
  const logger = createLogger('test', config.logging);

  // Setup
  const strategy = getTeamStrategy('PBKS');
  const db = new PrismaDatabase();
  const statsEngine = new StatsEngine(db);
  const decisionEngine = new DecisionEngine(strategy, statsEngine, config.llm, logger);

  // Test player
  const player: PlayerInAuction = {
    id: '980634a4-7fce-484c-aec7-701358917951',
    name: 'Jos Buttler',
    role: 'WICKETKEEPER' as PlayerRole,
    country: 'England',
    basePrice: 200,
    isCapped: true,
    isOverseas: true,
  };

  // Mock squad analysis
  const squadAnalysis: SquadAnalysis = {
    currentSize: 0,
    overseasCount: 0,
    roleDistribution: {
      BATTER: 0,
      BOWLER: 0,
      'ALL-ROUNDER': 0,
      WICKETKEEPER: 0,
    },
    roleGaps: {
      BATTER: 10,
      BOWLER: 9,
      'ALL-ROUNDER': 5,
      WICKETKEEPER: 1,
    },
    budgetRemaining: 12000,
    budgetPerSlot: 480,
    phase: 'early' as BudgetPhase,
  };

  try {
    console.log('🤖 Testing AI decision for Jos Buttler...\n');

    const decision = await decisionEngine.makeDecision(player, squadAnalysis);

    console.log('✅ Decision made:');
    console.log(`   Should bid: ${decision.shouldBid}`);
    console.log(`   Max bid: ${decision.maxBid || 'N/A'}`);
    console.log(`   Reasoning: ${decision.reasoning}`);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testDecision().then(() => process.exit(0)).catch(console.error);
