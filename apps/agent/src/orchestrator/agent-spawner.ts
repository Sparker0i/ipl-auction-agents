import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  AgentProcess,
  AgentSpawnOptions,
  OrchestratorEvent,
} from '../types/orchestrator.types.js';
import { TeamCode } from '../types/agent.types.js';
import type { Logger } from 'winston';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type EventHandler = (event: OrchestratorEvent) => void;

/**
 * Agent process spawner and manager
 */
export class AgentSpawner {
  private processes: Map<TeamCode, ChildProcess> = new Map();
  private agentStates: Map<TeamCode, AgentProcess> = new Map();
  private logger: Logger;
  private eventHandlers: EventHandler[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Spawn an agent process
   */
  async spawnAgent(options: AgentSpawnOptions): Promise<AgentProcess> {
    const { teamCode, auctionCode, delayMs = 0 } = options;

    // Wait for delay if specified (to stagger agent starts)
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    this.logger.info('Spawning agent', { teamCode, auctionCode });

    // Initialize agent state
    const agentState: AgentProcess = {
      teamCode,
      processId: null,
      status: 'starting',
      startTime: new Date(),
      lastHeartbeat: null,
      restartCount: 0,
      errors: [],
    };

    this.agentStates.set(teamCode, agentState);

    try {
      // Get the agent worker script path
      const workerPath = path.join(__dirname, '../orchestrator/agent-worker.js');

      // Spawn child process
      const childProcess = fork(workerPath, [], {
        env: {
          ...process.env,
          TEAM_CODE: teamCode,
          AUCTION_CODE: auctionCode,
          NODE_ENV: process.env.NODE_ENV || 'development',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      this.processes.set(teamCode, childProcess);
      agentState.processId = childProcess.pid || null;
      agentState.status = 'running';

      this.logger.info('Agent spawned successfully', {
        teamCode,
        pid: childProcess.pid,
      });

      // Setup event listeners
      this.setupProcessListeners(teamCode, childProcess);

      this.emitEvent('agent_started', teamCode);

      return agentState;
    } catch (error) {
      this.logger.error('Failed to spawn agent', { teamCode, error });
      agentState.status = 'error';
      agentState.errors.push(`Spawn failed: ${error}`);
      this.emitEvent('agent_error', teamCode, { error });
      throw error;
    }
  }

  /**
   * Setup process event listeners
   */
  private setupProcessListeners(teamCode: TeamCode, process: ChildProcess): void {
    // Handle messages from agent
    process.on('message', (message: any) => {
      this.handleAgentMessage(teamCode, message);
    });

    // Handle process exit
    process.on('exit', (code, signal) => {
      this.logger.warn('Agent process exited', {
        teamCode,
        code,
        signal,
      });

      const state = this.agentStates.get(teamCode);
      if (state && state.status !== 'stopped') {
        state.status = 'error';
        state.errors.push(`Process exited with code ${code}, signal ${signal}`);
        this.emitEvent('agent_stopped', teamCode, { code, signal });
      }
    });

    // Handle process errors
    process.on('error', (error) => {
      this.logger.error('Agent process error', { teamCode, error });

      const state = this.agentStates.get(teamCode);
      if (state) {
        state.status = 'error';
        state.errors.push(`Process error: ${error.message}`);
        this.emitEvent('agent_error', teamCode, { error });
      }
    });

    // Pipe stdout to logger
    if (process.stdout) {
      process.stdout.on('data', (data) => {
        this.logger.debug(`Agent ${teamCode} stdout`, {
          data: data.toString().trim(),
        });
      });
    }

    // Pipe stderr to logger
    if (process.stderr) {
      process.stderr.on('data', (data) => {
        this.logger.error(`Agent ${teamCode} stderr`, {
          data: data.toString().trim(),
        });
      });
    }
  }

  /**
   * Handle messages from agent process
   */
  private handleAgentMessage(teamCode: TeamCode, message: any): void {
    if (!message || !message.type) return;

    const state = this.agentStates.get(teamCode);
    if (!state) return;

    switch (message.type) {
      case 'heartbeat':
        state.lastHeartbeat = new Date();
        this.emitEvent('agent_heartbeat', teamCode, message.data);
        break;

      case 'ready':
        this.logger.info('Agent ready', { teamCode });
        break;

      case 'error':
        state.errors.push(message.error);
        this.logger.error('Agent reported error', {
          teamCode,
          error: message.error,
        });
        break;

      case 'decision':
        this.logger.debug('Agent decision', {
          teamCode,
          decision: message.data,
        });
        break;

      default:
        this.logger.debug('Agent message', { teamCode, message });
    }
  }

  /**
   * Stop an agent
   */
  async stopAgent(teamCode: TeamCode, timeout: number = 10000): Promise<void> {
    const process = this.processes.get(teamCode);
    const state = this.agentStates.get(teamCode);

    if (!process || !state) {
      this.logger.warn('Agent not found', { teamCode });
      return;
    }

    this.logger.info('Stopping agent', { teamCode });

    state.status = 'stopped';

    // Send shutdown message
    if (process.connected) {
      process.send({ type: 'shutdown' });
    }

    // Wait for graceful shutdown
    await this.waitForExit(process, timeout);

    // Force kill if still running
    if (!process.killed) {
      this.logger.warn('Force killing agent', { teamCode });
      process.kill('SIGKILL');
    }

    this.processes.delete(teamCode);
    this.emitEvent('agent_stopped', teamCode);

    this.logger.info('Agent stopped', { teamCode });
  }

  /**
   * Wait for process to exit
   */
  private waitForExit(process: ChildProcess, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve();
      }, timeout);

      process.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Restart an agent
   */
  async restartAgent(
    teamCode: TeamCode,
    options: AgentSpawnOptions
  ): Promise<AgentProcess> {
    this.logger.info('Restarting agent', { teamCode });

    const oldState = this.agentStates.get(teamCode);
    const previousRestartCount = oldState ? oldState.restartCount : 0;

    // Stop existing process and clear old state
    await this.stopAgent(teamCode, 5000);

    // Wait a bit before restart
    await this.sleep(2000);

    // Spawn new process (this creates fresh state)
    const newState = await this.spawnAgent(options);

    // Preserve restart count from previous instance
    newState.restartCount = previousRestartCount + 1;
    this.agentStates.set(teamCode, newState);

    this.logger.info('Agent restart complete', {
      teamCode,
      restartCount: newState.restartCount,
    });

    this.emitEvent('agent_restarted', teamCode);

    return newState;
  }

  /**
   * Get agent state
   */
  getAgentState(teamCode: TeamCode): AgentProcess | undefined {
    return this.agentStates.get(teamCode);
  }

  /**
   * Get all agent states
   */
  getAllAgentStates(): AgentProcess[] {
    return Array.from(this.agentStates.values());
  }

  /**
   * Stop all agents
   */
  async stopAll(timeout: number = 10000): Promise<void> {
    this.logger.info('Stopping all agents');

    const stopPromises = Array.from(this.processes.keys()).map((teamCode) =>
      this.stopAgent(teamCode, timeout)
    );

    await Promise.all(stopPromises);

    this.logger.info('All agents stopped');
  }

  /**
   * Register event handler
   */
  on(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Emit event to handlers
   */
  private emitEvent(
    type: string,
    teamCode: TeamCode,
    data?: any
  ): void {
    const event: OrchestratorEvent = { type, teamCode, data };
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        this.logger.error('Event handler error', { error });
      }
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
