/**
 * Orchestrator Entry Point
 * Spawns and manages 9 concurrent auction agents
 */

import { EventEmitter } from 'events';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { AgentSpawner } from './agent-spawner.js';
import { HealthMonitor } from './health-monitor.js';
import { LogAggregator } from './log-aggregator.js';
import { PerformanceProfiler } from '../monitoring/performance-profiler.js';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import type { TeamCode } from '../types/agent.types.js';
import type {
  OrchestratorConfig,
  AgentProcess,
  OrchestratorEvent
} from '../types/orchestrator.types.js';

const TEAM_CODES: TeamCode[] = [
  'CSK', 'MI', 'RCB', 'DC', 'PBKS', 'RR', 'KKR', 'LSG', 'SRH', 'GT'
];

export interface OrchestratorOptions {
  auctionCode: string;
  teams?: TeamCode[];
  staggerDelay?: number;
}

export class Orchestrator extends EventEmitter {
  private config: OrchestratorConfig;
  private auctionCode: string;
  private spawner: AgentSpawner;
  private healthMonitor: HealthMonitor;
  private logAggregator: LogAggregator;
  private profiler: PerformanceProfiler;
  private logger: ReturnType<typeof createLogger>;
  private teams: TeamCode[];
  private running: boolean = false;
  private shutdownInProgress: boolean = false;

  constructor(options: OrchestratorOptions) {
    super();

    const fullConfig = loadConfig();
    this.config = fullConfig.orchestrator;
    this.auctionCode = options.auctionCode;
    this.teams = options.teams || TEAM_CODES.slice(0, 9); // First 9 teams

    // Initialize components
    this.logger = createLogger('orchestrator', fullConfig.logging);
    this.spawner = new AgentSpawner(this.logger);
    this.healthMonitor = new HealthMonitor(
      this.config,
      this.logger,
      (teamCode) => this.handleUnhealthyAgent(teamCode)
    );
    this.logAggregator = new LogAggregator(fullConfig.logging);
    this.profiler = new PerformanceProfiler();

    // Setup event listeners
    this.setupEventListeners();
    this.setupSignalHandlers();
  }

  /**
   * Get available teams (teams not yet joined by any user)
   */
  private async getAvailableTeams(): Promise<TeamCode[]> {
    const prisma = new PrismaClient();

    try {
      // Find the auction by ID or roomCode
      const auction = await prisma.auction.findFirst({
        where: {
          OR: [
            { id: this.auctionCode },
            { roomCode: this.auctionCode },
          ],
        },
        include: {
          teams: {
            select: {
              teamName: true,
              ownerSessionId: true,
            },
          },
        },
      });

      if (!auction) {
        throw new Error(`Auction not found: ${this.auctionCode}`);
      }

      // Filter teams that are not owned (ownerSessionId is null)
      const availableTeams = auction.teams
        .filter(team => team.ownerSessionId === null)
        .map(team => team.teamName as TeamCode);

      this.logger.info('Available teams detected', {
        total: auction.teams.length,
        available: availableTeams.length,
        teams: availableTeams.join(', '),
      });

      return availableTeams;
    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Start orchestrator and spawn all agents
   */
  async start(): Promise<void> {
    if (this.running) {
      this.logger.warn('Orchestrator already running');
      return;
    }

    this.running = true;
    this.logger.info(`Starting orchestrator for auction: ${this.auctionCode}`);

    try {
      // Get available teams from database
      const availableTeams = await this.getAvailableTeams();

      if (availableTeams.length === 0) {
        this.logger.warn('No available teams to spawn agents for');
        return;
      }

      // Use available teams instead of configured teams
      this.teams = availableTeams.slice(0, this.config.maxConcurrentAgents);

      this.logger.info(`Spawning ${this.teams.length} agents: ${this.teams.join(', ')}`);

      // Start monitoring
      this.profiler.startMonitoring();
      this.healthMonitor.start(() => this.spawner.getAllAgentStates());

      // Spawn agents with staggered delays (default 0 for simultaneous spawning)
      const staggerDelay = this.config.agentStaggerDelay ?? 0;

      for (let i = 0; i < this.teams.length; i++) {
        const teamCode = this.teams[i];

        this.logger.info(`Spawning agent ${i + 1}/${this.teams.length}: ${teamCode}`);

        // Initialize profiler for agent
        this.profiler.initializeAgent(teamCode);

        // Spawn agent process
        await this.spawner.spawnAgent({
          teamCode,
          auctionCode: this.auctionCode,
        });

        // Stagger spawning to avoid overwhelming system
        if (i < this.teams.length - 1) {
          await this.sleep(staggerDelay);
        }
      }

      // Update peak concurrent agents
      this.profiler.updatePeakConcurrentAgents(this.teams.length);

      this.logger.info(`All ${this.teams.length} agents spawned successfully`);
      this.emit('orchestrator:started', { teams: this.teams });

      // Start log aggregation
      await this.logAggregator.start();

    } catch (error) {
      this.logger.error('Failed to start orchestrator', { error });
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Gracefully shutdown orchestrator and all agents
   */
  async shutdown(): Promise<void> {
    if (this.shutdownInProgress) {
      this.logger.warn('Shutdown already in progress');
      return;
    }

    this.shutdownInProgress = true;
    this.logger.info('Initiating graceful shutdown...');

    try {
      // Stop accepting new work
      this.running = false;

      // Stop monitoring
      this.healthMonitor.stop();
      this.profiler.stopMonitoring();

      // Stop all agents
      this.logger.info('Stopping all agents...');
      await this.spawner.stopAll();

      // Stop log aggregation
      await this.logAggregator.stop();

      // Generate final reports
      await this.generateFinalReports();

      this.logger.info('Orchestrator shutdown complete');
      this.emit('orchestrator:stopped');

    } catch (error) {
      this.logger.error('Error during shutdown', { error });
      throw error;
    } finally {
      this.shutdownInProgress = false;
    }
  }

  /**
   * Get orchestrator status
   */
  getStatus(): {
    running: boolean;
    auctionCode: string;
    agents: AgentProcess[];
    healthSummary: ReturnType<HealthMonitor['getHealthSummary']>;
  } {
    const agents = this.spawner.getAllAgentStates();
    return {
      running: this.running,
      auctionCode: this.auctionCode,
      agents,
      healthSummary: this.healthMonitor.getHealthSummary(agents),
    };
  }

  /**
   * Setup event listeners for spawner and health monitor
   */
  private setupEventListeners(): void {
    // Spawner events - single handler for all event types
    this.spawner.on((event: any) => {
      const { type, teamCode, data } = event;

      switch (type) {
        case 'agent_started':
          this.logger.info(`Agent started: ${teamCode}`, data);
          this.emit('agent:started', { teamCode, data });
          break;

        case 'agent_stopped':
          this.logger.info(`Agent stopped: ${teamCode}`, data);
          this.emit('agent:stopped', { teamCode, data });
          break;

        case 'agent_error':
          this.logger.error(`Agent error: ${teamCode}`, data);
          this.profiler.recordBrowserCrash(teamCode);
          this.emit('agent:error', { teamCode, data });
          break;

        case 'agent_heartbeat':
          // Heartbeat handled by health monitor
          break;

        case 'agent_restarted':
          this.logger.info(`Agent restarted: ${teamCode}`);
          break;

        default:
          this.logger.debug(`Unknown event type: ${type}`, { teamCode, data });
      }

      // Also pass to message handler if there's message data
      if (data) {
        this.handleAgentMessage({ teamCode, data });
      }
    });
  }

  /**
   * Handle messages from agent processes
   */
  private handleAgentMessage(event: OrchestratorEvent): void {
    const { teamCode, data } = event;

    if (!data || typeof data !== 'object') return;

    const messageData = data as any;

    switch (messageData.type) {
      case 'heartbeat':
        // Heartbeat handled by health monitor
        break;

      case 'decision':
        this.profiler.recordDecision(
          teamCode,
          messageData.durationMs || 0,
          messageData.success || false
        );
        if (messageData.llmTimeout) {
          this.profiler.recordLLMTimeout(teamCode);
        }
        break;

      case 'bid':
        this.profiler.recordBid(
          teamCode,
          messageData.amount || 0,
          messageData.won || false
        );
        break;

      case 'llm_call':
        this.profiler.recordLLMCall(
          teamCode,
          messageData.cached || false
        );
        break;

      case 'error':
        this.logger.error(`Agent ${teamCode} reported error`, messageData);
        break;

      default:
        this.logger.debug(`Unknown message type from ${teamCode}`, messageData);
    }
  }

  /**
   * Handle unhealthy agent
   */
  private async handleUnhealthyAgent(teamCode: TeamCode): Promise<void> {
    this.logger.warn(`Attempting to restart unhealthy agent: ${teamCode}`);
    this.emit('agent:unhealthy', { teamCode });

    try {
      await this.spawner.restartAgent(teamCode, {
        teamCode,
        auctionCode: this.auctionCode,
      });
      this.profiler.recordAgentRestart(teamCode);
      this.logger.info(`Successfully restarted agent: ${teamCode}`);
    } catch (error) {
      this.logger.error(`Failed to restart agent: ${teamCode}`, { error });
      this.emit('agent:restart_failed', { teamCode, error });
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      this.logger.info(`Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', { error });
      this.shutdown().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', { reason });
      this.shutdown().finally(() => process.exit(1));
    });
  }

  /**
   * Generate final reports
   */
  private async generateFinalReports(): Promise<void> {
    try {
      this.logger.info('Generating final reports...');

      // Performance report
      const performanceReport = this.profiler.generateReport();
      const reportPath = path.join(
        process.cwd(),
        'reports',
        `profiler-${this.auctionCode}.json`
      );

      const fs = await import('fs');
      if (!fs.existsSync(path.dirname(reportPath))) {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      }

      // Save profiler data as JSON
      fs.writeFileSync(
        reportPath,
        JSON.stringify(this.profiler.getMetrics(), null, 2),
        'utf-8'
      );

      this.logger.info(`Performance data saved: ${reportPath}`);

      // Save markdown report
      const mdReportPath = path.join(
        process.cwd(),
        'reports',
        `profiler-${this.auctionCode}.md`
      );
      fs.writeFileSync(mdReportPath, performanceReport, 'utf-8');

      this.logger.info(`Performance report saved: ${mdReportPath}`);

    } catch (error) {
      this.logger.error('Failed to generate reports', { error });
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npm run dev <auction-code>');
    console.log('');
    console.log('Example:');
    console.log('  npm run dev ABCD12');
    process.exit(1);
  }

  const auctionCode = args[0];

  console.log('🏏 IPL Auction AI Agent Orchestrator');
  console.log('');
  console.log(`Auction Code: ${auctionCode}`);
  console.log('');

  const orchestrator = new Orchestrator({ auctionCode });

  // Log orchestrator events
  orchestrator.on('orchestrator:started', () => {
    console.log('✅ All agents spawned and ready');
    console.log('📊 Monitoring agent health...');
    console.log('📝 Aggregating logs...');
    console.log('');
    console.log('Press Ctrl+C to stop');
  });

  orchestrator.on('agent:started', (event: OrchestratorEvent) => {
    console.log(`  ✓ ${event.teamCode} agent started (PID: ${event.data?.processId})`);
  });

  orchestrator.on('agent:error', (event: OrchestratorEvent) => {
    console.log(`  ✗ ${event.teamCode} agent error: ${event.data?.error}`);
  });

  orchestrator.on('agent:unhealthy', (event: OrchestratorEvent) => {
    console.log(`  ⚠ ${event.teamCode} agent unhealthy, restarting...`);
  });

  try {
    await orchestrator.start();
  } catch (error) {
    console.error('❌ Failed to start orchestrator:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default Orchestrator;
