import { OllamaClient } from './ollama-client.js';
import { LLMConfig } from '../types/llm.types.js';
import type { Logger } from 'winston';

/**
 * Queued request
 */
interface QueuedRequest<T> {
  teamCode: string;
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
}

/**
 * LLM connection pool for shared warmup, connection reuse, and request queuing
 */
export class LLMPool {
  private static instance: LLMPool | null = null;
  private client: OllamaClient | null = null;
  private warmupPromise: Promise<void> | null = null;
  private isWarmedUp: boolean = false;
  private logger: Logger | null = null;
  private requestQueue: QueuedRequest<any>[] = [];
  private activeRequests: number = 0;
  private maxConcurrent: number = 9; // Default to 9, matches OLLAMA_NUM_PARALLEL

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

    // Read OLLAMA_NUM_PARALLEL from environment
    const ollamaParallel = process.env.OLLAMA_NUM_PARALLEL;
    if (ollamaParallel) {
      this.maxConcurrent = parseInt(ollamaParallel, 10);
      this.logger.info('LLM max concurrent requests set from OLLAMA_NUM_PARALLEL', {
        maxConcurrent: this.maxConcurrent,
      });
    } else {
      this.logger.info('LLM max concurrent requests using default', {
        maxConcurrent: this.maxConcurrent,
      });
    }

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
   * Queue an LLM request for fair processing
   */
  async queueRequest<T>(teamCode: string, fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ teamCode, fn, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    while (this.activeRequests < this.maxConcurrent && this.requestQueue.length > 0) {
      const request = this.requestQueue.shift()!;
      this.activeRequests++;

      this.logger?.debug(`Processing LLM request for ${request.teamCode}`, {
        queueLength: this.requestQueue.length,
        active: this.activeRequests,
        maxConcurrent: this.maxConcurrent,
      });

      // Process request asynchronously
      (async () => {
        try {
          const result = await request.fn();
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        } finally {
          this.activeRequests--;
          this.processQueue(); // Process next in queue
        }
      })();
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    queueLength: number;
    activeRequests: number;
    maxConcurrent: number;
  } {
    return {
      queueLength: this.requestQueue.length,
      activeRequests: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger?.info('Cleaning up LLM pool', {
      queuedRequests: this.requestQueue.length,
      activeRequests: this.activeRequests,
    });

    // Wait for active requests to complete
    while (this.activeRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clear queue
    this.requestQueue = [];

    // Reset state
    this.client = null;
    this.isWarmedUp = false;
    this.warmupPromise = null;

    this.logger?.info('LLM pool cleaned up');
  }
}
