import {
  TeamStrategy,
  BudgetPhase,
  BudgetAllocation,
  PlayerQuality,
} from '../types/strategy.types.js';
import { Player } from '../types/agent.types.js';

/**
 * Budget management and allocation logic
 */
export class BudgetManager {
  private strategy: TeamStrategy;

  constructor(strategy: TeamStrategy) {
    this.strategy = strategy;
  }

  /**
   * Calculate maximum bid for a player
   */
  calculateMaxBid(
    currentBudget: number,
    squadSize: number,
    basePrice: number,
    quality?: PlayerQuality
  ): number {
    const remainingBudget = currentBudget; // in lakhs
    const minSquadSize = 18;
    const maxSquadSize = 25;

    // Calculate minimum slots we need to fill
    const minSlotsNeeded = Math.max(0, minSquadSize - squadSize);
    const maxSlotsAvailable = maxSquadSize - squadSize;

    // Get budget allocation for current phase
    const allocation = this.getBudgetAllocation(squadSize);

    // Reserve budget for mandatory slots
    const reservedBudget = minSlotsNeeded * allocation.reservePerSlot;
    const spendableBudget = remainingBudget - reservedBudget;

    if (spendableBudget <= 0) {
      // Critical: Only bid base price if absolutely needed
      return basePrice;
    }

    // Calculate base max bid from allocation strategy
    const baseMaxBid = spendableBudget * allocation.maxBidPercent;

    // Apply quality multiplier if available
    let qualityMultiplier = 1.0;
    if (quality) {
      qualityMultiplier = this.getQualityMultiplier(quality);
    }

    // Apply team strategy multipliers
    const strategyMultiplier = this.getStrategyMultiplier(allocation.phase);

    // Calculate final max bid
    let maxBid = baseMaxBid * qualityMultiplier * strategyMultiplier;

    // Ensure within team's absolute maximum (convert cr to lakhs)
    const teamMaxInLakhs = this.strategy.specialRules.maxBidPerPlayer * 100;
    maxBid = Math.min(maxBid, teamMaxInLakhs);

    // Ensure at least base price
    maxBid = Math.max(maxBid, basePrice);

    return Math.floor(maxBid);
  }

  /**
   * Get budget allocation strategy based on squad size
   */
  private getBudgetAllocation(squadSize: number): BudgetAllocation {
    if (squadSize < 11) {
      // Early phase: Build core, willing to spend more
      return {
        phase: 'early',
        maxBidPercent: this.getPhasePercent('early'),
        reservePerSlot: 35, // Higher reserve for flexibility
      };
    } else if (squadSize < 18) {
      // Mid phase: Fill key roles
      return {
        phase: 'mid',
        maxBidPercent: this.getPhasePercent('mid'),
        reservePerSlot: 32,
      };
    } else {
      // Late phase: Fill remaining slots cheaply
      return {
        phase: 'late',
        maxBidPercent: this.getPhasePercent('late'),
        reservePerSlot: 30,
      };
    }
  }

  /**
   * Get max bid percentage based on phase and team aggression
   */
  private getPhasePercent(phase: BudgetPhase): number {
    const basePercents = {
      early: 0.25, // Up to 25% of spendable budget
      mid: 0.15, // Up to 15% of spendable budget
      late: 0.05, // Up to 5% of spendable budget
    };

    // Adjust based on team aggression
    const aggressionMultiplier = {
      conservative: 0.8,
      balanced: 1.0,
      aggressive: 1.3,
    };

    return basePercents[phase] * aggressionMultiplier[this.strategy.aggression];
  }

  /**
   * Calculate quality multiplier (0.5 - 2.0)
   */
  private getQualityMultiplier(quality: PlayerQuality): number {
    // Base multiplier from overall rating (0-10)
    let multiplier = 0.5 + (quality.overall / 10) * 1.5;

    // Venue bonus (0-1)
    multiplier *= 1 + quality.venueBonus * 0.3;

    // Form trend adjustment
    if (quality.formTrend === 'improving') {
      multiplier *= 1.15;
    } else if (quality.formTrend === 'declining') {
      multiplier *= 0.85;
    }

    // Experience adjustment based on team priorities
    if (quality.experience === 'high' && this.strategy.priorities.experience > 0.6) {
      multiplier *= 1.1;
    } else if (quality.experience === 'low' && this.strategy.priorities.youth > 0.6) {
      multiplier *= 1.1;
    }

    return Math.min(Math.max(multiplier, 0.5), 2.0);
  }

  /**
   * Get strategy multiplier based on phase and risk tolerance
   */
  private getStrategyMultiplier(phase: BudgetPhase): number {
    // More aggressive in early phase, conservative in late
    if (phase === 'early') {
      return 1 + this.strategy.riskTolerance * 0.3;
    } else if (phase === 'mid') {
      return 1.0;
    } else {
      return 1 - (1 - this.strategy.riskTolerance) * 0.2;
    }
  }

  /**
   * Check if we can afford a bid
   */
  canAffordBid(
    currentBudget: number,
    squadSize: number,
    bidAmount: number
  ): boolean {
    const minSquadSize = 18;
    const minSlotsNeeded = Math.max(0, minSquadSize - squadSize);

    // Reserve 30L per remaining mandatory slot
    const reservedBudget = minSlotsNeeded * 30;
    const availableBudget = currentBudget - reservedBudget;

    return bidAmount <= availableBudget;
  }

  /**
   * Get recommended bid increment
   */
  getBidIncrement(currentBid: number): number {
    if (currentBid < 100) {
      return 5; // 5L increments
    } else if (currentBid < 500) {
      return 10; // 10L increments
    } else if (currentBid < 1000) {
      return 25; // 25L increments
    } else if (currentBid < 2000) {
      return 50; // 50L increments
    } else {
      return 100; // 100L increments
    }
  }

  /**
   * Calculate budget allocation summary
   */
  getBudgetSummary(currentBudget: number, squad: Player[]): {
    totalBudget: number;
    spent: number;
    remaining: number;
    reserved: number;
    spendable: number;
    phase: BudgetPhase;
    slotsRemaining: number;
    avgBudgetPerSlot: number;
  } {
    const totalBudget = 12000; // 120cr in lakhs
    const spent = squad.reduce((sum, p) => sum + p.price, 0);
    const remaining = currentBudget;
    const squadSize = squad.length;

    const minSquadSize = 18;
    const slotsRemaining = Math.max(0, minSquadSize - squadSize);

    const allocation = this.getBudgetAllocation(squadSize);
    const reserved = slotsRemaining * allocation.reservePerSlot;
    const spendable = remaining - reserved;

    const avgBudgetPerSlot =
      slotsRemaining > 0 ? remaining / slotsRemaining : remaining;

    return {
      totalBudget,
      spent,
      remaining,
      reserved,
      spendable: Math.max(0, spendable),
      phase: allocation.phase,
      slotsRemaining,
      avgBudgetPerSlot,
    };
  }

  /**
   * Check if should participate in bidding war
   */
  shouldContinueBidding(
    currentBid: number,
    maxBid: number,
    bidCount: number
  ): boolean {
    // Stop if we've reached our max
    if (currentBid >= maxBid) {
      return false;
    }

    // Apply risk tolerance to bidding war participation
    const warThreshold = 5; // Number of bids before reconsidering
    if (bidCount > warThreshold) {
      // More risk-averse teams pull out of bidding wars earlier
      const pullOutChance = (bidCount - warThreshold) * (1 - this.strategy.riskTolerance);
      return Math.random() > pullOutChance;
    }

    return true;
  }
}
