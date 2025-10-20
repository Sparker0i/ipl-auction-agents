import { PlayerInAuction } from '../types/agent.types.js';
import { TeamStrategy, BidContext, SquadAnalysis } from '../types/strategy.types.js';
import { LLMConfig, LLMDecision } from '../types/llm.types.js';
import { BudgetManager } from './budget-manager.js';
import { SquadOptimizer } from './squad-optimizer.js';
import { StatsEngine } from '../data/stats-engine.js';
import { OllamaClient } from '../llm/ollama-client.js';
import { LLMPool } from '../llm/llm-pool.js';
import { PromptBuilder } from '../llm/prompt-builder.js';
import type { Logger } from 'winston';

/**
 * Cached decision result
 */
interface CachedDecision {
  decision: LLMDecision;
  timestamp: number;
}

/**
 * Main decision engine integrating all strategy components
 * Uses shared LLM pool for resource efficiency and decision caching
 */
export class DecisionEngine {
  private strategy: TeamStrategy;
  private budgetManager: BudgetManager;
  private squadOptimizer: SquadOptimizer;
  private statsEngine: StatsEngine;
  private ollamaClient: OllamaClient;
  private llmPool: LLMPool;
  private promptBuilder: PromptBuilder;
  private logger: Logger;
  private llmConfig: LLMConfig;
  private decisionCache: Map<string, CachedDecision> = new Map();
  private readonly DECISION_CACHE_TTL = 30000; // 30 seconds
  private promptTemplateCache: Map<string, string> = new Map(); // Template caching

  constructor(
    strategy: TeamStrategy,
    statsEngine: StatsEngine,
    llmConfig: LLMConfig,
    logger: Logger
  ) {
    this.strategy = strategy;
    this.budgetManager = new BudgetManager(strategy);
    this.squadOptimizer = new SquadOptimizer(strategy);
    this.statsEngine = statsEngine;
    this.llmPool = LLMPool.getInstance();
    this.ollamaClient = new OllamaClient(llmConfig, logger); // Fallback client
    this.promptBuilder = new PromptBuilder();
    this.logger = logger;
    this.llmConfig = llmConfig;
  }

  /**
   * Make bid decision for a player
   */
  async makeDecision(
    player: PlayerInAuction,
    squadAnalysis: SquadAnalysis
  ): Promise<{ shouldBid: boolean; maxBid?: number; reasoning: string }> {
    try {
      // 1. Quick rule checks
      const quickCheck = this.performQuickChecks(player, squadAnalysis);
      if (!quickCheck.pass) {
        return {
          shouldBid: false,
          reasoning: quickCheck.reason,
        };
      }

      // 2. Get player stats and quality
      const playerStats = await this.statsEngine.getPlayerStats(player.name);
      const playerQuality = await this.statsEngine.evaluatePlayerQuality(
        player.name,
        this.strategy.homeVenue
      );

      // 3. Build decision context
      const context: BidContext = {
        player: {
          name: player.name,
          role: player.role,
          country: player.country,
          basePrice: player.basePrice,
          currentBid: player.basePrice, // Assuming base price as initial bid
          isCapped: player.isCapped,
          isOverseas: player.isOverseas,
        },
        squad: squadAnalysis,
        strategy: this.strategy,
        quality: playerQuality || undefined,
      };

      // 4. Try LLM decision
      if (this.llmConfig.fallbackOnTimeout) {
        try {
          const llmDecision = await this.getLLMDecision(context, playerStats || undefined);
          return this.processLLMDecision(llmDecision, context);
        } catch (error) {
          this.logger.warn('LLM decision failed, using fallback', { error });
          return this.getFallbackDecision(context);
        }
      } else {
        const llmDecision = await this.getLLMDecision(context, playerStats || undefined);
        return this.processLLMDecision(llmDecision, context);
      }
    } catch (error) {
      this.logger.error('Decision making failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        player: player.name,
      });

      // Ultimate fallback: conservative pass
      return {
        shouldBid: false,
        reasoning: `Error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Perform quick rule checks
   */
  private performQuickChecks(
    player: PlayerInAuction,
    squadAnalysis: SquadAnalysis
  ): { pass: boolean; reason: string } {
    // Budget check
    if (squadAnalysis.budgetRemaining <= 290) {
      return {
        pass: false,
        reason: 'Insufficient budget (less than 30L reserve)',
      };
    }

    // Squad size check
    if (squadAnalysis.currentSize >= 25) {
      return {
        pass: false,
        reason: 'Squad full (25 players)',
      };
    }

    // Overseas quota check
    if (player.isOverseas && squadAnalysis.overseasCount >= 8) {
      return {
        pass: false,
        reason: 'Overseas quota full (8/8)',
      };
    }

    return { pass: true, reason: '' };
  }

  /**
   * Generate cache key for decision caching
   * Price-aware: different prices create different cache keys
   */
  private getCacheKey(
    playerId: string,
    currentBid: number,
    phase: string,
    hasBudget: boolean
  ): string {
    // Price bracket in 50L increments (e.g., 30L and 40L are same bracket, 80L and 90L are same)
    const priceBracket = Math.floor(currentBid / 50);
    return `${playerId}_${priceBracket}_${phase}_${hasBudget}`;
  }

  /**
   * Get cached decision if available and not expired
   */
  private getCachedDecision(cacheKey: string): LLMDecision | null {
    const cached = this.decisionCache.get(cacheKey);
    if (!cached) {
      return null;
    }

    // Check if cache expired (30 seconds TTL)
    if (Date.now() - cached.timestamp > this.DECISION_CACHE_TTL) {
      this.decisionCache.delete(cacheKey);
      this.logger.debug('Decision cache expired', { cacheKey });
      return null;
    }

    this.logger.debug('Decision cache hit', { cacheKey });
    return cached.decision;
  }

  /**
   * Store decision in cache
   */
  private cacheDecision(cacheKey: string, decision: LLMDecision): void {
    this.decisionCache.set(cacheKey, {
      decision,
      timestamp: Date.now(),
    });

    // Cleanup old entries to prevent memory leak
    if (this.decisionCache.size > 100) {
      const oldestKey = this.decisionCache.keys().next().value;
      if (oldestKey) {
        this.decisionCache.delete(oldestKey);
      }
    }

    this.logger.debug('Decision cached', { cacheKey, cacheSize: this.decisionCache.size });
  }

  /**
   * Get LLM decision (uses shared pool with queuing and caching)
   */
  private async getLLMDecision(
    context: BidContext,
    playerStats?: any
  ): Promise<LLMDecision> {
    // Generate cache key based on player, price, phase, and budget
    const cacheKey = this.getCacheKey(
      context.player.name, // Use player name as ID
      context.player.currentBid,
      context.squad.phase,
      context.squad.budgetRemaining > 1000
    );

    // Check cache first
    const cachedDecision = this.getCachedDecision(cacheKey);
    if (cachedDecision) {
      this.logger.info('Using cached decision', {
        player: context.player.name,
        decision: cachedDecision.decision,
        maxBid: cachedDecision.maxBid,
      });
      return cachedDecision;
    }

    // Cache miss - query LLM
    const prompt = this.promptBuilder.buildDecisionPrompt(context, playerStats);

    this.logger.debug('Queuing LLM request (cache miss)', {
      player: context.player.name,
      promptLength: prompt.length,
      teamCode: this.strategy.teamCode,
      cacheKey,
    });

    // Use shared LLM pool with queuing for fair resource allocation
    try {
      const decision = await this.llmPool.queueRequest(
        this.strategy.teamCode,
        async () => {
          const client = this.llmPool.getClient();
          return await client.queryDecision(prompt);
        }
      );

      this.logger.info('LLM decision received', {
        player: context.player.name,
        decision: decision.decision,
        maxBid: decision.maxBid,
      });

      // Cache the decision
      this.cacheDecision(cacheKey, decision);

      return decision;
    } catch (error) {
      // Pool error - fall back to direct client
      this.logger.warn('LLM pool error, using fallback client', { error });
      const decision = await this.ollamaClient.queryDecision(prompt);

      this.logger.info('LLM decision received (fallback)', {
        player: context.player.name,
        decision: decision.decision,
        maxBid: decision.maxBid,
      });

      // Cache the fallback decision too
      this.cacheDecision(cacheKey, decision);

      return decision;
    }
  }

  /**
   * Process LLM decision with validation
   */
  private processLLMDecision(
    llmDecision: LLMDecision,
    context: BidContext
  ): { shouldBid: boolean; maxBid?: number; reasoning: string } {
    if (llmDecision.decision === 'pass') {
      return {
        shouldBid: false,
        reasoning: llmDecision.reasoning,
      };
    }

    // Validate and adjust max bid
    let maxBid = llmDecision.maxBid!;

    // Convert from crores to lakhs if needed (LLM might return in crores)
    if (maxBid < 1000) {
      maxBid = maxBid * 100; // Convert cr to lakhs
    }

    // CRITICAL: Calculate available budget with reserves (same logic as fallback)
    const minSlotsNeeded = Math.max(0, 18 - context.squad.currentSize);
    const reservedBudget = minSlotsNeeded * 30; // 30L per remaining mandatory slot
    const availableBudget = context.squad.budgetRemaining - reservedBudget;

    this.logger.info('LLM decision budget validation', {
      player: context.player.name,
      llmMaxBid: maxBid,
      budgetRemaining: context.squad.budgetRemaining,
      reservedBudget,
      availableBudget,
      currentBid: context.player.currentBid,
    });

    // Check if we have any available budget
    if (availableBudget <= 0) {
      return {
        shouldBid: false,
        reasoning: `Cannot afford (need ₹${(reservedBudget / 100).toFixed(2)}cr reserve for ${minSlotsNeeded} slots)`,
      };
    }

    // Check if current bid is already beyond our available budget
    if (context.player.currentBid > availableBudget) {
      return {
        shouldBid: false,
        reasoning: `Current bid ₹${(context.player.currentBid / 100).toFixed(2)}cr exceeds available budget ₹${(availableBudget / 100).toFixed(2)}cr`,
      };
    }

    // Apply budget constraints
    const canAfford = this.budgetManager.canAffordBid(
      context.squad.budgetRemaining,
      context.squad.currentSize,
      maxBid
    );

    if (!canAfford) {
      // Reduce to affordable amount or pass
      const affordable = this.budgetManager.calculateMaxBid(
        context.squad.budgetRemaining,
        context.squad.currentSize,
        context.player.basePrice,
        context.quality
      );

      if (affordable < context.player.basePrice) {
        return {
          shouldBid: false,
          reasoning: `Cannot afford (LLM suggested ₹${(maxBid / 100).toFixed(2)}cr, can only afford ₹${(affordable / 100).toFixed(2)}cr)`,
        };
      }

      maxBid = affordable;
    }

    // CRITICAL: Cap maxBid to available budget (accounting for reserves)
    maxBid = Math.min(maxBid, availableBudget);

    // Ensure not exceeding team maximum
    const teamMaxInLakhs = this.strategy.specialRules.maxBidPerPlayer * 100;
    if (maxBid > teamMaxInLakhs) {
      maxBid = teamMaxInLakhs;
    }

    // Final check: is the capped maxBid below current bid?
    if (maxBid < context.player.currentBid) {
      return {
        shouldBid: false,
        reasoning: `Current bid ₹${(context.player.currentBid / 100).toFixed(2)}cr exceeds our affordable max ₹${(maxBid / 100).toFixed(2)}cr`,
      };
    }

    return {
      shouldBid: true,
      maxBid: Math.floor(maxBid),
      reasoning: llmDecision.reasoning,
    };
  }

  /**
   * Get fallback rule-based decision
   */
  private getFallbackDecision(
    context: BidContext
  ): { shouldBid: boolean; maxBid?: number; reasoning: string } {
    const { player, squad, quality } = context;

    // Check if role is needed
    const roleNeeded = this.squadOptimizer.isRoleNeeded(player.role, squad);
    const rolePriority = this.squadOptimizer.getRolePriority(player.role, squad);

    // Calculate max bid using budget manager with CURRENT squad budget
    const maxBid = this.budgetManager.calculateMaxBid(
      squad.budgetRemaining,
      squad.currentSize,
      player.basePrice,
      quality
    );

    this.logger.info('Fallback decision calculation', {
      player: player.name,
      budgetRemaining: squad.budgetRemaining,
      squadSize: squad.currentSize,
      calculatedMaxBid: maxBid,
      currentBid: player.currentBid,
    });

    // CRITICAL: Safety check - ensure we have minimum reserve budget
    const minSlotsNeeded = Math.max(0, 18 - squad.currentSize);
    const reservedBudget = minSlotsNeeded * 30; // 30L per remaining mandatory slot
    const availableBudget = squad.budgetRemaining - reservedBudget;

    if (availableBudget <= 0) {
      return {
        shouldBid: false,
        reasoning: `Fallback: Insufficient budget (need ₹${(reservedBudget / 100).toFixed(2)}cr reserve for ${minSlotsNeeded} slots)`,
      };
    }

    // Check if we can actually afford the current bid
    if (player.currentBid > availableBudget) {
      return {
        shouldBid: false,
        reasoning: `Fallback: Cannot afford current bid ₹${(player.currentBid / 100).toFixed(2)}cr (available: ₹${(availableBudget / 100).toFixed(2)}cr)`,
      };
    }

    // Decision logic
    if (!roleNeeded && squad.phase === 'late') {
      return {
        shouldBid: false,
        reasoning: 'Fallback: Role not needed in late phase',
      };
    }

    if (maxBid < player.basePrice) {
      return {
        shouldBid: false,
        reasoning: 'Fallback: Cannot afford base price',
      };
    }

    // CRITICAL: Cap maxBid to available budget (accounting for reserves)
    const cappedMaxBid = Math.min(maxBid, availableBudget);

    // Check if capped maxBid is below current bid
    if (cappedMaxBid < player.currentBid) {
      return {
        shouldBid: false,
        reasoning: `Fallback: Current bid ₹${(player.currentBid / 100).toFixed(2)}cr exceeds affordable max ₹${(cappedMaxBid / 100).toFixed(2)}cr`,
      };
    }

    // Bid if role is needed and affordable
    if (roleNeeded || rolePriority > 0) {
      return {
        shouldBid: true,
        maxBid: Math.floor(cappedMaxBid),
        reasoning: `Fallback: Role needed (priority ${rolePriority}), max bid ₹${(cappedMaxBid / 100).toFixed(2)}cr (budget: ₹${(squad.budgetRemaining / 100).toFixed(2)}cr, reserve: ₹${(reservedBudget / 100).toFixed(2)}cr)`,
      };
    }

    // Conservative pass for non-essential players
    if (squad.phase === 'late' || squad.budgetRemaining < 1000) {
      return {
        shouldBid: false,
        reasoning: 'Fallback: Conservative approach in late phase/low budget',
      };
    }

    // Default: small bid for value, but still capped to available budget
    const valueBid = Math.min(player.basePrice * 1.2, cappedMaxBid);
    return {
      shouldBid: true,
      maxBid: Math.floor(valueBid),
      reasoning: `Fallback: Value bid ₹${(valueBid / 100).toFixed(2)}cr (available: ₹${(availableBudget / 100).toFixed(2)}cr)`,
    };
  }

  /**
   * Warmup LLM model (uses shared pool)
   */
  async warmup(): Promise<void> {
    try {
      // Initialize and warmup shared LLM pool
      await this.llmPool.initialize(this.llmConfig, this.logger);
      await this.llmPool.warmup();
      this.logger.info('LLM warmup completed via shared pool');
    } catch (error) {
      this.logger.warn('Shared LLM warmup failed, using fallback', { error });
      // Fall back to individual client warmup
      try {
        await this.ollamaClient.warmupModel();
      } catch (fallbackError) {
        this.logger.warn('Fallback LLM warmup also failed', { error: fallbackError });
      }
    }
  }

  /**
   * Check if LLM is available
   */
  async checkLLMAvailability(): Promise<boolean> {
    try {
      return await this.llmPool.isAvailable();
    } catch (error) {
      // Fall back to individual client check
      return await this.ollamaClient.isAvailable();
    }
  }
}
