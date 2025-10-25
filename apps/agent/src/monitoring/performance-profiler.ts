/**
 * Performance Profiler
 * Tracks and reports performance metrics for agents
 */

export interface PerformanceMetrics {
  agentMetrics: Map<string, AgentMetrics>;
  systemMetrics: SystemMetrics;
  startTime: Date;
  endTime?: Date;
}

export interface AgentMetrics {
  teamCode: string;
  decisionsCount: number;
  averageDecisionTime: number;
  minDecisionTime: number;
  maxDecisionTime: number;
  llmSuccessRate: number;
  llmTimeouts: number;
  llmErrors: number;
  bidsPlaced: number;
  bidsWon: number;
  totalSpent: number;
  squadSize: number;
  browserCrashes: number;
  restartCount: number;
  decisionTimings: number[];
}

export interface SystemMetrics {
  totalDecisions: number;
  averageSystemDecisionTime: number;
  peakConcurrentAgents: number;
  totalLLMCalls: number;
  llmCacheHits: number;
  llmCacheMisses: number;
  memoryUsageMB: number;
  cpuUsagePercent: number;
}

export class PerformanceProfiler {
  private metrics: PerformanceMetrics;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor() {
    this.metrics = {
      agentMetrics: new Map(),
      systemMetrics: {
        totalDecisions: 0,
        averageSystemDecisionTime: 0,
        peakConcurrentAgents: 0,
        totalLLMCalls: 0,
        llmCacheHits: 0,
        llmCacheMisses: 0,
        memoryUsageMB: 0,
        cpuUsagePercent: 0,
      },
      startTime: new Date(),
    };
  }

  /**
   * Initialize agent metrics
   */
  initializeAgent(teamCode: string): void {
    this.metrics.agentMetrics.set(teamCode, {
      teamCode,
      decisionsCount: 0,
      averageDecisionTime: 0,
      minDecisionTime: Infinity,
      maxDecisionTime: 0,
      llmSuccessRate: 0,
      llmTimeouts: 0,
      llmErrors: 0,
      bidsPlaced: 0,
      bidsWon: 0,
      totalSpent: 0,
      squadSize: 0,
      browserCrashes: 0,
      restartCount: 0,
      decisionTimings: [],
    });
  }

  /**
   * Record a decision timing
   */
  recordDecision(teamCode: string, durationMs: number, success: boolean): void {
    const agentMetrics = this.metrics.agentMetrics.get(teamCode);
    if (!agentMetrics) return;

    agentMetrics.decisionsCount++;
    agentMetrics.decisionTimings.push(durationMs);

    // Update min/max
    agentMetrics.minDecisionTime = Math.min(
      agentMetrics.minDecisionTime,
      durationMs
    );
    agentMetrics.maxDecisionTime = Math.max(
      agentMetrics.maxDecisionTime,
      durationMs
    );

    // Update average
    const sum = agentMetrics.decisionTimings.reduce((a, b) => a + b, 0);
    agentMetrics.averageDecisionTime = sum / agentMetrics.decisionsCount;

    // Update success rate
    if (!success) {
      agentMetrics.llmErrors++;
    }
    agentMetrics.llmSuccessRate =
      (agentMetrics.decisionsCount - agentMetrics.llmErrors) /
      agentMetrics.decisionsCount;

    // Update system metrics
    this.metrics.systemMetrics.totalDecisions++;
    this.updateSystemAverageDecisionTime();
  }

  /**
   * Record LLM timeout
   */
  recordLLMTimeout(teamCode: string): void {
    const agentMetrics = this.metrics.agentMetrics.get(teamCode);
    if (!agentMetrics) return;

    agentMetrics.llmTimeouts++;
    this.metrics.systemMetrics.llmCacheMisses++;
  }

  /**
   * Record LLM call
   */
  recordLLMCall(cached: boolean): void {
    this.metrics.systemMetrics.totalLLMCalls++;
    if (cached) {
      this.metrics.systemMetrics.llmCacheHits++;
    } else {
      this.metrics.systemMetrics.llmCacheMisses++;
    }
  }

  /**
   * Record bid placed
   */
  recordBid(teamCode: string, amount: number, won: boolean): void {
    const agentMetrics = this.metrics.agentMetrics.get(teamCode);
    if (!agentMetrics) return;

    agentMetrics.bidsPlaced++;
    if (won) {
      agentMetrics.bidsWon++;
      agentMetrics.totalSpent += amount;
      agentMetrics.squadSize++;
    }
  }

  /**
   * Record browser crash
   */
  recordBrowserCrash(teamCode: string): void {
    const agentMetrics = this.metrics.agentMetrics.get(teamCode);
    if (!agentMetrics) return;

    agentMetrics.browserCrashes++;
  }

  /**
   * Record agent restart
   */
  recordAgentRestart(teamCode: string): void {
    const agentMetrics = this.metrics.agentMetrics.get(teamCode);
    if (!agentMetrics) return;

    agentMetrics.restartCount++;
  }

  /**
   * Update peak concurrent agents
   */
  updatePeakConcurrentAgents(count: number): void {
    this.metrics.systemMetrics.peakConcurrentAgents = Math.max(
      this.metrics.systemMetrics.peakConcurrentAgents,
      count
    );
  }

  /**
   * Start system metrics monitoring
   */
  startMonitoring(intervalMs: number = 5000): void {
    this.intervalHandle = setInterval(() => {
      const memUsage = process.memoryUsage();
      this.metrics.systemMetrics.memoryUsageMB = Math.round(
        memUsage.heapUsed / 1024 / 1024
      );

      // CPU usage would require external library, placeholder for now
      this.metrics.systemMetrics.cpuUsagePercent = 0;
    }, intervalMs);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.metrics.endTime = new Date();
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    return this.metrics;
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const duration = this.metrics.endTime
      ? this.metrics.endTime.getTime() - this.metrics.startTime.getTime()
      : Date.now() - this.metrics.startTime.getTime();

    const durationMinutes = Math.round(duration / 60000);

    let report = '# Performance Report\n\n';
    report += `**Duration**: ${durationMinutes} minutes\n`;
    report += `**Start**: ${this.metrics.startTime.toISOString()}\n`;
    if (this.metrics.endTime) {
      report += `**End**: ${this.metrics.endTime.toISOString()}\n`;
    }
    report += '\n## System Metrics\n\n';
    report += `- Total Decisions: ${this.metrics.systemMetrics.totalDecisions}\n`;
    report += `- Average Decision Time: ${Math.round(this.metrics.systemMetrics.averageSystemDecisionTime)}ms\n`;
    report += `- Peak Concurrent Agents: ${this.metrics.systemMetrics.peakConcurrentAgents}\n`;
    report += `- Total LLM Calls: ${this.metrics.systemMetrics.totalLLMCalls}\n`;
    report += `- LLM Cache Hit Rate: ${this.calculateCacheHitRate()}%\n`;
    report += `- Memory Usage: ${this.metrics.systemMetrics.memoryUsageMB}MB\n\n`;

    report += '## Agent Performance\n\n';
    report += '| Team | Decisions | Avg Time (ms) | Min/Max (ms) | LLM Success | Bids | Won | Spent (L) | Squad |\n';
    report += '|------|-----------|---------------|--------------|-------------|------|-----|-----------|-------|\n';

    // Sort by team code
    const sortedAgents = Array.from(this.metrics.agentMetrics.values()).sort(
      (a, b) => a.teamCode.localeCompare(b.teamCode)
    );

    for (const agent of sortedAgents) {
      const avgTime = Math.round(agent.averageDecisionTime);
      const minTime = agent.minDecisionTime === Infinity ? 0 : Math.round(agent.minDecisionTime);
      const maxTime = Math.round(agent.maxDecisionTime);
      const llmSuccess = (agent.llmSuccessRate * 100).toFixed(1);

      report += `| ${agent.teamCode} | ${agent.decisionsCount} | ${avgTime} | ${minTime}/${maxTime} | ${llmSuccess}% | ${agent.bidsPlaced} | ${agent.bidsWon} | ${agent.totalSpent} | ${agent.squadSize} |\n`;
    }

    report += '\n## Reliability Metrics\n\n';
    report += '| Team | Browser Crashes | Agent Restarts | LLM Timeouts | LLM Errors |\n';
    report += '|------|----------------|----------------|--------------|------------|\n';

    for (const agent of sortedAgents) {
      report += `| ${agent.teamCode} | ${agent.browserCrashes} | ${agent.restartCount} | ${agent.llmTimeouts} | ${agent.llmErrors} |\n`;
    }

    report += '\n## Decision Time Distribution\n\n';
    const p50 = this.calculatePercentile(50);
    const p95 = this.calculatePercentile(95);
    const p99 = this.calculatePercentile(99);

    report += `- **P50 (Median)**: ${Math.round(p50)}ms\n`;
    report += `- **P95**: ${Math.round(p95)}ms\n`;
    report += `- **P99**: ${Math.round(p99)}ms\n`;

    return report;
  }

  /**
   * Update system average decision time
   */
  private updateSystemAverageDecisionTime(): void {
    let totalTime = 0;
    let totalDecisions = 0;

    for (const agent of this.metrics.agentMetrics.values()) {
      totalTime += agent.averageDecisionTime * agent.decisionsCount;
      totalDecisions += agent.decisionsCount;
    }

    this.metrics.systemMetrics.averageSystemDecisionTime =
      totalDecisions > 0 ? totalTime / totalDecisions : 0;
  }

  /**
   * Calculate cache hit rate
   */
  private calculateCacheHitRate(): number {
    const total = this.metrics.systemMetrics.totalLLMCalls;
    if (total === 0) return 0;

    const hitRate =
      (this.metrics.systemMetrics.llmCacheHits / total) * 100;
    return Math.round(hitRate * 10) / 10;
  }

  /**
   * Calculate percentile for decision times
   */
  private calculatePercentile(percentile: number): number {
    const allTimings: number[] = [];
    for (const agent of this.metrics.agentMetrics.values()) {
      allTimings.push(...agent.decisionTimings);
    }

    if (allTimings.length === 0) return 0;

    allTimings.sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * allTimings.length) - 1;
    return allTimings[Math.max(0, index)];
  }
}
