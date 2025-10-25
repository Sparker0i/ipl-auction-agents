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
import { AgentPagePool } from '../orchestrator/agent-page-pool.js';
import type { Logger } from 'winston';

/**
 * Context states for smart page pooling
 */
type ContextState = 'INACTIVE' | 'WARMING' | 'ACTIVE' | 'COOLDOWN';

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
  private passedPlayers: Set<string> = new Set(); // Track players agent has passed on
  private squadAnalysisCache: { key: string; result: SquadAnalysis } | null = null; // Memoization cache
  private currentSyncInterval: number; // Dynamic sync interval
  private isActiveBidding: boolean = false; // Track if actively bidding
  private contextState: ContextState = 'ACTIVE'; // Browser context state (default ACTIVE for first join)
  private pagePool: AgentPagePool; // Shared page pool instance
  private cooldownTimer: NodeJS.Timeout | null = null; // Timer for releasing context

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
    this.pagePool = AgentPagePool.getInstance(); // Get shared page pool
  }

  /**
   * Initialize agent
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing agent', {
        teamCode: this.config.teamCode,
        auctionCode: this.config.auctionCode,
        isRejoin: this.config.isRejoin,
      });

      this.status = 'initializing';

      // Launch browser
      await this.browserController.launch();

      // Check if this is a rejoin (reopening context)
      if (this.config.isRejoin) {
        // Rejoin path: bypass lobby and team selection
        await this.rejoinAuction();
      } else {
        // Normal initialization path
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
      }

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

        // Click team card and wait for localStorage to be set
        const clicked = await page.evaluate((targetTeamName) => {
          // Find all h3 elements (team names)
          const teamHeaders = Array.from((globalThis as any).document.querySelectorAll('h3'));

          // Find the h3 with matching team name
          const teamHeader = teamHeaders.find((h3: any) => h3.textContent?.trim() === targetTeamName);

          if (!teamHeader) {
            console.error(`Team ${targetTeamName} not found in team grid`);
            return false;
          }

          // Find the clickable parent div (the team card)
          let parentDiv = (teamHeader as any).closest('div.border-2');

          if (!parentDiv) {
            console.error(`Team card div not found for ${targetTeamName}`);
            return false;
          }

          // Check if team is already taken
          const isTaken = parentDiv.classList.contains('opacity-60');
          if (isTaken) {
            console.error(`Team ${targetTeamName} is already taken`);
            return false;
          }

          // Click the team card
          console.log(`🖱️  Clicking team card: ${targetTeamName}`);
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

        // Wait for frontend to set teamId in localStorage and socket to join
        await this.sleep(3000);

        this.logger.info('Team card clicked', { teamName });

        // Try to extract team ID from local storage or page
        // Frontend stores with key: team_${auctionId}
        const result = await page.evaluate((auctionCode) => {
          const storageKey = `team_${auctionCode}`;
          const teamId = localStorage.getItem(storageKey) || null;

          // CRITICAL: Generate/retrieve sessionId (same logic as frontend sessionApi.getSessionId)
          let sessionId = localStorage.getItem('sessionId');
          if (!sessionId) {
            sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
            localStorage.setItem('sessionId', sessionId);
          }

          return { teamId, sessionId };
        }, this.config.auctionCode);

        if (result.teamId) {
          this.teamId = result.teamId;
          this.logger.info('Team selected successfully', {
            teamName,
            teamId: result.teamId,
            sessionId: result.sessionId,
            attempt
          });

          // CRITICAL: Explicitly join auction room via socket
          // The frontend React useEffect might not have fired yet
          await page.evaluate(
            ({ auctionCode, teamId, sessionId }) => {
              const win = globalThis as any;
              if (win.socketService?.joinAuction) {
                console.log('🔌 Explicitly joining auction room:', { auctionCode, teamId });
                win.socketService.joinAuction(auctionCode, teamId, sessionId);
              } else {
                console.error('❌ socketService.joinAuction not available');
              }
            },
            { auctionCode: this.config.auctionCode, teamId: result.teamId, sessionId: result.sessionId }
          );

          // Wait a moment for room join to complete
          await this.sleep(1000);

          return; // Success!
        } else {
          // Team ID not found - this is a problem, retry
          lastError = new Error('Team ID not found in localStorage after selection');
          this.logger.warn('Team ID not found in storage, will retry', { teamName, attempt });

          if (attempt < maxRetries) {
            // Reload page before retry
            await page.reload({ waitUntil: 'domcontentloaded' });
            await this.sleep(2000);
            continue;
          } else {
            throw lastError;
          }
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
   * Rejoin auction (for reopening browser contexts)
   * Bypasses lobby/team-selection, directly reconnects to auction
   */
  async rejoinAuction(): Promise<void> {
    try {
      this.logger.info('Rejoining auction', {
        teamCode: this.config.teamCode,
        auctionCode: this.config.auctionCode,
      });

      const page = this.browserController.getPage();

      // Navigate directly to auction page (not lobby)
      const auctionUrl = `${this.config.frontendUrl}/auction/${this.config.auctionCode}`;
      await this.browserController.navigate(auctionUrl);

      // Wait for page to load
      await this.sleep(2000);

      // Get teamId from local storage (from previous session)
      // Frontend stores with key: team_${auctionId}
      const teamId = await page.evaluate((auctionCode) => {
        const storageKey = `team_${auctionCode}`;
        return localStorage.getItem(storageKey) || null;
      }, this.config.auctionCode);

      if (!teamId) {
        throw new Error('Team ID not found in storage - cannot rejoin');
      }

      this.teamId = teamId;

      // Get sessionId from local storage
      const sessionId = await page.evaluate(() => {
        return localStorage.getItem('sessionId') || null;
      });

      if (!sessionId) {
        throw new Error('Session ID not found in storage - cannot rejoin');
      }

      // Emit rejoin_auction event via WebSocket
      await page.evaluate(
        ({ auctionCode, teamId, sessionId }) => {
          const win = globalThis as any;
          if (win.socketService && win.socketService.socket) {
            win.socketService.socket.emit('rejoin_auction', {
              auctionId: auctionCode,
              teamId: teamId,
              sessionId: sessionId,
            });
          } else {
            console.error('Socket service not available for rejoin');
          }
        },
        { auctionCode: this.config.auctionCode, teamId, sessionId }
      );

      // Wait for rejoin confirmation
      const rejoined = await page.evaluate(() => {
        return new Promise<boolean>((resolve) => {
          const win = globalThis as any;
          if (!win.socketService?.socket) {
            resolve(false);
            return;
          }

          const timeout = setTimeout(() => resolve(false), 10000);

          win.socketService.socket.once('auction_rejoined', () => {
            clearTimeout(timeout);
            resolve(true);
          });

          win.socketService.socket.once('error', (err: any) => {
            clearTimeout(timeout);
            console.error('Rejoin error:', err);
            resolve(false);
          });
        });
      });

      if (!rejoined) {
        throw new Error('Failed to receive rejoin confirmation');
      }

      this.logger.info('Successfully rejoined auction', {
        teamCode: this.config.teamCode,
        teamId,
      });

      // Setup monitoring (same as initialize)
      await this.monitorAuction();

      this.status = 'active';
    } catch (error) {
      this.logger.error('Failed to rejoin auction', { error });
      this.status = 'error';
      throw error;
    }
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

      // Clear passed players for new player (fresh start)
      this.passedPlayers.clear();

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

      // ✅ Check if player is RTM-eligible for this team
      const isRTMEligible = playerData.rtmEligible === true;
      const rtmTeamId = playerData.rtmTeamId;
      const rtmTeamName = playerData.rtmTeamName;
      const isMyRTM = isRTMEligible && rtmTeamId === this.teamId;

      if (isMyRTM) {
        // CRITICAL: This player is RTM-eligible for my team
        // DO NOT PASS! Just wait silently - let other teams bid
        // When another team wins, rtm_triggered event will fire
        // THEN we can decide whether to use RTM via handleRTMTriggered
        this.logger.info('Player is RTM-eligible for my team - waiting silently for RTM opportunity', {
          player: player.name,
          rtmTeamName: rtmTeamName,
          previousTeam: playerData.iplTeam2024,
        });

        // Set status back to active and return WITHOUT passing or bidding
        // The agent will remain silent and wait for rtm_triggered event
        this.status = 'active';
        this.processingPlayer = false; // Release lock
        return;
      }

      // Make decision (not RTM-eligible or RTM for another team)
      this.status = 'thinking';
      const decision = await this.makeDecision(player);

      // Log decision
      this.logDecision(player, decision);

      // Place bid if decision is to bid, otherwise pass
      if (decision.shouldBid && decision.maxBid) {
        await this.placeBid(decision.maxBid);
      } else {
        // Agent decided not to bid - pass on the player
        await this.passPlayer(player);
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

      // Ignore if agent has already passed on this player
      if (this.passedPlayers.has(bidData.playerId)) {
        this.logger.debug('Already passed on this player, ignoring bid updates');
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

      // If AI wants to bid and we previously passed, click "Come Back" first
      if (decision.shouldBid && this.passedPlayers.has(currentPlayer.id)) {
        this.logger.info('AI wants to bid, but we previously passed. Clicking "Come Back" first.', { player: currentPlayer.name });
        await this.clickComeBackButton(currentPlayer.id);
        // After coming back, the player is removed from passedPlayers, and we can proceed to bid.
      }

      // Place counter-bid if decision is to bid AND new bid is higher than current
      if (decision.shouldBid && decision.maxBid && (decision.maxBid * 100) > currentBidLakh) {
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
            player: currentPlayer.name, // Ensure player name is logged correctly
            nextBid,
            maxBid: (decision.maxBid * 100),
          });
          await this.passPlayer(currentPlayer);
        }
      } else {
        this.logger.info('Not counter-bidding', {
          player: currentPlayer.name,
          reason: decision.shouldBid ? 'Current bid exceeds our max' : 'AI decided to pass',
        });

        // Pass on the player if we're not counter-bidding and haven't already passed
        if (!this.passedPlayers.has(currentPlayer.id)) {
          await this.passPlayer(currentPlayer);
        }
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
        // Extract price from soldData (backend sends finalPriceCr in crores)
        const priceLakh = soldData.finalPriceCr
          ? soldData.finalPriceCr * 100
          : soldData.finalPriceLakh || soldData.price;

        const player: Player = {
          id: soldData.playerId,
          name: soldData.playerName,
          role: soldData.role,
          country: soldData.country,
          price: priceLakh, // Convert to lakhs
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

        // Update budget from backend data if available
        if (soldData.winningTeam?.purseRemainingCr) {
          const newBudget = soldData.winningTeam.purseRemainingCr * 100; // Convert cr to lakhs
          this.stateManager.updateBudget(newBudget);
          this.logger.info('Budget synced from backend after player acquisition', {
            newBudget: newBudget,
            newBudgetCr: soldData.winningTeam.purseRemainingCr,
          });
        }

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
   * Pass on a player (opt out of bidding)
   */
  async passPlayer(player: PlayerInAuction): Promise<void> {
    try {
      this.logger.info('Passing on player', { player: player.name });

      const page = this.browserController.getPage();

      // Try to click a "Pass" button
      const passButton = await page.$('button:has-text("Pass")');
      if (passButton) {
        const isEnabled = await passButton.isEnabled();
        if (isEnabled) {
          await passButton.click();
          this.logger.info('Clicked Pass button');
          this.passedPlayers.add(player.id);
          return; // Assume this is enough
        } else {
          this.logger.warn('Pass button found but not enabled, falling back to socket event');
        }
      } else {
        this.logger.warn('Pass button not found, falling back to socket event');
      }

      const auctionCode = this.config.auctionCode;
      const teamId = this.teamId;
      const playerId = player.id;

      // Get sessionId from localStorage (similar to how we get teamId)
      const sessionId = await page.evaluate(() => {
        const win = globalThis as any;
        return win.localStorage?.getItem('sessionId') || null;
      });

      if (!sessionId) {
        this.logger.warn('No sessionId found, cannot pass player');
        return;
      }

      // Call socketService.passPlayer (backend expects auctionId, not auctionCode)
      await page.evaluate(
        ({ auctionId, playerId, teamId, sessionId }) => {
          const win = globalThis as any;
          if (win.socketService?.passPlayer) {
            win.socketService.passPlayer(auctionId, playerId, teamId, sessionId);
            console.log(`❌ Passed on player ${playerId}`);
          } else {
            console.error('Socket service passPlayer not available');
          }
        },
        { auctionId: auctionCode, playerId, teamId, sessionId }
      );

      // Track that we passed on this player
      this.passedPlayers.add(playerId);

      this.logger.info('Pass sent successfully', { player: player.name });
    } catch (error) {
      this.logger.error('Error passing on player', {
        player: player.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clicks the "Come Back" button and updates agent state.
   */
  private async clickComeBackButton(playerId: string): Promise<void> {
    try {
      this.logger.info('Attempting to click "Come Back" button to rejoin bidding', { playerId });
      const page = this.browserController.getPage();

      // Use a more robust selector. The text-based one is brittle due to whitespace/icons.
      const selectors = [
        '[data-testid="come-back-button"]', // Preferred, most robust
        'button:has-text("Come Back")', // Fallback
      ];
      const comeBackButton = await this.browserController.findElement(selectors);
      if (comeBackButton) {
        const isEnabled = await comeBackButton.isEnabled();
        if (isEnabled) {
          await comeBackButton.click();
          this.logger.info('Successfully clicked "Come Back" button');
          this.passedPlayers.delete(playerId); // Remove from passed players after coming back
          await this.sleep(500); // Wait for UI to update and button state to change
          return;
        } else {
          this.logger.warn('"Come Back" button found but not enabled. Cannot click.', { playerId });
          // If the button is disabled, it means the UI is not ready or there's another state.
          // We should not proceed with bidding in this case.
          throw new Error('"Come Back" button is disabled');
        }
      } else {
        this.logger.error('"Come Back" button not found on the page.', { playerId });
        throw new Error('"Come Back" button not found');
      }
    } catch (error) {
      this.logger.error('Error in clickComeBackButton', {
        playerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error; // Re-throw to propagate the error and prevent invalid bid attempts
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
      // Debug: Log full rtmData to understand what backend sends
      this.logger.info('RTM triggered - full data', { rtmData });

      this.logger.info('RTM triggered', {
        player: rtmData.playerName,
        rtmTeam: rtmData.rtmTeamName,
        rtmTeamId: rtmData.rtmTeamId,
        myTeamId: this.teamId,
        biddingTeam: rtmData.biddingTeamName,
        originalWinnerTeam: rtmData.originalWinnerTeamName,
        currentBid: rtmData.currentBidLakh,
        matchedBid: rtmData.matchedBidLakh,
      });

      // Check if this is RTM opportunity for my team
      this.logger.info('RTM team comparison check', {
        rtmTeamId: rtmData.rtmTeamId,
        rtmTeamIdType: typeof rtmData.rtmTeamId,
        myTeamId: this.teamId,
        myTeamIdType: typeof this.teamId,
        areEqual: rtmData.rtmTeamId === this.teamId,
        strictEqual: rtmData.rtmTeamId === this.teamId,
      });

      if (rtmData.rtmTeamId === this.teamId) {
        this.logger.info('RTM opportunity for my team', {
          player: rtmData.playerName,
          currentBid: rtmData.currentBidLakh,
          matchedBid: rtmData.matchedBidLakh,
        });

        // Make AI decision for RTM usage
        await this.makeRTMDecision(rtmData);
      } else {
        this.logger.info('RTM is for different team', {
          rtmTeamId: rtmData.rtmTeamId,
          myTeamId: this.teamId,
        });
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

      // Backend sends matchedBidLakh, not currentBidLakh
      const matchedBid = rtmData.matchedBidLakh;

      // The frontend now sets currentPlayer upon rtm_triggered. We can rely on it.
      const playerData = rtmData.player || {};

      // Build player object with fallback for missing data
      const player: PlayerInAuction = {
        id: rtmData.playerId,
        name: rtmData.playerName,
        role: playerData.role || ('UNKNOWN' as PlayerRole),
        country: playerData.country || 'India',
        basePrice: playerData.basePriceLakh || matchedBid,
        isCapped: rtmData.isCapped !== false, // Use from rtmData as it's accurate
        isOverseas: playerData.isOverseas || false,
      };

      this.logger.info('RTM player data assembled', {
        player: player.name,
        basePrice: player.basePrice,
        role: player.role,
        matchedBid: matchedBid,
        hadPageData: !!playerData.role,
      });

      this.logger.info('Evaluating RTM decision', {
        player: player.name,
        matchedBid: matchedBid,
        budget: squadAnalysis.budgetRemaining,
      });

      // Use decision engine to decide if we should use RTM
      const decision = await this.decisionEngine!.makeDecision(player, squadAnalysis);

      // Check if AI wants to bid and if the bid amount is worth using RTM
      const shouldUseRTM = decision.shouldBid &&
                          decision.maxBid &&
                          (decision.maxBid * 100) >= matchedBid;

      this.logger.info('RTM decision made', {
        player: player.name,
        shouldUseRTM,
        aiMaxBid: decision.maxBid,
        matchedBid: matchedBid,
        reasoning: decision.reasoning,
      });

      if (shouldUseRTM) {
        this.logger.info('Using RTM card', {
          player: player.name,
          matchedBid: matchedBid,
        });

        // Click the "Use RTM" button on the UI
        const useRtmButton = await page.$('button:has-text("Use RTM")');
        if (useRtmButton && (await useRtmButton.isEnabled())) {
          await useRtmButton.click();
        } else {
          this.logger.error('Could not find or click the "Use RTM" button.');
          // Fallback or error handling can be added here
        }

        this.logger.info('RTM card used, waiting for counter-bid opportunity', {
          player: player.name,
        });

        // The rest of the RTM flow (waiting for counter-bid, making decision, finalizing) will be handled
        // by the handleRTMCounterBid function, which is triggered by the 'auction-rtm-counter-bid' event.
        return;
      } else {
        // AI decided not to use RTM - need to pass/decline
        this.logger.info('RTM declined by AI, finalizing with a pass', {
          player: player.name,
          reasoning: decision.reasoning, // The reasoning for the decision.
        });

        // Click the "Pass" button on the UI to decline the RTM
        const passButton = await page.$('button:has-text("❌ Pass")');
        if (passButton && (await passButton.isEnabled())) {
          await passButton.click();
          this.logger.info('Clicked RTM Pass button');
        } else {
          this.logger.error('Could not find or click the RTM Pass button. The auction may be stuck.');
          // As a fallback, we can still try the direct socket call, but UI interaction is preferred.
          await this.finalizeRTM(false); // Assuming finalizeRTM method exists
        }

        // No further action is needed. The player will be sold to the original winner.
        return;
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
  private async handleRTMUsed(rtmData: any): Promise<void> {
    try {
      this.logger.info('RTM used', {
        player: rtmData.playerName,
        rtmTeam: rtmData.rtmTeamName,
        matchedBid: rtmData.matchedBidLakh,
        originalWinner: rtmData.originalWinnerTeamName,
      });

      // Case 1: My team is the one that used the RTM card.
      // We just wait for the original winner to make a move.
      if (rtmData.rtmTeamId === this.teamId) {
        this.logger.info('My team used RTM, waiting for counter-bid opportunity');
        return;
      }

      // Case 2: My team was the original winner.
      // Now I have one last chance to place a counter-bid.
      if (rtmData.originalWinnerTeamId === this.teamId) {
        this.logger.info('RTM used against my winning bid. Evaluating final counter-bid.', {
          player: rtmData.playerName,
          matchedBid: rtmData.matchedBidLakh,
        });

        const page = this.browserController.getPage();
        const squadAnalysis = await this.getSquadAnalysis();

        // Re-create player object to make a decision
        const player: PlayerInAuction = {
          id: rtmData.playerId,
          name: rtmData.playerName,
          role: rtmData.role || ('UNKNOWN' as PlayerRole),
          country: rtmData.country || 'India',
          basePrice: rtmData.basePriceLakh || rtmData.matchedBidLakh,
          isCapped: rtmData.isCapped !== false,
          isOverseas: rtmData.isOverseas || false,
        };

        const decision = await this.decisionEngine!.makeDecision(player, squadAnalysis);

        // The counter-bid must be higher than the matched bid.
        const increment = this.calculateBidIncrement(rtmData.matchedBidLakh);
        const counterBidAmount = rtmData.matchedBidLakh + increment;

        const shouldCounterBid =
          decision.shouldBid &&
          decision.maxBid &&
          decision.maxBid * 100 >= counterBidAmount;

        this.logger.info('RTM counter-bid decision', {
          shouldCounterBid,
          aiMaxBid: decision.maxBid,
          requiredCounterBid: counterBidAmount,
          reasoning: decision.reasoning,
        });

        if (shouldCounterBid) {
          this.logger.info('Placing RTM counter-bid.', { amount: counterBidAmount });
          await this.placeRtmCounterBid(counterBidAmount);
        } else {
          this.logger.info('Passing on RTM counter-bid opportunity.');
          // To pass, we (as the original winner) decline to counter-bid.
          // This is done by finalizing the RTM with `rtmAccepts: false` from our perspective.
          // The backend interprets this as the original winner passing, which awards the player
          // to the RTM team at their matched bid.
          await this.finalizeRTM(false);
        }
      }
    } catch (error) {
      this.logger.error('Error handling RTM used, defaulting to pass to not stall auction', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      // If any error occurs (e.g., decision engine fails), default to passing
      // to prevent the auction from getting stuck.
      // This finalizes the RTM by declining to counter-bid, giving the player to the RTM team.
      await this.finalizeRTM(false);
    }
  }

  /**
   * Handle RTM counter-bid event
   */
  private async handleRTMCounterBid(rtmData: any): Promise<void> {
    // This event is the cue for the RTM team to make its final decision.
    // It's fired after the original winner either places a counter-bid or passes.
    try {
      this.logger.info('RTM counter-bid opportunity received', { rtmData });
      // Screenshot to see the state when the counter-bid opportunity arrives
      await this.browserController.screenshot(
        `/home/sparker0i/IPLAuctionAgentic/apps/agent/logs/rtm-counter-bid-received-${Date.now()}.png`
      );

      // If my team is the one using RTM, I need to make a final decision.
      if (rtmData.rtmTeamId === this.teamId) {
        this.logger.info('Counter-bid made, I can now bid if I want', {
          currentBid: rtmData.counterBidLakh,
        });

        // Fetch full player data from current page state (rtmData only has basic info)
        const page = this.browserController.getPage();
        const playerData = await page.evaluate(() => {
          const win = globalThis as any;
          const state = win.store?.getState();
          return state?.auction?.currentPlayer || null;
        });

        // Build player object with fallback for missing data
        const player: PlayerInAuction = {
          id: rtmData.playerId,
          name: rtmData.playerName,
          role: playerData?.role || 'UNKNOWN' as PlayerRole,
          country: playerData?.country || 'India', // Most IPL players are Indian
          basePrice: playerData?.basePriceLakh || rtmData.counterBidLakh, // Use counter bid as fallback
          isCapped: rtmData.isCapped !== false, // Use from rtmData as it's accurate
          isOverseas: playerData?.isOverseas || false,
        };

        // Get current squad analysis
        const squadAnalysis = await this.getSquadAnalysis();

        // Use decision engine to decide if we should match the final bid
        const finalBidLakh = rtmData.matchedBidLakh || rtmData.counterBidLakh;
        const decision = await this.decisionEngine!.makeDecision(player, squadAnalysis);

        // Check if AI wants to bid and if the final bid is within the AI's max bid
        const shouldAcceptRTM =
          decision.shouldBid && decision.maxBid && decision.maxBid * 100 >= finalBidLakh;

        this.logger.info('RTM counter-bid decision made', {
          player: player.name,
          shouldAcceptRTM,
          aiMaxBid: decision.maxBid ? decision.maxBid * 100 : 0,
          counterBid: finalBidLakh,
          reasoning: decision.reasoning,
        });

        if (shouldAcceptRTM) {
          this.logger.info('Attempting to match final RTM bid by clicking button.', {
            player: player.name,
            finalBid: finalBidLakh,
          });
          // Click the "Match ₹X cr" button on the UI (line 1319 in AuctionPage.tsx)
          // Button text format: "Match ₹{rtmState.matchedBidLakh / 100} cr"
          const finalBidCr = finalBidLakh / 100;
          // Use getByRole to find button containing "Match" and the specific amount
          const matchButton = page.getByRole('button', {
            name: new RegExp(`Match.*${finalBidCr}.*cr`)
          }).first();

          if (await matchButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await matchButton.click();
            this.logger.info('Clicked match button to finalize RTM.', {
              expectedAmount: `₹${finalBidCr} cr`
            });
          } else {
            this.logger.error('Could not find or click the match button. Auction may be stuck.', {
              expectedAmount: `₹${finalBidCr} cr`,
              expectedPattern: `Match.*${finalBidCr}.*cr`
            });
            await this.browserController.screenshot(
              `/home/sparker0i/IPLAuctionAgentic/apps/agent/logs/rtm-match-button-fail-${Date.now()}.png`
            );
          }
        } else {
          this.logger.info('Declining to match final RTM bid by clicking button.', { player: player.name });
          // Click the "Pass" button on the UI
          const passButton = await page.$('button:has-text("❌ Pass")');
          if (passButton && (await passButton.isEnabled())) {
            await passButton.click();
            this.logger.info('Clicked "Pass" button to decline RTM.');
          } else {
            this.logger.error('Could not find or click the RTM "Pass" button. Auction may be stuck.');
            await this.browserController.screenshot(
              `/home/sparker0i/IPLAuctionAgentic/apps/agent/logs/rtm-pass-button-fail-${Date.now()}.png`
            );
          }
        }
      }
    } catch (error) {
      this.logger.error('Error handling RTM counter-bid', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Places the final RTM counter-bid. This is only called by the original winner.
   */
  private async placeRtmCounterBid(amountLakh: number): Promise<void> {
    try {
      const page = this.browserController.getPage();
      const amountCr = amountLakh / 100;

      // 1. Find the counter-bid input field
      const inputSelector = '#counterBidInput';
      const inputField = await page.$(inputSelector);

      if (!inputField) {
        this.logger.error('RTM counter-bid input field not found.', { selector: inputSelector });
        await this.browserController.screenshot(
          `/home/sparker0i/IPLAuctionAgentic/apps/agent/logs/rtm-counter-input-not-found-${Date.now()}.png`
        );
        return;
      }

      // 2. Type the counter-bid amount
      await inputField.fill(String(amountCr));
      this.logger.info('Typed RTM counter-bid into input field', { amountCr });

      // 3. Find and click the counter-bid button
      const buttonSelector = 'button:has-text("Counter-Bid")';
      const counterBidButton = await page.$(buttonSelector);

      if (!counterBidButton || !(await counterBidButton.isEnabled())) {
        this.logger.error('RTM counter-bid button not found or not enabled.', { selector: buttonSelector });
        await this.browserController.screenshot(
          `/home/sparker0i/IPLAuctionAgentic/apps/agent/logs/rtm-counter-button-not-found-${Date.now()}.png`
        );
        return;
      }

      // 4. Click the button
      await counterBidButton.click();

      this.logger.info('Successfully clicked RTM counter-bid button.', { amountLakh });
    } catch (error) {
      this.logger.error('Error placing RTM counter-bid', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Finalizes an RTM decision.
   * @param accept - True to accept the player, false to pass.
   */
  private async finalizeRTM(accept: boolean): Promise<void> {
    const page = this.browserController.getPage();
    const auctionCode = this.config.auctionCode;
    const teamId = this.teamId;

    if (accept) {
      // Finalize RTM (accept the player at matched bid)
      await page.evaluate(
        ({ auctionCode, teamId }) => {
          const win = globalThis as any;
          if (win.socketService?.finalizeRTM) {
            win.socketService.finalizeRTM(auctionCode, teamId, true);
            console.log('✅ RTM finalized: Accepting player');
          } else {
            console.error('Socket service not available for finalizing RTM');
          }
        },
        { auctionCode, teamId }
      );
      this.logger.info('RTM finalized - player acquired');
    } else {
      // Finalize RTM with decline (rtmAccepts: false)
      await page.evaluate(
        ({ auctionCode, teamId }) => {
          const win = globalThis as any;
          if (win.socketService?.finalizeRTM) {
            win.socketService.finalizeRTM(auctionCode, teamId, false);
            console.log('❌ RTM declined: Player goes to original winner');
          } else {
            console.error('Socket service not available for declining RTM');
          }
        },
        { auctionCode: this.config.auctionCode, teamId: this.teamId }
      );
      this.logger.info('RTM passed - player goes to original winner');
    }
  }

  /**
   * Ensure browser context is active (for page pooling)
   * If context is INACTIVE, request from pool and rejoin auction
   */
  async ensureContext(): Promise<void> {
    if (this.contextState === 'ACTIVE') {
      // Already have active context
      this.logger.debug('Context already active', { teamCode: this.config.teamCode });

      // Cancel cooldown timer if exists
      if (this.cooldownTimer) {
        clearTimeout(this.cooldownTimer);
        this.cooldownTimer = null;
        this.logger.debug('Cancelled cooldown timer - agent is active again');
      }

      return;
    }

    if (this.contextState === 'WARMING') {
      // Context is already being warmed up, wait briefly
      this.logger.debug('Context is warming, waiting...', { teamCode: this.config.teamCode });
      await this.sleep(1000);
      return;
    }

    // Need to acquire context
    this.logger.info('Acquiring browser context from pool', {
      teamCode: this.config.teamCode,
      currentState: this.contextState,
    });

    this.contextState = 'WARMING';

    try {
      // Request context from pool (page is managed by browserController)
      await this.pagePool.requestContext(
        this.config.teamCode,
        this.config.teamCode // agentId = teamCode
      );

      this.logger.info('Context acquired, rejoining auction', {
        teamCode: this.config.teamCode,
      });

      // Set isRejoin flag and reinitialize
      this.config.isRejoin = true;
      await this.initialize();

      this.contextState = 'ACTIVE';

      this.logger.info('Context active and ready', {
        teamCode: this.config.teamCode,
      });
    } catch (error) {
      this.logger.error('Failed to ensure context', {
        teamCode: this.config.teamCode,
        error,
      });
      this.contextState = 'INACTIVE';
      throw error;
    }
  }

  /**
   * Release browser context (with cooldown)
   * Schedule context release after cooldown period
   */
  async releaseContext(cooldownMs: number = 30000): Promise<void> {
    if (this.contextState !== 'ACTIVE') {
      this.logger.debug('Context not active, nothing to release', {
        teamCode: this.config.teamCode,
        state: this.contextState,
      });
      return;
    }

    // Cancel existing cooldown timer
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }

    this.logger.info('Scheduling context release', {
      teamCode: this.config.teamCode,
      cooldownMs,
    });

    this.contextState = 'COOLDOWN';

    // Schedule release
    this.cooldownTimer = setTimeout(async () => {
      try {
        this.logger.info('Cooldown complete, releasing context', {
          teamCode: this.config.teamCode,
        });

        // Stop monitoring
        if (this.stateCheckInterval) {
          clearInterval(this.stateCheckInterval);
          this.stateCheckInterval = null;
        }

        // Release from page pool
        await this.pagePool.releaseContext(
          this.config.teamCode,
          this.config.teamCode, // agentId = teamCode
          0 // No additional cooldown since we already waited
        );

        this.contextState = 'INACTIVE';

        this.logger.info('Context released successfully', {
          teamCode: this.config.teamCode,
        });
      } catch (error) {
        this.logger.error('Error releasing context', {
          teamCode: this.config.teamCode,
          error,
        });
      }
    }, cooldownMs);
  }

  /**
   * Force release context immediately (no cooldown)
   */
  async forceReleaseContext(): Promise<void> {
    // Cancel cooldown timer
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }

    if (this.contextState === 'INACTIVE') {
      return;
    }

    this.logger.info('Force releasing context', {
      teamCode: this.config.teamCode,
    });

    try {
      // Stop monitoring
      if (this.stateCheckInterval) {
        clearInterval(this.stateCheckInterval);
        this.stateCheckInterval = null;
      }

      // Force release from page pool
      await this.pagePool.forceReleaseContext(
        this.config.teamCode,
        this.config.teamCode // agentId = teamCode
      );

      this.contextState = 'INACTIVE';

      this.logger.info('Context force released', {
        teamCode: this.config.teamCode,
      });
    } catch (error) {
      this.logger.error('Error force releasing context', {
        teamCode: this.config.teamCode,
        error,
      });
      throw error;
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
