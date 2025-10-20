import {
  IAuctionAgent,
  AgentConfig,
  AgentInternalState,
  AgentStatus,
  PlayerInAuction,
  Player,
  DecisionLog,
  PlayerRole,
} from '../types/agent.types.js';
import { BrowserController } from './browser-controller.js';
import { StateManager } from './state-manager.js';
import { DecisionEngine } from '../strategy/decision-engine.js';
import { TeamStrategy, SquadAnalysis, BudgetPhase } from '../types/strategy.types.js';
import type { Logger } from 'winston';

/**
 * Main auction agent class
 */
export class AuctionAgent implements IAuctionAgent {
  private config: AgentConfig;
  private logger: Logger;
  private browserController: BrowserController;
  private stateManager: StateManager;
  private decisionEngine: DecisionEngine | null = null;
  private strategy: TeamStrategy | null = null;
  private status: AgentStatus = 'initializing';
  private teamId: string | null = null;
  private decisions: DecisionLog[] = [];
  private stateCheckInterval: NodeJS.Timeout | null = null;
  private currentPlayerId: string | null = null; // Track current player to prevent duplicate processing
  private processingPlayer: boolean = false; // Lock to prevent concurrent processing
  private squadAnalysisCache: { key: string; result: SquadAnalysis } | null = null; // Memoization cache
  private currentSyncInterval: number; // Dynamic sync interval
  private isActiveBidding: boolean = false; // Track if actively bidding

  constructor(
    config: AgentConfig,
    logger: Logger,
    decisionEngine?: DecisionEngine,
    strategy?: TeamStrategy
  ) {
    this.config = config;
    this.logger = logger;
    // Pass teamCode as agentId for browser pooling
    this.browserController = new BrowserController(config.browser, logger, config.teamCode);
    // CRITICAL: Use team-specific budget from database, fallback to default 120cr only if not provided
    const initialBudget = config.initialBudgetLakh ?? 12000;
    this.logger.info('Agent budget initialized', {
      teamCode: config.teamCode,
      initialBudgetLakh: initialBudget,
      initialBudgetCr: (initialBudget / 100).toFixed(2),
      source: config.initialBudgetLakh ? 'database' : 'default',
    });
    this.stateManager = new StateManager(initialBudget, logger);
    this.decisionEngine = decisionEngine || null;
    this.strategy = strategy || null;
    this.currentSyncInterval = config.stateCheckIntervalMs; // Start with config default
  }

  /**
   * Initialize agent
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing agent', {
        teamCode: this.config.teamCode,
        auctionCode: this.config.auctionCode,
      });

      this.status = 'initializing';

      // Launch browser
      await this.browserController.launch();

      // Navigate to auction lobby
      const lobbyUrl = `${this.config.frontendUrl}/lobby/${this.config.auctionCode}`;
      await this.browserController.navigate(lobbyUrl);

      // Wait a bit for page to load
      await this.sleep(2000);

      // Select team
      await this.selectTeam(this.config.teamCode);

      // Wait for auction to start
      await this.waitForAuctionStart();

      // Start monitoring auction
      await this.monitorAuction();

      this.logger.info('Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize agent', { error });
      this.status = 'error';
      throw error;
    }
  }

  /**
   * Select team in auction (with retry logic)
   */
  async selectTeam(teamName: string): Promise<void> {
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info('Selecting team', { teamName, attempt, maxRetries });

        const page = this.browserController.getPage();

        // Wait for teams grid to be visible
        await page.waitForSelector('.grid', { timeout: 10000 });
        this.logger.info('Team grid loaded');

        // Wait a bit for all teams to render (longer on retry)
        await this.sleep(1000 + (attempt - 1) * 1000);

        // Find and click the team card div containing the team name
        const clicked = await page.evaluate((targetTeamName) => {
          // Find all h3 elements (team names)
          const teamHeaders = Array.from((globalThis as any).document.querySelectorAll('h3'));

          // Find the h3 with matching team name
          const teamHeader = teamHeaders.find((h3: any) => h3.textContent?.trim() === targetTeamName);

          if (!teamHeader) {
            return false;
          }

          // Find the clickable parent div (the team card)
          // It should be a div with border-2 class
          let parentDiv = (teamHeader as any).closest('div.border-2');

          if (!parentDiv) {
            return false;
          }

          // Check if team is already taken (has opacity-60 or is owned)
          const isTaken = parentDiv.classList.contains('opacity-60');
          if (isTaken) {
            return false;
          }

          // Click the team card
          parentDiv.click();
          return true;
        }, teamName);

        if (!clicked) {
          lastError = new Error(`Team ${teamName} not found or already taken`);
          this.logger.warn('Team selection failed, will retry', { teamName, attempt });

          if (attempt < maxRetries) {
            // Reload page before retry
            await page.reload({ waitUntil: 'domcontentloaded' });
            await this.sleep(2000);
            continue;
          } else {
            throw lastError;
          }
        }

        this.logger.info('Team card clicked', { teamName });

        // Wait for join to complete (check for "Your Team" section or success indication)
        // The page should show the selected team info
        await this.sleep(2000);

        // Try to extract team ID from local storage or page
        const teamId = await page.evaluate((auctionCode) => {
          const storageKey = `teamId_${auctionCode}`;
          return localStorage.getItem(storageKey) || null;
        }, this.config.auctionCode);

        if (teamId) {
          this.teamId = teamId;
          this.logger.info('Team selected successfully', { teamName, teamId, attempt });
          return; // Success!
        } else {
          // Still set a placeholder - we can check if it worked
          this.logger.warn('Team ID not found in storage, assuming selection worked');
          return; // Assume success
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.error('Failed to select team', { teamName, attempt, error });

        if (attempt < maxRetries) {
          this.logger.info('Retrying team selection after delay', { teamName, attempt });
          await this.sleep(2000);
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error(`Failed to select team ${teamName} after ${maxRetries} attempts`);
  }

  /**
   * Wait for auction to start
   */
  async waitForAuctionStart(): Promise<void> {
    try {
      this.logger.info('Waiting for auction to start');
      this.status = 'waiting';

      const page = this.browserController.getPage();

      // Wait for auction start indicator
      // Note: This can take several minutes, longer than heartbeat timeout
      // The heartbeat interval will keep sending updates during this wait
      await page.waitForSelector('[data-auction-started]', {
        timeout: 300000, // 5 minutes
      });

      this.status = 'active';
      this.logger.info('Auction has started');
    } catch (error) {
      this.logger.error('Failed waiting for auction start', { error });
      throw error;
    }
  }

  /**
   * Start monitoring auction state
   */
  async monitorAuction(): Promise<void> {
    try {
      this.logger.info('Starting auction monitoring');

      const page = this.browserController.getPage();

      // Setup WebSocket event listeners via page evaluation
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const win = globalThis as any;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-player-update', (event: any) => {
          if (win.__notifyNodePlayer) {
            win.__notifyNodePlayer(event.detail);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-bid-update', (event: any) => {
          if (win.__notifyNodeBid) {
            win.__notifyNodeBid(event.detail);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-player-sold', (event: any) => {
          if (win.__notifyNodeSold) {
            win.__notifyNodeSold(event.detail);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-player-unsold', (event: any) => {
          if (win.__notifyNodeUnsold) {
            win.__notifyNodeUnsold(event.detail);
          }
        });

        // RTM event listeners
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-rtm-triggered', (event: any) => {
          if (win.__notifyNodeRTMTriggered) {
            win.__notifyNodeRTMTriggered(event.detail);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-rtm-used', (event: any) => {
          if (win.__notifyNodeRTMUsed) {
            win.__notifyNodeRTMUsed(event.detail);
          }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        win.addEventListener('auction-rtm-counter-bid', (event: any) => {
          if (win.__notifyNodeRTMCounterBid) {
            win.__notifyNodeRTMCounterBid(event.detail);
          }
        });
      });

      // Expose callbacks to page
      await this.browserController.exposeFunction(
        '__notifyNodePlayer',
        this.handleNewPlayer.bind(this)
      );

      await this.browserController.exposeFunction(
        '__notifyNodeBid',
        this.handleBidUpdate.bind(this)
      );

      await this.browserController.exposeFunction(
        '__notifyNodeSold',
        this.handlePlayerSold.bind(this)
      );

      await this.browserController.exposeFunction(
        '__notifyNodeUnsold',
        this.handlePlayerUnsold.bind(this)
      );

      // Expose RTM callbacks
      await this.browserController.exposeFunction(
        '__notifyNodeRTMTriggered',
        this.handleRTMTriggered.bind(this)
      );

      await this.browserController.exposeFunction(
        '__notifyNodeRTMUsed',
        this.handleRTMUsed.bind(this)
      );

      await this.browserController.exposeFunction(
        '__notifyNodeRTMCounterBid',
        this.handleRTMCounterBid.bind(this)
      );

      // Start periodic state sync as fallback
      this.startPeriodicStateSync();

      this.logger.info('Auction monitoring started');
    } catch (error) {
      this.logger.error('Failed to setup auction monitoring', { error });
      throw error;
    }
  }

  /**
   * Start periodic state synchronization with dynamic intervals
   */
  private startPeriodicStateSync(): void {
    this.stateCheckInterval = setInterval(async () => {
      try {
        const page = this.browserController.getPage();
        await this.stateManager.syncState(page);

        // Adjust sync interval based on auction activity
        this.adjustSyncInterval();
      } catch (error) {
        this.logger.error('State sync failed', { error });
      }
    }, this.currentSyncInterval);

    this.logger.debug('Periodic state sync started', {
      intervalMs: this.currentSyncInterval,
    });
  }

  /**
   * Dynamically adjust state sync interval based on auction activity
   */
  private adjustSyncInterval(): void {
    const currentPlayer = this.stateManager.getCurrentPlayer();

    // Determine if we're in active bidding phase
    const hasActivePlayer = currentPlayer !== null;
    const wasActiveBidding = this.isActiveBidding;
    this.isActiveBidding = hasActivePlayer;

    // Calculate optimal interval
    let optimalInterval: number;

    if (hasActivePlayer) {
      // Active bidding: fast sync (500ms)
      optimalInterval = 500;
    } else {
      // Waiting for next player: slower sync (2000ms)
      optimalInterval = 2000;
    }

    // Only restart timer if interval changed significantly (>500ms difference)
    if (Math.abs(optimalInterval - this.currentSyncInterval) > 500) {
      this.currentSyncInterval = optimalInterval;

      // Restart the interval with new timing
      if (this.stateCheckInterval) {
        clearInterval(this.stateCheckInterval);
        this.startPeriodicStateSync();

        this.logger.debug('State sync interval adjusted', {
          oldInterval: wasActiveBidding ? 500 : 2000,
          newInterval: optimalInterval,
          hasActivePlayer,
        });
      }
    }
  }

  /**
   * Handle new player event
   */
  private async handleNewPlayer(playerData: any): Promise<void> {
    try {
      // Deduplication: Check if this is the same player as currently being processed
      if (this.currentPlayerId === playerData.id) {
        this.logger.debug('Duplicate player event ignored', { playerId: playerData.id, playerName: playerData.name });
        return;
      }

      // Prevent concurrent processing of multiple events
      if (this.processingPlayer) {
        this.logger.debug('Already processing a player, ignoring event', { playerId: playerData.id, playerName: playerData.name });
        return;
      }

      this.logger.info('New player presented', { player: playerData });

      // Set lock and current player ID
      this.processingPlayer = true;
      this.currentPlayerId = playerData.id;

      const player: PlayerInAuction = {
        id: playerData.id,
        name: playerData.name,
        role: playerData.role,
        country: playerData.country,
        basePrice: playerData.basePrice || playerData.base_price || playerData.basePriceLakh,
        isCapped: playerData.isCapped || playerData.is_capped,
        isOverseas: playerData.isOverseas || playerData.is_overseas,
      };

      // Update state
      this.stateManager.setCurrentPlayer(player, player.basePrice);

      // Make decision
      this.status = 'thinking';
      const decision = await this.makeDecision(player);

      // Log decision
      this.logDecision(player, decision);

      // Place bid if decision is to bid
      if (decision.shouldBid && decision.maxBid) {
        await this.placeBid(decision.maxBid);
      }

      this.status = 'active';
    } catch (error) {
      this.logger.error('Error handling new player', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        playerData,
      });
    } finally {
      // Release lock but keep currentPlayerId to prevent re-processing same player
      this.processingPlayer = false;
    }
  }

  /**
   * Handle bid update event
   */
  private async handleBidUpdate(bidData: any): Promise<void> {
    try {
      // Extract current bid amount (backend sends bidAmountLakh, not currentBidLakh)
      const currentBidLakh = bidData.bidAmountLakh || bidData.currentBidLakh;

      this.logger.info('Bid update received', {
        player: bidData.playerName,
        biddingTeam: bidData.biddingTeamName,
        currentBid: currentBidLakh,
      });

      // Ignore if not currently processing this player
      if (!this.currentPlayerId || this.currentPlayerId !== bidData.playerId) {
        this.logger.debug('Bid update for different player, ignoring');
        return;
      }

      // Ignore if I'm the one who placed this bid
      if (bidData.biddingTeamId === this.teamId || bidData.teamId === this.teamId) {
        this.logger.debug('My own bid, no counter-bid needed');
        return;
      }

      // Ignore if already processing a counter-bid decision
      if (this.processingPlayer) {
        this.logger.debug('Already processing counter-bid, ignoring');
        return;
      }

      // Validate currentBidLakh exists
      if (!currentBidLakh) {
        this.logger.warn('No bid amount in bid update, ignoring', { bidData });
        return;
      }

      // Update state with new current bid
      this.stateManager.updateCurrentBid(currentBidLakh);

      // Set processing lock
      this.processingPlayer = true;

      // Get current player info
      const currentPlayer = this.stateManager.getCurrentPlayer();
      if (!currentPlayer) {
        this.logger.warn('No current player in state, cannot counter-bid');
        this.processingPlayer = false;
        return;
      }

      // Re-evaluate if we want to counter-bid at this new price
      this.logger.info('Evaluating counter-bid', {
        player: currentPlayer.name,
        currentBid: currentBidLakh,
      });

      const decision = await this.makeDecision(currentPlayer);

      // Log counter-bid decision
      this.logger.info('Counter-bid decision', {
        player: currentPlayer.name,
        shouldBid: decision.shouldBid,
        maxBid: decision.maxBid,
        currentBid: currentBidLakh,
        reasoning: decision.reasoning,
      });

      // Place counter-bid if decision is to bid AND new bid is higher than current
      if (decision.shouldBid && decision.maxBid && decision.maxBid > currentBidLakh) {
        // Calculate next bid with dynamic increment based on current price
        const increment = this.calculateBidIncrement(currentBidLakh);
        const nextBid = currentBidLakh + increment;

        // Only bid if next bid is within our max
        if (nextBid <= decision.maxBid) {
          this.logger.info('Placing counter-bid', {
            player: currentPlayer.name,
            currentBid: bidData.currentBidLakh,
            increment,
            counterBid: nextBid,
            maxBid: decision.maxBid,
          });
          await this.placeBid(nextBid);
        } else {
          this.logger.info('Counter-bid exceeds max bid, passing', {
            player: currentPlayer.name,
            nextBid,
            maxBid: decision.maxBid,
          });
        }
      } else {
        this.logger.info('Not counter-bidding', {
          player: currentPlayer.name,
          reason: decision.shouldBid ? 'Current bid exceeds our max' : 'AI decided to pass',
        });
      }

      // Release processing lock
      this.processingPlayer = false;
    } catch (error) {
      this.logger.error('Error handling bid update', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.processingPlayer = false;
    }
  }

  /**
   * Calculate dynamic bid increment based on current bid amount
   * As per PRD FR-5 specifications:
   * - ₹30L - ₹1cr: increment ₹5L
   * - ₹1cr - ₹2cr: increment ₹10L
   * - ₹2cr - ₹5cr: increment ₹20L
   * - ₹5cr+: increment ₹25L
   */
  private calculateBidIncrement(currentBidLakh: number): number {
    // Convert lakhs to crores for easier comparison
    const currentBidCr = currentBidLakh / 100;

    if (currentBidCr < 1) {
      return 5; // ₹30L - ₹1cr: increment ₹5L
    } else if (currentBidCr < 2) {
      return 10; // ₹1cr - ₹2cr: increment ₹10L
    } else if (currentBidCr < 5) {
      return 20; // ₹2cr - ₹5cr: increment ₹20L
    } else {
      return 25; // ₹5cr+: increment ₹25L
    }
  }

  /**
   * Handle player sold event
   */
  private handlePlayerSold(soldData: any): void {
    try {
      this.logger.info('Player sold', { soldData });

      // If we won the player, add to squad
      if (soldData.teamId === this.teamId) {
        const player: Player = {
          id: soldData.playerId,
          name: soldData.playerName,
          role: soldData.role,
          country: soldData.country,
          price: soldData.price,
          isCapped: soldData.isCapped,
          isOverseas: soldData.isOverseas,
        };

        this.stateManager.addPlayer(player);

        // CRITICAL: Invalidate squad analysis cache when we acquire a player
        // This ensures fresh budget calculations for next player
        this.squadAnalysisCache = null;
        this.logger.info('Squad analysis cache invalidated after player acquisition', {
          player: player.name,
          price: player.price,
        });

        this.logger.info('Won player', {
          player: player.name,
          price: player.price,
          squadSize: this.stateManager.getSquadSize(),
          budget: this.stateManager.getBudget(),
        });
      }

      // Reset current player
      this.stateManager.resetCurrentPlayer();

      // Reset current player ID to allow processing next player
      this.currentPlayerId = null;
      this.processingPlayer = false;
    } catch (error) {
      this.logger.error('Error handling player sold', { error });
    }
  }

  /**
   * Handle player unsold event
   */
  private handlePlayerUnsold(unsoldData: any): void {
    try {
      this.logger.info('Player unsold', { player: unsoldData.playerName });

      // Reset current player
      this.stateManager.resetCurrentPlayer();

      // Reset current player ID to allow processing next player
      this.currentPlayerId = null;
      this.processingPlayer = false;
    } catch (error) {
      this.logger.error('Error handling player unsold', { error });
    }
  }

  /**
   * Make bid decision using AI DecisionEngine
   */
  async makeDecision(
    player: PlayerInAuction
  ): Promise<{ shouldBid: boolean; maxBid?: number; reasoning?: string }> {
    // If DecisionEngine is available, use AI-powered decision
    if (this.decisionEngine && this.strategy) {
      try {
        const squadAnalysis = this.getSquadAnalysis();
        const decision = await this.decisionEngine.makeDecision(player, squadAnalysis);

        this.logger.info('AI Decision made', {
          player: player.name,
          decision: decision.shouldBid ? 'BID' : 'PASS',
          maxBid: decision.maxBid,
          reasoning: decision.reasoning,
        });

        return {
          shouldBid: decision.shouldBid,
          maxBid: decision.maxBid,
          reasoning: decision.reasoning,
        };
      } catch (error) {
        this.logger.error('AI decision failed, using fallback', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          player: player.name,
        });
        // Fall through to fallback logic
      }
    }

    // Fallback: Simple rule-based decision
    this.logger.warn('Using fallback decision logic (no AI available)');

    const budget = this.stateManager.getBudget();
    const squadSize = this.stateManager.getSquadSize();
    const overseasCount = this.stateManager.getOverseasCount();

    // Basic constraints
    if (budget <= 290) {
      this.logger.info('Decision: PASS - Insufficient budget');
      return { shouldBid: false, reasoning: 'Insufficient budget (fallback)' };
    }

    if (squadSize >= 25) {
      this.logger.info('Decision: PASS - Squad full');
      return { shouldBid: false, reasoning: 'Squad full (fallback)' };
    }

    if (player.isOverseas && overseasCount >= 8) {
      this.logger.info('Decision: PASS - Overseas quota full');
      return { shouldBid: false, reasoning: 'Overseas quota full (fallback)' };
    }

    // Simple decision: bid base price + 20% for now
    const maxBid = Math.floor(player.basePrice * 1.2);

    if (this.stateManager.canAfford(maxBid)) {
      this.logger.info('Decision: BID', { maxBid });
      return { shouldBid: true, maxBid, reasoning: 'Value bid at base+20% (fallback)' };
    }

    this.logger.info('Decision: PASS - Cannot afford');
    return { shouldBid: false, reasoning: 'Cannot afford (fallback)' };
  }

  /**
   * Convert current state to SquadAnalysis for DecisionEngine (with memoization)
   */
  private getSquadAnalysis(): SquadAnalysis {
    const squad = this.stateManager.getSquad();
    const budget = this.stateManager.getBudget();
    const squadSize = this.stateManager.getSquadSize();

    // CRITICAL: Create cache key with budget granularity to detect budget changes
    // Round budget to nearest 100L (1cr) to avoid excessive cache misses
    const budgetRounded = Math.floor(budget / 100) * 100;
    const cacheKey = `${squadSize}_${budgetRounded}`;

    // Check if we have a cached result
    if (this.squadAnalysisCache?.key === cacheKey) {
      this.logger.debug('Squad analysis cache hit', { cacheKey });
      return this.squadAnalysisCache.result;
    }

    this.logger.debug('Squad analysis cache miss, recalculating', {
      cacheKey,
      actualBudget: budget,
      squadSize
    });

    const overseasCount = this.stateManager.getOverseasCount();

    // Count players by role
    const roleDistribution: Record<PlayerRole, number> = {
      BATTER: 0,
      BOWLER: 0,
      'ALL-ROUNDER': 0,
      WICKETKEEPER: 0,
    };

    squad.forEach((player) => {
      roleDistribution[player.role] = (roleDistribution[player.role] || 0) + 1;
    });

    // Calculate role gaps based on strategy (if available)
    const roleGaps: Record<PlayerRole, number> = {
      BATTER: 0,
      BOWLER: 0,
      'ALL-ROUNDER': 0,
      WICKETKEEPER: 0,
    };

    if (this.strategy) {
      const targetBatters = Math.floor((this.strategy.roleDistribution.batters / 100) * 25);
      const targetBowlers = Math.floor((this.strategy.roleDistribution.bowlers / 100) * 25);
      const targetAllRounders = Math.floor((this.strategy.roleDistribution.allRounders / 100) * 25);
      const targetWicketkeepers = Math.floor((this.strategy.roleDistribution.wicketkeepers / 100) * 25);

      roleGaps.BATTER = targetBatters - roleDistribution.BATTER;
      roleGaps.BOWLER = targetBowlers - roleDistribution.BOWLER;
      roleGaps['ALL-ROUNDER'] = targetAllRounders - roleDistribution['ALL-ROUNDER'];
      roleGaps.WICKETKEEPER = targetWicketkeepers - roleDistribution.WICKETKEEPER;
    }

    // Determine auction phase
    const phase: BudgetPhase = squadSize < 11 ? 'early' : squadSize < 20 ? 'mid' : 'late';

    // Calculate budget per remaining slot
    const remainingSlots = Math.max(1, 25 - squadSize);
    const budgetPerSlot = budget / remainingSlots;

    const result: SquadAnalysis = {
      currentSize: squadSize,
      overseasCount,
      roleDistribution,
      roleGaps,
      budgetRemaining: budget,
      budgetPerSlot,
      phase,
    };

    // Cache the result
    this.squadAnalysisCache = { key: cacheKey, result };

    return result;
  }

  /**
   * Place bid
   */
  async placeBid(amount: number): Promise<void> {
    try {
      this.logger.info('Placing bid', { amount });
      this.status = 'bidding';

      const page = this.browserController.getPage();

      // Add small delay to avoid race conditions
      await this.sleep(this.config.bidDelayMs);

      // Try multiple selectors for bid button (with fallbacks)
      const selectors = [
        '[data-bid-button]',
        'button:has-text("Bid")',
        'button:has-text("Place Bid")',
        'button[type="button"]:has-text("Bid")',
        '.bid-button',
        '#bid-button',
      ];

      let bidButton = null;
      let usedSelector = '';

      for (const selector of selectors) {
        try {
          bidButton = await page.$(selector);
          if (bidButton) {
            usedSelector = selector;
            this.logger.debug('Bid button found', { selector });
            break;
          }
        } catch (error) {
          // Try next selector
          continue;
        }
      }

      if (!bidButton) {
        // Take screenshot for debugging
        try {
          const screenshotPath = `/home/sparker0i/IPLAuctionAgentic/apps/agent/logs/bid-button-not-found-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath });
          this.logger.error('Bid button not found - screenshot saved', { screenshotPath });
        } catch (screenshotError) {
          this.logger.error('Failed to save screenshot', { error: screenshotError });
        }

        // Log page content for debugging
        const pageContent = await page.evaluate(() => {
          const win = globalThis as any;
          const doc = win.document;
          return {
            url: win.location.href,
            buttons: Array.from(doc.querySelectorAll('button')).map((b: any) => ({
              text: b.textContent?.trim(),
              disabled: b.disabled,
              classes: b.className,
              id: b.id,
            })),
          };
        });

        this.logger.error('Bid button not found - page analysis', { pageContent });
        return;
      }

      // Check if button is disabled
      const isDisabled = await bidButton.isDisabled();
      if (isDisabled) {
        this.logger.info('Cannot bid: button disabled (might be highest bidder)', { selector: usedSelector });
        return;
      }

      // Check button visibility
      const isVisible = await bidButton.isVisible();
      if (!isVisible) {
        this.logger.warn('Bid button not visible', { selector: usedSelector });
        return;
      }

      // Click bid button
      await bidButton.click();

      this.logger.info('Bid placed successfully', { amount, selector: usedSelector });

      // Wait a bit to see if bid was accepted
      await this.sleep(500);
    } catch (error) {
      this.logger.error('Failed to place bid', {
        amount,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      this.status = 'active';
    }
  }

  /**
   * Log decision
   */
  private logDecision(
    player: PlayerInAuction,
    decision: { shouldBid: boolean; maxBid?: number; reasoning?: string }
  ): void {
    const log: DecisionLog = {
      timestamp: new Date(),
      player: player.name,
      decision: decision.shouldBid ? 'bid' : 'pass',
      maxBid: decision.maxBid,
      reasoning: decision.reasoning || 'No reasoning provided',
      won: false,
    };

    this.decisions.push(log);

    // Prevent memory leak: keep only last 100 decisions
    if (this.decisions.length > 100) {
      this.decisions.shift();
    }

    this.logger.info('Decision logged', {
      player: player.name,
      decision: log.decision,
      maxBid: log.maxBid,
      reasoning: log.reasoning,
    });
  }

  /**
   * Get agent state
   */
  getState(): AgentInternalState {
    return {
      teamCode: this.config.teamCode,
      teamId: this.teamId || '',
      status: this.status,
      budget: this.stateManager.getBudget(),
      squad: this.stateManager.getSquad(),
      decisions: [...this.decisions],
      auctionCode: this.config.auctionCode,
    };
  }

  /**
   * Update budget
   */
  updateBudget(newBudget: number): void {
    this.stateManager.updateBudget(newBudget);
  }

  /**
   * Add to squad
   */
  addToSquad(player: Player): void {
    this.stateManager.addPlayer(player);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      this.logger.info('Cleaning up agent');

      // Stop state sync interval
      if (this.stateCheckInterval) {
        clearInterval(this.stateCheckInterval);
        this.stateCheckInterval = null;
      }

      // Close browser
      await this.browserController.close();

      this.status = 'completed';
      this.logger.info('Agent cleanup complete');
    } catch (error) {
      this.logger.error('Error during cleanup', { error });
      throw error;
    }
  }

  /**
   * Handle RTM triggered event
   */
  private async handleRTMTriggered(rtmData: any): Promise<void> {
    try {
      this.logger.info('RTM triggered', {
        player: rtmData.playerName,
        rtmTeam: rtmData.rtmTeamName,
        biddingTeam: rtmData.biddingTeamName,
        currentBid: rtmData.currentBidLakh,
      });

      // Check if this is RTM opportunity for my team
      if (rtmData.rtmTeamId === this.teamId) {
        this.logger.info('RTM opportunity for my team', {
          player: rtmData.playerName,
          currentBid: rtmData.currentBidLakh,
        });

        // Make AI decision for RTM usage
        await this.makeRTMDecision(rtmData);
      }
    } catch (error) {
      this.logger.error('Error handling RTM triggered', { error });
    }
  }

  /**
   * Make AI decision whether to use RTM
   */
  private async makeRTMDecision(rtmData: any): Promise<void> {
    try {
      const page = this.browserController.getPage();

      // Get current squad analysis
      const squadAnalysis = await this.getSquadAnalysis();

      const player: PlayerInAuction = {
        id: rtmData.playerId,
        name: rtmData.playerName,
        role: rtmData.playerRole || 'UNKNOWN' as PlayerRole,
        country: rtmData.playerCountry || 'Unknown',
        basePrice: rtmData.basePriceLakh || 0,
        isCapped: rtmData.isCapped !== false, // Default to capped
        isOverseas: rtmData.isOverseas || false,
      };

      this.logger.info('Evaluating RTM decision', {
        player: player.name,
        currentBid: rtmData.currentBidLakh,
        budget: squadAnalysis.budgetRemaining,
      });

      // Use decision engine to decide if we should use RTM
      const decision = await this.decisionEngine!.makeDecision(player, squadAnalysis);

      // Check if AI wants to bid and if the bid amount is worth using RTM
      const shouldUseRTM = decision.shouldBid &&
                          decision.maxBid &&
                          decision.maxBid >= rtmData.currentBidLakh;

      this.logger.info('RTM decision made', {
        player: player.name,
        shouldUseRTM,
        aiMaxBid: decision.maxBid,
        currentBid: rtmData.currentBidLakh,
        reasoning: decision.reasoning,
      });

      if (shouldUseRTM) {
        // Use RTM by calling backend via page evaluation
        const auctionCode = this.config.auctionCode;
        const teamId = this.teamId;

        await page.evaluate(
          ({ auctionCode, teamId }) => {
            const win = window as any;
            if (win.socketService && win.socketService.useRTM) {
              win.socketService.useRTM(auctionCode, teamId);
            } else {
              console.error('Socket service not available for RTM');
            }
          },
          { auctionCode, teamId }
        );

        this.logger.info('RTM used successfully', {
          player: player.name,
          matchedBid: rtmData.currentBidLakh,
        });
      } else {
        this.logger.info('RTM declined by AI', {
          player: player.name,
          reason: !decision.shouldBid
            ? 'AI decided not to bid on this player'
            : 'Current bid exceeds AI max bid limit',
        });
      }
    } catch (error) {
      this.logger.error('Error making RTM decision', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Handle RTM used event
   */
  private handleRTMUsed(rtmData: any): void {
    try {
      this.logger.info('RTM used', {
        player: rtmData.playerName,
        rtmTeam: rtmData.rtmTeamName,
        originalBid: rtmData.originalBidLakh,
      });

      // If my team used RTM, I should now be prepared to counter-bid
      if (rtmData.rtmTeamId === this.teamId) {
        this.logger.info('My team used RTM, waiting for counter-bid opportunity');
      }
    } catch (error) {
      this.logger.error('Error handling RTM used', { error });
    }
  }

  /**
   * Handle RTM counter-bid event
   */
  private handleRTMCounterBid(rtmData: any): void {
    try {
      this.logger.info('RTM counter-bid placed', {
        biddingTeam: rtmData.biddingTeamName,
        counterBid: rtmData.counterBidLakh,
      });

      // If my team is in RTM flow, I should decide whether to bid higher
      if (rtmData.rtmTeamId === this.teamId && rtmData.counterBidMade) {
        this.logger.info('Counter-bid made, I can now bid if I want', {
          currentBid: rtmData.counterBidLakh,
        });
        // TODO: Implement AI decision for counter-counter bid
        // Agent should evaluate if player is worth bidding higher
      }
    } catch (error) {
      this.logger.error('Error handling RTM counter-bid', { error });
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
