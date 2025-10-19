import { IErrorRecovery } from '../types/agent.types.js';
import { AuctionAgent } from './agent.js';
import type { Logger } from 'winston';

/**
 * Error recovery and retry logic
 */
export class ErrorRecovery implements IErrorRecovery {
  private agent: AuctionAgent;
  private logger: Logger;
  private retryCount: number = 0;
  private maxRetries: number = 3;
  private retryDelay: number = 5000; // 5 seconds

  constructor(agent: AuctionAgent, logger: Logger, maxRetries: number = 3) {
    this.agent = agent;
    this.logger = logger;
    this.maxRetries = maxRetries;
  }

  /**
   * Handle browser crash
   */
  async handleBrowserCrash(): Promise<void> {
    this.logger.error('Browser crash detected');

    if (this.retryCount >= this.maxRetries) {
      this.logger.error('Max retries reached for browser crash', {
        retryCount: this.retryCount,
      });
      throw new Error('Max retries reached - cannot recover from browser crash');
    }

    try {
      this.retryCount++;
      this.logger.info('Attempting to restart agent', {
        attempt: this.retryCount,
        maxRetries: this.maxRetries,
      });

      // Wait before retry
      await this.sleep(this.retryDelay);

      // Cleanup current instance
      await this.agent.cleanup();

      // Reinitialize agent
      await this.agent.initialize();

      this.logger.info('Agent restarted successfully');
      this.resetRetryCount();
    } catch (error) {
      this.logger.error('Failed to restart agent', { error, retryCount: this.retryCount });
      throw error;
    }
  }

  /**
   * Handle socket disconnect
   */
  async handleSocketDisconnect(): Promise<void> {
    this.logger.warn('Socket disconnect detected');

    try {
      // Wait for potential reconnection
      await this.waitForReconnection(30000); // Wait up to 30 seconds

      this.logger.info('Socket reconnected');
    } catch (error) {
      this.logger.error('Socket reconnection failed', { error });

      // Try browser recovery
      await this.handleBrowserCrash();
    }
  }

  /**
   * Handle navigation error
   */
  async handleNavigationError(error: Error): Promise<void> {
    this.logger.error('Navigation error', { error: error.message });

    if (this.shouldRetry(error)) {
      if (this.retryCount >= this.maxRetries) {
        throw new Error('Max retries reached for navigation error');
      }

      this.retryCount++;
      this.logger.info('Retrying navigation', { attempt: this.retryCount });

      await this.sleep(this.retryDelay);

      // Navigation will be retried by caller
    } else {
      throw error;
    }
  }

  /**
   * Wait for socket reconnection
   */
  private async waitForReconnection(timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        // Check if socket is connected via page evaluation
        const page = (this.agent as any).browserController?.getPage();

        if (page) {
          const isConnected = await page.evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (globalThis as any).__socketConnected === true;
          });

          if (isConnected) {
            return; // Successfully reconnected
          }
        }
      } catch (error) {
        // Ignore errors during check
      }

      await this.sleep(1000); // Check every second
    }

    throw new Error('Socket reconnection timeout');
  }

  /**
   * Determine if error is retryable
   */
  shouldRetry(error: Error): boolean {
    const retryableErrors = [
      'Navigation timeout',
      'net::ERR_CONNECTION_REFUSED',
      'net::ERR_NAME_NOT_RESOLVED',
      'Target closed',
      'Protocol error',
    ];

    return retryableErrors.some((msg) =>
      error.message.toLowerCase().includes(msg.toLowerCase())
    );
  }

  /**
   * Get current retry count
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Reset retry count
   */
  resetRetryCount(): void {
    this.retryCount = 0;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Handle general errors with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.info(`Retrying ${operationName}`, {
            attempt,
            maxRetries: this.maxRetries,
          });
          await this.sleep(this.retryDelay * attempt); // Exponential backoff
        }

        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (!this.shouldRetry(lastError)) {
          // Non-retryable error
          throw lastError;
        }

        this.logger.warn(`${operationName} failed, will retry`, {
          attempt,
          error: lastError.message,
        });
      }
    }

    throw lastError || new Error(`${operationName} failed after ${this.maxRetries} retries`);
  }
}
