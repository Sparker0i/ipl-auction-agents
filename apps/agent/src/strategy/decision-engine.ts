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
 * Main decision engine integrating all strategy components
 * Uses shared LLM pool for resource efficiency
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
   * Get LLM decision (uses shared pool)
   */
  private async getLLMDecision(
    context: BidContext,
    playerStats?: any
  ): Promise<LLMDecision> {
    // Add small random delay to prevent all agents hitting LLM simultaneously
    const delay = Math.floor(Math.random() * 500); // 0-500ms random delay
    await new Promise(resolve => setTimeout(resolve, delay));

    const prompt = this.promptBuilder.buildDecisionPrompt(context, playerStats);

    this.logger.debug('Querying LLM for decision', {
      player: context.player.name,
      promptLength: prompt.length,
      delay,
    });

    // Use shared LLM client from pool if available
    let client = this.ollamaClient;
    try {
      const poolClient = this.llmPool.getClient();
      if (poolClient) {
        client = poolClient;
      }
    } catch (error) {
      // Pool not initialized, use fallback client
      this.logger.debug('Using fallback LLM client');
    }

    const decision = await client.queryDecision(prompt);

    this.logger.info('LLM decision received', {
      player: context.player.name,
      decision: decision.decision,
      maxBid: decision.maxBid,
    });

    return decision;
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

    // Ensure not exceeding team maximum
    const teamMaxInLakhs = this.strategy.specialRules.maxBidPerPlayer * 100;
    if (maxBid > teamMaxInLakhs) {
      maxBid = teamMaxInLakhs;
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

    // Calculate max bid using budget manager
    const maxBid = this.budgetManager.calculateMaxBid(
      squad.budgetRemaining,
      squad.currentSize,
      player.basePrice,
      quality
    );

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

    // Bid if role is needed and affordable
    if (roleNeeded || rolePriority > 0) {
      return {
        shouldBid: true,
        maxBid: Math.floor(maxBid),
        reasoning: `Fallback: Role needed (priority ${rolePriority}), max bid ₹${(maxBid / 100).toFixed(2)}cr`,
      };
    }

    // Conservative pass for non-essential players
    if (squad.phase === 'late' || squad.budgetRemaining < 1000) {
      return {
        shouldBid: false,
        reasoning: 'Fallback: Conservative approach in late phase/low budget',
      };
    }

    // Default: small bid for value
    return {
      shouldBid: true,
      maxBid: Math.floor(player.basePrice * 1.2),
      reasoning: 'Fallback: Value bid at base price + 20%',
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
