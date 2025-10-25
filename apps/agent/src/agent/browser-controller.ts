import { Browser, Page, ElementHandle } from 'playwright';
import { BrowserConfig, IBrowserController } from '../types/agent.types.js';
import { BrowserPool } from '../orchestrator/browser-pool.js';
import type { Logger } from 'winston';

/**
 * Browser controller for Playwright automation
 * Uses shared browser pool for resource efficiency
 */
export class BrowserController implements IBrowserController {
  private page: Page | null = null;
  private config: BrowserConfig;
  private logger: Logger;
  private agentId: string;
  private browserPool: BrowserPool;

  constructor(config: BrowserConfig, logger: Logger, agentId?: string) {
    this.config = config;
    this.logger = logger;
    this.agentId = agentId || `agent-${Date.now()}-${Math.random()}`;
    this.browserPool = BrowserPool.getInstance();
  }

  /**
   * Launch browser (uses shared pool)
   */
  async launch(): Promise<void> {
    try {
      this.logger.info('Initializing browser context from pool', {
        agentId: this.agentId,
        headless: this.config.headless,
        viewport: this.config.viewport,
      });

      // Initialize shared browser pool
      await this.browserPool.initialize(this.config, this.logger);

      // Get dedicated page from pool
      this.page = await this.browserPool.getPage(this.agentId);

      // Listen to request failures
      this.page.on('requestfailed', (request) => {
        this.logger.warn('Request failed', {
          url: request.url(),
          failure: request.failure()?.errorText,
        });
      });

      this.logger.info('Browser context initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize browser context', { error });
      throw error;
    }
  }

  /**
   * Navigate to URL
   */
  async navigate(url: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched. Call launch() first.');
    }

    try {
      this.logger.info('Navigating to URL', { url });

      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
      });

      this.logger.info('Navigation successful', { url });
    } catch (error) {
      this.logger.error('Navigation failed', { url, error });
      throw error;
    }
  }

  /**
   * Close browser (releases resources to pool)
   */
  async close(): Promise<void> {
    try {
      this.logger.info('Releasing browser resources to pool', { agentId: this.agentId });

      // Release agent resources back to pool
      await this.browserPool.releaseAgent(this.agentId);

      this.page = null;

      this.logger.info('Browser resources released successfully');
    } catch (error) {
      this.logger.error('Error releasing browser resources', { error });
      throw error;
    }
  }

  /**
   * Get page instance
   */
  getPage(): Page {
    if (!this.page) {
      throw new Error('Browser not launched or page not available');
    }
    return this.page;
  }

  /**
   * Get browser instance
   */
  getBrowser(): Browser {
    return this.browserPool.getBrowser();
  }

  /**
   * Check if browser is connected
   */
  isConnected(): boolean {
    return this.browserPool.isConnected();
  }

  /**
   * Wait for selector
   */
  async waitForSelector(
    selector: string,
    options?: { timeout?: number }
  ): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.waitForSelector(selector, {
      timeout: options?.timeout || this.config.timeout,
    });
  }

  /**
   * Click element
   */
  async click(selector: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.click(selector);
  }

  /**
   * Type text
   */
  async type(selector: string, text: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.type(selector, text);
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate<T>(pageFunction: () => T): Promise<T> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    return await this.page.evaluate(pageFunction);
  }

  /**
   * Expose function to page
   */
  async exposeFunction(
    name: string,
    callback: (...args: any[]) => any
  ): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.exposeFunction(name, callback);
  }

  /**
   * Take screenshot (for debugging)
   */
  async screenshot(path: string): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    await this.page.screenshot({ path });
    this.logger.debug('Screenshot saved', { path });
  }

  /**
   * Finds an element by trying a list of selectors in order.
   * Returns the first element found.
   */
  async findElement(
    selectors: string[]
  ): Promise<ElementHandle | null> {
    if (!this.page) {
      throw new Error('Browser not launched');
    }

    for (const selector of selectors) {
      try {
        const element = await this.page.$(selector);
        if (element) {
          this.logger.debug('Element found with selector', { selector });
          return element;
        }
      } catch (error) {
        this.logger.warn('Error with selector, trying next', { selector, error });
      }
    }
    return null;
  }
}
