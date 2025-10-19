import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BrowserConfig } from '../types/agent.types.js';
import type { Logger } from 'winston';

/**
 * Shared browser pool to reduce resource usage
 * Instead of 9 separate browsers, use 1 browser with 9 contexts
 */
export class BrowserPool {
  private static instance: BrowserPool | null = null;
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();
  private pages: Map<string, Page> = new Map();
  private config: BrowserConfig | null = null;
  private logger: Logger | null = null;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool();
    }
    return BrowserPool.instance;
  }

  /**
   * Initialize shared browser
   */
  async initialize(config: BrowserConfig, logger: Logger): Promise<void> {
    // If already initializing, wait for that to complete
    if (this.initPromise) {
      return this.initPromise;
    }

    // If already initialized, return
    if (this.browser) {
      return;
    }

    this.initPromise = this._doInitialize(config, logger);
    await this.initPromise;
    this.initPromise = null;
  }

  /**
   * Internal initialization
   */
  private async _doInitialize(config: BrowserConfig, logger: Logger): Promise<void> {
    this.config = config;
    this.logger = logger;

    this.logger.info('Initializing shared browser pool');

    this.browser = await chromium.launch({
      headless: config.headless,
      slowMo: config.slowMo,
      executablePath: config.executablePath || undefined,
      args: [
        '--disable-dev-shm-usage', // Reduce memory usage
        '--disable-gpu', // Disable GPU hardware acceleration
        '--no-sandbox', // Required for some environments
        '--disable-setuid-sandbox',
        '--disable-web-security', // Allow cross-origin requests
        '--disable-features=IsolateOrigins,site-per-process', // Reduce process overhead
      ],
    });

    this.logger.info('Shared browser pool initialized');
  }

  /**
   * Get or create browser context for an agent
   */
  async getContext(agentId: string): Promise<BrowserContext> {
    if (!this.browser) {
      throw new Error('Browser pool not initialized');
    }

    let context = this.contexts.get(agentId);
    if (!context) {
      this.logger?.info('Creating browser context for agent', { agentId });

      context = await this.browser.newContext({
        viewport: this.config?.viewport,
        // Optimize context settings for performance
        bypassCSP: true,
        ignoreHTTPSErrors: true,
        // CRITICAL: Isolate storage per agent to prevent team selection conflicts
        // Each agent gets its own localStorage/sessionStorage/cookies
        storageState: undefined,  // Fresh storage for each context
      });

      // Disable unnecessary features to save resources
      await context.route('**/*.{png,jpg,jpeg,gif,svg,webp,ico}', route => {
        // Block image loading to save bandwidth and memory (optional)
        // Uncomment if images aren't needed for automation
        // route.abort();
        route.continue();
      });

      this.contexts.set(agentId, context);
    }

    return context;
  }

  /**
   * Get or create page for an agent
   */
  async getPage(agentId: string): Promise<Page> {
    let page = this.pages.get(agentId);
    if (!page) {
      const context = await this.getContext(agentId);
      page = await context.newPage();

      // Set default timeout
      page.setDefaultTimeout(this.config?.timeout || 10000);

      // Listen to console messages (optional, can be disabled for performance)
      page.on('console', (msg) => {
        this.logger?.debug(`Browser console [${agentId}]: ${msg.text()}`);
      });

      // Listen to page errors
      page.on('pageerror', (error) => {
        this.logger?.error(`Browser page error [${agentId}]`, { error: error.message });
      });

      this.pages.set(agentId, page);
    }

    return page;
  }

  /**
   * Release resources for an agent
   */
  async releaseAgent(agentId: string): Promise<void> {
    this.logger?.info('Releasing browser resources for agent', { agentId });

    const page = this.pages.get(agentId);
    if (page) {
      await page.close();
      this.pages.delete(agentId);
    }

    const context = this.contexts.get(agentId);
    if (context) {
      await context.close();
      this.contexts.delete(agentId);
    }
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    this.logger?.info('Cleaning up browser pool');

    // Close all pages
    for (const [agentId, page] of this.pages.entries()) {
      try {
        await page.close();
      } catch (error) {
        this.logger?.error(`Error closing page for ${agentId}`, { error });
      }
    }
    this.pages.clear();

    // Close all contexts
    for (const [agentId, context] of this.contexts.entries()) {
      try {
        await context.close();
      } catch (error) {
        this.logger?.error(`Error closing context for ${agentId}`, { error });
      }
    }
    this.contexts.clear();

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.logger?.info('Browser pool cleaned up');
  }

  /**
   * Check if browser is connected
   */
  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  /**
   * Get browser instance (for advanced usage)
   */
  getBrowser(): Browser {
    if (!this.browser) {
      throw new Error('Browser pool not initialized');
    }
    return this.browser;
  }
}
