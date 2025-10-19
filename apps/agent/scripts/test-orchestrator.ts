#!/usr/bin/env tsx
/**
 * Orchestrator Test Script
 * Tests multi-agent orchestration with mock auction
 */

import Orchestrator from '../src/orchestrator/index.js';
import type { OrchestratorEvent } from '../src/types/orchestrator.types.js';

async function main() {
  console.log('🧪 Testing Orchestrator');
  console.log('='.repeat(50));
  console.log('');

  const auctionCode = 'TEST' + Date.now().toString().slice(-6);

  console.log(`Auction Code: ${auctionCode}`);
  console.log('Teams: 3 (CSK, MI, RCB) for testing');
  console.log('');

  // Create orchestrator with only 3 teams for testing
  const orchestrator = new Orchestrator({
    auctionCode,
    teams: ['CSK', 'MI', 'RCB'],
  });

  // Track events
  const events: { event: string; time: Date; data?: any }[] = [];

  orchestrator.on('orchestrator:started', (data) => {
    events.push({ event: 'orchestrator:started', time: new Date(), data });
    console.log('✅ Orchestrator started');
    console.log(`   Teams: ${data.teams.join(', ')}`);
    console.log('');
  });

  orchestrator.on('agent:started', (event: OrchestratorEvent) => {
    events.push({ event: 'agent:started', time: new Date(), data: event });
    console.log(`✅ Agent started: ${event.teamCode}`);
    console.log(`   PID: ${event.data?.processId}`);
  });

  orchestrator.on('agent:error', (event: OrchestratorEvent) => {
    events.push({ event: 'agent:error', time: new Date(), data: event });
    console.log(`❌ Agent error: ${event.teamCode}`);
    console.log(`   Error: ${event.data?.error}`);
  });

  orchestrator.on('agent:stopped', (event: OrchestratorEvent) => {
    events.push({ event: 'agent:stopped', time: new Date(), data: event });
    console.log(`🛑 Agent stopped: ${event.teamCode}`);
  });

  orchestrator.on('orchestrator:stopped', () => {
    events.push({ event: 'orchestrator:stopped', time: new Date() });
    console.log('');
    console.log('🛑 Orchestrator stopped');
  });

  try {
    // Start orchestrator
    console.log('Starting orchestrator...');
    console.log('');
    await orchestrator.start();

    // Wait for agents to initialize
    console.log('');
    console.log('Waiting for agents to initialize (10 seconds)...');
    await sleep(10000);

    // Check status
    console.log('');
    console.log('📊 Orchestrator Status:');
    const status = orchestrator.getStatus();
    console.log(`   Running: ${status.running}`);
    console.log(`   Auction: ${status.auctionCode}`);
    console.log(`   Agents: ${status.agents.length}`);
    console.log('');

    console.log('🏥 Health Summary:');
    console.log(`   Healthy: ${status.healthSummary.healthy}`);
    console.log(`   Unhealthy: ${status.healthSummary.unhealthy}`);
    console.log(`   Total: ${status.healthSummary.total}`);
    console.log('');

    console.log('👥 Agent Details:');
    for (const agent of status.agents) {
      const healthStatus = agent.status === 'running' ? '✅' : '❌';
      console.log(
        `   ${healthStatus} ${agent.teamCode}: ${agent.status} (PID: ${agent.processId || 'N/A'})`
      );
      if (agent.errors.length > 0) {
        console.log(`      Errors: ${agent.errors.length}`);
      }
      if (agent.restartCount > 0) {
        console.log(`      Restarts: ${agent.restartCount}`);
      }
    }

    // Run test for 30 seconds
    console.log('');
    console.log('Running test for 30 seconds...');
    console.log('(Agents will attempt to join auction and monitor state)');
    console.log('');

    await sleep(30000);

    // Shutdown
    console.log('');
    console.log('Initiating shutdown...');
    await orchestrator.shutdown();

    // Summary
    console.log('');
    console.log('='.repeat(50));
    console.log('📋 Test Summary');
    console.log('='.repeat(50));
    console.log('');

    console.log(`Total Events: ${events.length}`);
    console.log('');

    console.log('Event Breakdown:');
    const eventCounts: Record<string, number> = {};
    for (const e of events) {
      eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
    }

    for (const [eventName, count] of Object.entries(eventCounts)) {
      console.log(`  ${eventName}: ${count}`);
    }

    console.log('');
    console.log('✅ Test completed successfully');
    console.log('');
    console.log('📝 Check logs in logs/ directory');
    console.log('📊 Check reports in reports/ directory');

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Test failed:', error);
    console.error('');

    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore shutdown errors
    }

    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
