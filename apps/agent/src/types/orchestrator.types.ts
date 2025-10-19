import { TeamCode } from './agent.types.js';

/**
 * Agent process status
 */
export type AgentProcessStatus =
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'restarting';

/**
 * Agent process information
 */
export interface AgentProcess {
  teamCode: TeamCode;
  processId: number | null;
  status: AgentProcessStatus;
  startTime: Date | null;
  lastHeartbeat: Date | null;
  restartCount: number;
  errors: string[];
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  maxConcurrentAgents: number;
  agentHealthCheckInterval: number; // ms
  agentRestartAttempts: number;
  agentStaggerDelay?: number; // ms between starting agents
  heartbeatTimeout?: number; // ms before considering agent dead
}

/**
 * Agent spawn options
 */
export interface AgentSpawnOptions {
  teamCode: TeamCode;
  auctionCode: string;
}

/**
 * Orchestrator event
 */
export interface OrchestratorEvent {
  teamCode: TeamCode;
  data?: any;
}

/**
 * Agent metrics
 */
export interface AgentMetrics {
  teamCode: TeamCode;
  uptime: number; // seconds
  bidCount: number;
  playersAcquired: number;
  budgetSpent: number;
  budgetRemaining: number;
  squadSize: number;
  decisionTime: {
    avg: number;
    p95: number;
    p99: number;
  };
}

/**
 * Orchestrator status summary
 */
export interface OrchestratorStatus {
  totalAgents: number;
  runningAgents: number;
  stoppedAgents: number;
  errorAgents: number;
  agents: AgentProcess[];
  uptime: number; // seconds
}
