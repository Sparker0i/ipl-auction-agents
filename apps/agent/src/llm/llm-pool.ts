import { OllamaClient } from './ollama-client.js';
import { LLMConfig } from '../types/llm.types.js';
import type { Logger } from 'winston';

/**
 * LLM connection pool for shared warmup and connection reuse
 */
export class LLMPool {
  private static instance: LLMPool | null = null;
  private client: OllamaClient | null = null;
  private warmupPromise: Promise<void> | null = null;
  private isWarmedUp: boolean = false;
  private logger: Logger | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): LLMPool {
    if (!LLMPool.instance) {
      LLMPool.instance = new LLMPool();
    }
    return LLMPool.instance;
  }

  /**
   * Initialize LLM pool with shared client
   */
  async initialize(config: LLMConfig, logger: Logger): Promise<void> {
    if (this.client) {
      return; // Already initialized
    }

    this.logger = logger;

    this.logger.info('Initializing shared LLM pool');

    this.client = new OllamaClient(config, logger);

    this.logger.info('Shared LLM pool initialized');
  }

  /**
   * Warmup LLM model (shared across all agents)
   */
  async warmup(): Promise<void> {
    // If already warmed up, return immediately
    if (this.isWarmedUp) {
      this.logger?.debug('LLM already warmed up');
      return;
    }

    // If warmup is in progress, wait for it
    if (this.warmupPromise) {
      this.logger?.debug('Waiting for ongoing LLM warmup');
      return this.warmupPromise;
    }

    // Start warmup
    this.logger?.info('Starting shared LLM warmup');
    this.warmupPromise = this._doWarmup();

    try {
      await this.warmupPromise;
      this.isWarmedUp = true;
      this.logger?.info('Shared LLM warmup completed');
    } finally {
      this.warmupPromise = null;
    }
  }

  /**
   * Internal warmup implementation
   */
  private async _doWarmup(): Promise<void> {
    if (!this.client) {
      throw new Error('LLM pool not initialized');
    }

    try {
      await this.client.warmupModel();
    } catch (error) {
      this.logger?.error('LLM warmup failed', { error });
      throw error;
    }
  }

  /**
   * Get shared LLM client
   */
  getClient(): OllamaClient {
    if (!this.client) {
      throw new Error('LLM pool not initialized');
    }
    return this.client;
  }

  /**
   * Check if LLM is available
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    return await this.client.isAvailable();
  }

  /**
   * Check if warmed up
   */
  isReady(): boolean {
    return this.isWarmedUp;
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger?.info('Cleaning up LLM pool');

    // Reset state
    this.client = null;
    this.isWarmedUp = false;
    this.warmupPromise = null;

    this.logger?.info('LLM pool cleaned up');
  }
}
