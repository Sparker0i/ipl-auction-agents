import { BrowserContext, Page } from 'playwright';
import { BrowserPool } from './browser-pool.js';
import { TeamCode } from '../types/agent.types.js';
import type { Logger } from 'winston';

/**
 * Context info for an agent
 */
interface AgentContextInfo {
  context: BrowserContext;
  page: Page;
  lastUsed: Date;
  cooldownTimer: NodeJS.Timeout | null;
}

/**
 * Agent page pool for smart context management
 * Limits active browser contexts to reduce memory usage
 */
export class AgentPagePool {
  private static instance: AgentPagePool | null = null;
  private maxActiveContexts: number = 4; // Max concurrent contexts
  private activeContexts: Map<TeamCode, AgentContextInfo> = new Map();

  private browserPool: BrowserPool;
  private logger: Logger | null = null;

  private constructor() {
    this.browserPool = BrowserPool.getInstance();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AgentPagePool {
    if (!AgentPagePool.instance) {
      AgentPagePool.instance = new AgentPagePool();
    }
    return AgentPagePool.instance;
  }

  /**
   * Initialize the page pool
   */
  initialize(logger: Logger, maxActive: number = 4): void {
    this.logger = logger;
    this.maxActiveContexts = maxActive;
    this.logger.info('Agent page pool initialized', {
      maxActiveContexts: this.maxActiveContexts,
    });
  }

  /**
   * Request context for an agent
   * If agent already has context → refresh lastUsed
   * If capacity available → create new context
   * If at capacity → close oldest, create new
   */
  async requestContext(teamCode: TeamCode, agentId: string): Promise<{ context: BrowserContext; page: Page }> {
    // If agent already has context, refresh and return
    const existing = this.activeContexts.get(teamCode);
    if (existing) {
      this.logger?.info('Agent already has context, refreshing', { teamCode });

      // Cancel cooldown timer if scheduled
      if (existing.cooldownTimer) {
        clearTimeout(existing.cooldownTimer);
        existing.cooldownTimer = null;
      }

      // Update last used timestamp
      existing.lastUsed = new Date();

      return { context: existing.context, page: existing.page };
    }

    // If at capacity, close oldest context
    if (this.activeContexts.size >= this.maxActiveContexts) {
      this.logger?.warn('At max capacity, closing oldest context', {
        current: this.activeContexts.size,
        max: this.maxActiveContexts,
      });
      await this.closeOldestContext();
    }

    // Create new context and page
    this.logger?.info('Creating new context for agent', { teamCode });

    const context = await this.browserPool.getContext(agentId);
    const page = await this.browserPool.getPage(agentId);

    // Store in active contexts
    this.activeContexts.set(teamCode, {
      context,
      page,
      lastUsed: new Date(),
      cooldownTimer: null,
    });

    this.logger?.info('Context created successfully', {
      teamCode,
      activeContexts: this.activeContexts.size,
    });

    return { context, page };
  }

  /**
   * Release context for an agent (with cooldown)
   * Schedule context closure after cooldown period
   */
  async releaseContext(teamCode: TeamCode, agentId: string, cooldownMs: number = 30000): Promise<void> {
    const contextInfo = this.activeContexts.get(teamCode);
    if (!contextInfo) {
      this.logger?.debug('No context to release', { teamCode });
      return;
    }

    // Cancel existing cooldown timer if any
    if (contextInfo.cooldownTimer) {
      clearTimeout(contextInfo.cooldownTimer);
    }

    this.logger?.info('Scheduling context release', {
      teamCode,
      cooldownMs,
    });

    // Schedule context closure
    contextInfo.cooldownTimer = setTimeout(async () => {
      try {
        this.logger?.info('Cooldown complete, closing context', { teamCode });

        // Release from browser pool
        await this.browserPool.releaseAgent(agentId);

        // Remove from active contexts
        this.activeContexts.delete(teamCode);

        this.logger?.info('Context released successfully', {
          teamCode,
          activeContexts: this.activeContexts.size,
        });
      } catch (error) {
        this.logger?.error('Error releasing context', { teamCode, error });
      }
    }, cooldownMs);
  }

  /**
   * Force release context immediately (no cooldown)
   */
  async forceReleaseContext(teamCode: TeamCode, agentId: string): Promise<void> {
    const contextInfo = this.activeContexts.get(teamCode);
    if (!contextInfo) {
      return;
    }

    // Cancel cooldown timer
    if (contextInfo.cooldownTimer) {
      clearTimeout(contextInfo.cooldownTimer);
    }

    this.logger?.info('Force releasing context', { teamCode });

    try {
      // Release from browser pool
      await this.browserPool.releaseAgent(agentId);

      // Remove from active contexts
      this.activeContexts.delete(teamCode);

      this.logger?.info('Context force released', {
        teamCode,
        activeContexts: this.activeContexts.size,
      });
    } catch (error) {
      this.logger?.error('Error force releasing context', { teamCode, error });
      throw error;
    }
  }

  /**
   * Close oldest context (LRU eviction)
   */
  private async closeOldestContext(): Promise<void> {
    if (this.activeContexts.size === 0) {
      return;
    }

    // Find least recently used context
    let oldestTeam: TeamCode | null = null;
    let oldestTime = new Date();

    for (const [teamCode, info] of this.activeContexts.entries()) {
      if (info.lastUsed < oldestTime) {
        oldestTime = info.lastUsed;
        oldestTeam = teamCode;
      }
    }

    if (!oldestTeam) {
      return;
    }

    this.logger?.info('Evicting oldest context', {
      teamCode: oldestTeam,
      lastUsed: oldestTime,
    });

    // Force release the oldest context
    // Note: agentId is same as teamCode in current implementation
    await this.forceReleaseContext(oldestTeam, oldestTeam);
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    activeContexts: number;
    maxActiveContexts: number;
    contexts: Array<{ teamCode: TeamCode; lastUsed: Date; hasCooldown: boolean }>;
  } {
    return {
      activeContexts: this.activeContexts.size,
      maxActiveContexts: this.maxActiveContexts,
      contexts: Array.from(this.activeContexts.entries()).map(([teamCode, info]) => ({
        teamCode,
        lastUsed: info.lastUsed,
        hasCooldown: info.cooldownTimer !== null,
      })),
    };
  }

  /**
   * Check if agent has active context
   */
  hasContext(teamCode: TeamCode): boolean {
    return this.activeContexts.has(teamCode);
  }

  /**
   * Cleanup all contexts
   */
  async cleanup(): Promise<void> {
    this.logger?.info('Cleaning up page pool');

    for (const [teamCode, info] of this.activeContexts.entries()) {
      // Cancel cooldown timers
      if (info.cooldownTimer) {
        clearTimeout(info.cooldownTimer);
      }

      try {
        // Release from browser pool (agentId = teamCode)
        await this.browserPool.releaseAgent(teamCode);
      } catch (error) {
        this.logger?.error(`Error cleaning up context for ${teamCode}`, { error });
      }
    }

    this.activeContexts.clear();
    this.logger?.info('Page pool cleanup complete');
  }
}
