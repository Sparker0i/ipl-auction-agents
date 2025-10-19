import { AgentProcess, OrchestratorConfig } from '../types/orchestrator.types.js';
import { TeamCode } from '../types/agent.types.js';
import type { Logger } from 'winston';

/**
 * Agent health monitoring
 */
export class HealthMonitor {
  private config: OrchestratorConfig;
  private logger: Logger;
  private monitorInterval: NodeJS.Timeout | null = null;
  private onUnhealthyAgent: (teamCode: TeamCode) => void;

  constructor(
    config: OrchestratorConfig,
    logger: Logger,
    onUnhealthyAgent: (teamCode: TeamCode) => void
  ) {
    this.config = config;
    this.logger = logger;
    this.onUnhealthyAgent = onUnhealthyAgent;
  }

  /**
   * Start health monitoring
   */
  start(getAgentStates: () => AgentProcess[]): void {
    this.logger.info('Starting health monitor', {
      interval: this.config.healthCheckInterval,
    });

    this.monitorInterval = setInterval(() => {
      this.checkAllAgents(getAgentStates());
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
      this.logger.info('Health monitor stopped');
    }
  }

  /**
   * Check health of all agents
   */
  private checkAllAgents(agents: AgentProcess[]): void {
    const now = new Date();

    for (const agent of agents) {
      if (agent.status !== 'running') {
        continue; // Skip non-running agents
      }

      // Check if heartbeat is stale
      if (agent.lastHeartbeat) {
        const timeSinceHeartbeat = now.getTime() - agent.lastHeartbeat.getTime();

        if (timeSinceHeartbeat > this.config.heartbeatTimeout) {
          this.logger.warn('Agent heartbeat timeout', {
            teamCode: agent.teamCode,
            lastHeartbeat: agent.lastHeartbeat,
            timeSinceMs: timeSinceHeartbeat,
          });

          this.onUnhealthyAgent(agent.teamCode);
        }
      } else {
        // No heartbeat received yet
        const timeSinceStart = agent.startTime
          ? now.getTime() - agent.startTime.getTime()
          : 0;

        // Give agent time to initialize and send first heartbeat
        // Use 2x the heartbeat interval to account for startup time
        const firstHeartbeatTimeout = Math.max(60000, this.config.heartbeatTimeout / 6);

        if (timeSinceStart > firstHeartbeatTimeout) {
          this.logger.warn('Agent never sent heartbeat', {
            teamCode: agent.teamCode,
            startTime: agent.startTime,
            timeSinceStartMs: timeSinceStart,
            timeout: firstHeartbeatTimeout,
          });

          this.onUnhealthyAgent(agent.teamCode);
        }
      }
    }
  }

  /**
   * Check if agent is healthy
   */
  isHealthy(agent: AgentProcess): boolean {
    if (agent.status !== 'running') {
      return false;
    }

    if (!agent.lastHeartbeat) {
      // Check if agent just started (give it 30s)
      if (agent.startTime) {
        const timeSinceStart = Date.now() - agent.startTime.getTime();
        return timeSinceStart < 30000;
      }
      return false;
    }

    const timeSinceHeartbeat = Date.now() - agent.lastHeartbeat.getTime();
    return timeSinceHeartbeat <= this.config.heartbeatTimeout;
  }

  /**
   * Get health summary for all agents
   */
  getHealthSummary(agents: AgentProcess[]): {
    total: number;
    healthy: number;
    unhealthy: number;
    details: Array<{ teamCode: TeamCode; healthy: boolean; lastHeartbeat: Date | null }>;
  } {
    const details = agents.map((agent) => ({
      teamCode: agent.teamCode,
      healthy: this.isHealthy(agent),
      lastHeartbeat: agent.lastHeartbeat,
    }));

    return {
      total: agents.length,
      healthy: details.filter((d) => d.healthy).length,
      unhealthy: details.filter((d) => !d.healthy).length,
      details,
    };
  }
}
