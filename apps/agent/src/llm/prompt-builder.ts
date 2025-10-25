import { BidContext } from '../types/strategy.types.js';
import { PlayerStats } from '../types/player.types.js';

/**
 * Build LLM prompt for bid decisions with template caching
 */
export class PromptBuilder {
  private templateCache: Map<string, string> = new Map();

  /**
   * Build complete auction decision prompt
   */
  buildDecisionPrompt(context: BidContext, playerStats?: PlayerStats, calculatedMaxBid?: number): string {
    const sections: string[] = [];

    // System role (cached - static)
    sections.push(this.getCachedSystemSection(context));

    // Team profile (cached per team)
    sections.push(this.getCachedTeamSection(context));

    // Current squad status (dynamic - not cached)
    sections.push(this.buildSquadSection(context));

    // Player information (dynamic - not cached)
    sections.push(this.buildPlayerSection(context, playerStats));

    // Squad needs (dynamic - not cached)
    sections.push(this.buildNeedsSection(context));

    // Budget guidance with calculated maxBid (dynamic - not cached)
    if (calculatedMaxBid !== undefined) {
      sections.push(this.buildBudgetGuidanceSection(context, calculatedMaxBid));
    }

    // Decision format (cached - static)
    sections.push(this.getCachedFormatSection());

    return sections.join('\n\n');
  }

  /**
   * Get cached system section
   */
  private getCachedSystemSection(context: BidContext): string {
    const cacheKey = `system_${context.strategy.teamName}`;

    if (!this.templateCache.has(cacheKey)) {
      this.templateCache.set(cacheKey, this.buildSystemSection(context));
    }

    return this.templateCache.get(cacheKey)!;
  }

  /**
   * Get cached team section
   */
  private getCachedTeamSection(context: BidContext): string {
    const cacheKey = `team_${context.strategy.teamCode}`;

    if (!this.templateCache.has(cacheKey)) {
      this.templateCache.set(cacheKey, this.buildTeamSection(context));
    }

    return this.templateCache.get(cacheKey)!;
  }

  /**
   * Get cached format section
   */
  private getCachedFormatSection(): string {
    const cacheKey = 'format';

    if (!this.templateCache.has(cacheKey)) {
      this.templateCache.set(cacheKey, this.buildFormatSection());
    }

    return this.templateCache.get(cacheKey)!;
  }

  /**
   * Build system section
   */
  private buildSystemSection(context: BidContext): string {
    return `You are an AI agent representing the ${context.strategy.teamName} franchise in the IPL 2025 Mega Auction.

Your goal is to build a competitive squad within budget constraints while following your team's strategic philosophy.`;
  }

  /**
   * Build team profile section
   */
  private buildTeamSection(context: BidContext): string {
    const { strategy } = context;

    return `## Your Team Profile

**Team**: ${strategy.teamName} (${strategy.teamCode})
**Home Ground**: ${strategy.homeVenue}
**Strategy**: ${strategy.aggression} bidding with ${(strategy.riskTolerance * 100).toFixed(0)}% risk tolerance

**Priorities**:
- Experience: ${(strategy.priorities.experience * 100).toFixed(0)}%
- Youth: ${(strategy.priorities.youth * 100).toFixed(0)}%
- Star Power: ${(strategy.priorities.starPower * 100).toFixed(0)}%
- Value: ${(strategy.priorities.value * 100).toFixed(0)}%

**Philosophy**: ${strategy.philosophy}`;
  }

  /**
   * Build squad status section
   */
  private buildSquadSection(context: BidContext): string {
    const { squad } = context;

    return `## Current Squad Status

**Players Acquired**: ${squad.currentSize}/25
**Budget Remaining**: ₹${(squad.budgetRemaining / 100).toFixed(2)} cr
**Auction Phase**: ${squad.phase.toUpperCase()}
**Budget per Slot**: ₹${(squad.budgetPerSlot / 100).toFixed(2)} cr

**Squad Composition**:
- Batters: ${squad.roleDistribution.BATTER} (Target: ${context.strategy.roleDistribution.batters}%)
- Bowlers: ${squad.roleDistribution.BOWLER} (Target: ${context.strategy.roleDistribution.bowlers}%)
- All-Rounders: ${squad.roleDistribution['ALL-ROUNDER']} (Target: ${context.strategy.roleDistribution.allRounders}%)
- Wicketkeepers: ${squad.roleDistribution.WICKETKEEPER} (Target: ${context.strategy.roleDistribution.wicketkeepers}%)
- Overseas Players: ${squad.overseasCount}/8`;
  }

  /**
   * Build player information section
   */
  private buildPlayerSection(context: BidContext, playerStats?: PlayerStats): string {
    const { player } = context;

    let section = `## Player Being Auctioned

**Name**: ${player.name}
**Role**: ${player.role}
**Country**: ${player.country}
**Status**: ${player.isCapped ? 'Capped' : 'Uncapped'}
**Base Price**: ₹${(player.basePrice / 100).toFixed(2)} cr
**Current Bid**: ₹${(player.currentBid / 100).toFixed(2)} cr`;

    if (playerStats) {
      section += '\n\n' + this.buildStatsSection(playerStats);
    } else {
      section += '\n\n**Statistics**: Not available (proceed with base analysis)';
    }

    if (context.quality) {
      section += '\n\n' + this.buildQualitySection(context.quality);
    }

    return section;
  }

  /**
   * Build statistics section
   */
  private buildStatsSection(stats: PlayerStats): string {
    const parts: string[] = ['**Player Statistics** (T20 2015-2025):'];

    if (stats.battingStats) {
      const b = stats.battingStats.overall;
      parts.push(
        `\n**Batting**: ${b.matches} matches, ${b.runs} runs, avg ${b.average.toFixed(1)}, SR ${b.strikeRate.toFixed(1)}, ${b.fifties} fifties, ${b.hundreds} hundreds`
      );

      if (stats.battingStats.recentForm) {
        const rf = stats.battingStats.recentForm;
        const avgRecentSR = rf.strikeRates.length > 0 ? rf.strikeRates.reduce((a, b) => a + b, 0) / rf.strikeRates.length : 0;
        parts.push(`  - Recent Form: ${rf.trend}, avg SR ${avgRecentSR > 0 ? avgRecentSR.toFixed(1) : 'N/A'}`);
      }
    }

    if (stats.bowlingStats) {
      const b = stats.bowlingStats.overall;
      parts.push(
        `\n**Bowling**: ${b.matches} matches, ${b.wickets} wickets, avg ${b.average.toFixed(1)}, econ ${b.economy.toFixed(2)}, SR ${b.strikeRate.toFixed(1)}`
      );

      if (stats.bowlingStats.recentForm) {
        const rf = stats.bowlingStats.recentForm;
        parts.push(`  - Recent Form: ${rf.trend}`);
      }
    }

    if (stats.fieldingStats) {
      const f = stats.fieldingStats;
      parts.push(`\n**Fielding**: ${f.catches} catches, ${f.runOuts} run-outs`);
    }

    return parts.join('');
  }

  /**
   * Build quality assessment section
   */
  private buildQualitySection(quality: any): string {
    return `**Quality Assessment**:
- Overall Rating: ${quality.overall.toFixed(1)}/10
- Role Performance: ${quality.roleSpecific.toFixed(1)}/10
- Home Venue Bonus: ${(quality.venueBonus * 100).toFixed(0)}%
- Form Trend: ${quality.formTrend}
- Experience: ${quality.experience}`;
  }

  /**
   * Build squad needs section
   */
  private buildNeedsSection(context: BidContext): string {
    const { squad, strategy } = context;

    const gaps: string[] = [];
    Object.entries(squad.roleGaps).forEach(([role, gap]) => {
      if (gap > 0) {
        gaps.push(`${role}: need ${gap} more`);
      }
    });

    const criticalGaps = gaps.length > 0 ? gaps.join(', ') : 'Squad balanced';

    return `## Squad Needs Analysis

**Critical Gaps**: ${criticalGaps}
**Budget Constraint**: Must reserve ₹${((Math.max(0, 18 - squad.currentSize) * 30) / 100).toFixed(2)} cr for ${Math.max(0, 18 - squad.currentSize)} minimum slots
**Max Bid Limit**: ₹${strategy.specialRules.maxBidPerPlayer} cr per player`;
  }

  /**
   * Build budget guidance section with calculated maxBid
   */
  private buildBudgetGuidanceSection(context: BidContext, calculatedMaxBid: number): string {
    const { squad, strategy, player } = context;

    const minSlotsNeeded = Math.max(0, 18 - squad.currentSize);
    const reservedBudget = minSlotsNeeded * 30;
    const availableBudget = squad.budgetRemaining - reservedBudget;
    const calculatedMaxBidCr = calculatedMaxBid / 100;
    const availableBudgetCr = availableBudget / 100;

    // Determine player tier based on base price and status
    let playerTier = 'Standard';
    let bidGuidance = '';

    if (player.basePrice >= 200) {
      playerTier = 'MARQUEE/PREMIUM';
      if (player.isCapped && player.isOverseas) {
        bidGuidance = `International marquee players typically sell for 5-15x base price in competitive auctions. With your ${strategy.aggression} bidding strategy and ${(strategy.priorities.starPower * 100).toFixed(0)}% star power priority, you should bid aggressively.`;
      } else if (player.isCapped) {
        bidGuidance = `Top capped Indian players are highly valuable. Your ${(strategy.priorities.experience * 100).toFixed(0)}% experience priority suggests strong interest in proven performers.`;
      }
    } else if (player.basePrice >= 100) {
      playerTier = 'Mid-tier';
      bidGuidance = `Mid-tier players offer good value. Consider bidding 2-5x base price based on squad needs.`;
    } else {
      playerTier = 'Value pick';
      bidGuidance = `Uncapped/low base price players can be acquired at or near base price. Focus on potential and value.`;
    }

    return `## BUDGET GUIDANCE & BIDDING STRATEGY

**AVAILABLE BUDGET**: ₹${availableBudgetCr.toFixed(2)} cr (after ₹${(reservedBudget / 100).toFixed(2)} cr reserve)
**CALCULATED MAX BID**: ₹${calculatedMaxBidCr.toFixed(2)} cr (based on your team strategy and budget analysis)

**Player Tier**: ${playerTier}
**Your Bidding Profile**: ${strategy.aggression.toUpperCase()} with ${(strategy.riskTolerance * 100).toFixed(0)}% risk tolerance

${bidGuidance}

**CRITICAL INSTRUCTIONS**:
1. The calculated max bid of ₹${calculatedMaxBidCr.toFixed(2)} cr is your BUDGET-SAFE ceiling - you can bid up to this amount
2. DO NOT be overly conservative - you have ₹${availableBudgetCr.toFixed(2)} cr available
3. For ${strategy.aggression} teams: Bid competitively to secure quality players
4. Phase: ${squad.phase.toUpperCase()} - ${squad.phase === 'early' ? 'This is the time to invest in core players' : squad.phase === 'mid' ? 'Fill key roles aggressively' : 'Be selective with remaining budget'}

**Suggested Bid Range** (you can adjust based on player value):
- Minimum: ₹${(player.basePrice / 100).toFixed(2)} cr (base price)
- Target: ₹${Math.min(calculatedMaxBidCr * 0.7, calculatedMaxBidCr).toFixed(2)}-${calculatedMaxBidCr.toFixed(2)} cr
- Maximum: ₹${calculatedMaxBidCr.toFixed(2)} cr (calculated safe limit)`;
  }

  /**
   * Build response format section
   */
  private buildFormatSection(): string {
    return `## Decision Required

Based on your team strategy, squad needs, player's profile, and BUDGET GUIDANCE above:

1. Should you bid? (yes/no)
2. If yes, what is your maximum bid (in ₹ crores)? Use the calculated max bid as your ceiling
3. Brief reasoning (1-2 sentences)

**IMPORTANT**:
- Your maxBid should be a realistic competitive bid, NOT overly conservative
- Use the calculated max bid from BUDGET GUIDANCE section as reference
- For marquee players, bid aggressively within your calculated limit

Respond in JSON format:
{
  "decision": "bid" | "pass",
  "maxBid": number (in crores, or null if pass),
  "reasoning": "string"
}`;
  }

  /**
   * Build fallback prompt (when stats unavailable)
   */
  buildFallbackPrompt(context: BidContext, calculatedMaxBid?: number): string {
    return this.buildDecisionPrompt(context, undefined, calculatedMaxBid);
  }

  /**
   * Extract max bid from prompt context
   */
  getContextMaxBid(context: BidContext): number {
    // Use budget manager's calculation if available in context
    // This is a fallback value
    return context.player.basePrice * 1.5;
  }
}
