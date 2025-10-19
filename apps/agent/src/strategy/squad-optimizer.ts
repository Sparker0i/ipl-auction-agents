import { Player, PlayerRole } from '../types/agent.types.js';
import { TeamStrategy, SquadAnalysis, BudgetPhase } from '../types/strategy.types.js';

/**
 * Squad composition analysis and optimization
 */
export class SquadOptimizer {
  private strategy: TeamStrategy;

  constructor(strategy: TeamStrategy) {
    this.strategy = strategy;
  }

  /**
   * Analyze current squad composition
   */
  analyzeSquad(squad: Player[], currentBudget: number): SquadAnalysis {
    const currentSize = squad.length;
    const overseasCount = squad.filter((p) => p.isOverseas).length;

    // Calculate role distribution
    const roleDistribution: Record<PlayerRole, number> = {
      BATTER: 0,
      BOWLER: 0,
      'ALL-ROUNDER': 0,
      WICKETKEEPER: 0,
    };

    for (const player of squad) {
      roleDistribution[player.role]++;
    }

    // Calculate role gaps (positive = need more, negative = have surplus)
    const roleGaps = this.calculateRoleGaps(roleDistribution, currentSize);

    // Determine budget phase
    const phase = this.determineBudgetPhase(currentSize);

    // Calculate budget per remaining slot
    const minSquadSize = 18;
    const slotsRemaining = Math.max(0, minSquadSize - currentSize);
    const budgetPerSlot = slotsRemaining > 0 ? currentBudget / slotsRemaining : currentBudget;

    return {
      currentSize,
      overseasCount,
      roleDistribution,
      roleGaps,
      budgetRemaining: currentBudget,
      budgetPerSlot,
      phase,
    };
  }

  /**
   * Calculate role gaps based on target distribution
   */
  private calculateRoleGaps(
    current: Record<PlayerRole, number>,
    squadSize: number
  ): Record<PlayerRole, number> {
    const targetSize = 20; // Aim for 20-player squad as baseline
    const targetDistribution = this.strategy.roleDistribution;

    const gaps: Record<PlayerRole, number> = {
      BATTER: 0,
      BOWLER: 0,
      'ALL-ROUNDER': 0,
      WICKETKEEPER: 0,
    };

    // Calculate target counts for each role
    gaps.BATTER = Math.ceil((targetDistribution.batters / 100) * targetSize) - current.BATTER;
    gaps.BOWLER = Math.ceil((targetDistribution.bowlers / 100) * targetSize) - current.BOWLER;
    gaps['ALL-ROUNDER'] =
      Math.ceil((targetDistribution.allRounders / 100) * targetSize) - current['ALL-ROUNDER'];
    gaps.WICKETKEEPER =
      Math.ceil((targetDistribution.wicketkeepers / 100) * targetSize) - current.WICKETKEEPER;

    return gaps;
  }

  /**
   * Determine current budget phase
   */
  private determineBudgetPhase(squadSize: number): BudgetPhase {
    if (squadSize < 11) return 'early';
    if (squadSize < 18) return 'mid';
    return 'late';
  }

  /**
   * Check if role is needed
   */
  isRoleNeeded(role: PlayerRole, analysis: SquadAnalysis): boolean {
    return analysis.roleGaps[role] > 0;
  }

  /**
   * Get role priority (higher = more urgent)
   */
  getRolePriority(role: PlayerRole, analysis: SquadAnalysis): number {
    const gap = analysis.roleGaps[role];

    if (gap <= 0) return 0; // Not needed

    // Priority based on gap size and squad phase
    let priority = gap;

    // Increase priority in late phase if role is still missing
    if (analysis.phase === 'late' && gap > 0) {
      priority *= 2;
    }

    // Special wicketkeeper priority (must have at least 1)
    if (role === 'WICKETKEEPER' && analysis.roleDistribution.WICKETKEEPER === 0) {
      priority = 10; // Highest priority
    }

    return priority;
  }

  /**
   * Get critical gaps that must be filled
   */
  getCriticalGaps(analysis: SquadAnalysis): PlayerRole[] {
    const critical: PlayerRole[] = [];

    // Wicketkeeper is critical if we have none
    if (analysis.roleDistribution.WICKETKEEPER === 0) {
      critical.push('WICKETKEEPER');
    }

    // In late phase, any missing role is critical
    if (analysis.phase === 'late') {
      Object.entries(analysis.roleGaps).forEach(([role, gap]) => {
        if (gap > 0 && !critical.includes(role as PlayerRole)) {
          critical.push(role as PlayerRole);
        }
      });
    }

    return critical;
  }

  /**
   * Get desired roles (in priority order)
   */
  getDesiredRoles(analysis: SquadAnalysis): PlayerRole[] {
    const roles: Array<{ role: PlayerRole; priority: number }> = [
      { role: 'BATTER', priority: this.getRolePriority('BATTER', analysis) },
      { role: 'BOWLER', priority: this.getRolePriority('BOWLER', analysis) },
      { role: 'ALL-ROUNDER', priority: this.getRolePriority('ALL-ROUNDER', analysis) },
      { role: 'WICKETKEEPER', priority: this.getRolePriority('WICKETKEEPER', analysis) },
    ];

    return roles
      .filter((r) => r.priority > 0)
      .sort((a, b) => b.priority - a.priority)
      .map((r) => r.role);
  }

  /**
   * Check if we can add an overseas player
   */
  canAddOverseas(analysis: SquadAnalysis): boolean {
    return analysis.overseasCount < 8;
  }

  /**
   * Get squad composition description
   */
  getSquadDescription(analysis: SquadAnalysis): string {
    const { roleDistribution, roleGaps } = analysis;

    const parts: string[] = [];

    // Current composition
    parts.push(
      `Current: ${roleDistribution.BATTER} batters, ${roleDistribution.BOWLER} bowlers, ` +
        `${roleDistribution['ALL-ROUNDER']} all-rounders, ${roleDistribution.WICKETKEEPER} wicketkeepers`
    );

    // Gaps
    const gapParts: string[] = [];
    Object.entries(roleGaps).forEach(([role, gap]) => {
      if (gap > 0) {
        gapParts.push(`need ${gap} more ${role.toLowerCase()}${gap > 1 ? 's' : ''}`);
      }
    });

    if (gapParts.length > 0) {
      parts.push(`Gaps: ${gapParts.join(', ')}`);
    } else {
      parts.push('Squad balanced');
    }

    return parts.join('. ');
  }

  /**
   * Get role gap for specific role
   */
  getRoleGap(role: PlayerRole, analysis: SquadAnalysis): number {
    return analysis.roleGaps[role];
  }

  /**
   * Check if squad meets minimum requirements
   */
  meetsMinimumRequirements(analysis: SquadAnalysis): boolean {
    // Must have at least 18 players
    if (analysis.currentSize < 18) return false;

    // Must have at least 1 wicketkeeper
    if (analysis.roleDistribution.WICKETKEEPER === 0) return false;

    // Should have at least some of each role
    if (analysis.roleDistribution.BATTER === 0) return false;
    if (analysis.roleDistribution.BOWLER === 0) return false;

    return true;
  }

  /**
   * Get squad balance score (0-100)
   */
  getSquadBalanceScore(analysis: SquadAnalysis): number {
    const { roleDistribution, currentSize } = analysis;

    if (currentSize === 0) return 0;

    // Calculate percentage distribution
    const actualPercent = {
      batters: (roleDistribution.BATTER / currentSize) * 100,
      bowlers: (roleDistribution.BOWLER / currentSize) * 100,
      allRounders: (roleDistribution['ALL-ROUNDER'] / currentSize) * 100,
      wicketkeepers: (roleDistribution.WICKETKEEPER / currentSize) * 100,
    };

    // Calculate deviation from target
    const targetPercent = this.strategy.roleDistribution;

    const deviation =
      Math.abs(actualPercent.batters - targetPercent.batters) +
      Math.abs(actualPercent.bowlers - targetPercent.bowlers) +
      Math.abs(actualPercent.allRounders - targetPercent.allRounders) +
      Math.abs(actualPercent.wicketkeepers - targetPercent.wicketkeepers);

    // Convert deviation to score (lower deviation = higher score)
    // Max deviation would be 400 (100% off for each role)
    const score = Math.max(0, 100 - (deviation / 4));

    return Math.round(score);
  }

  /**
   * Get recommended player types for current phase
   */
  getRecommendedPlayerTypes(analysis: SquadAnalysis): {
    roles: PlayerRole[];
    experience: 'high' | 'medium' | 'low' | 'any';
    overseas: boolean;
  } {
    const roles = this.getDesiredRoles(analysis);

    let experience: 'high' | 'medium' | 'low' | 'any' = 'any';
    if (this.strategy.priorities.experience > 0.7) {
      experience = 'high';
    } else if (this.strategy.priorities.youth > 0.7) {
      experience = 'low';
    }

    const overseas = this.canAddOverseas(analysis);

    return { roles, experience, overseas };
  }
}
