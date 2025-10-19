import { Page } from 'playwright';
import {
  IStateManager,
  PlayerInAuction,
  Player,
} from '../types/agent.types.js';
import type { Logger } from 'winston';

/**
 * Manages agent's internal state and syncs with auction state
 */
export class StateManager implements IStateManager {
  private currentPlayer: PlayerInAuction | null = null;
  private currentBid: number | null = null;
  private currentBidder: string | null = null;
  private budget: number;
  private squad: Player[] = [];
  private logger: Logger;

  constructor(initialBudget: number, logger: Logger) {
    this.budget = initialBudget;
    this.logger = logger;
  }

  /**
   * Sync state from page
   */
  async syncState(page: Page): Promise<void> {
    try {
      const state = await page.evaluate(() => {
        // Try to get state from globalThis object if exposed by frontend
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const auctionState = (globalThis as any).__auctionState;

        if (auctionState) {
          return {
            currentPlayer: auctionState.currentPlayer,
            currentBid: auctionState.currentBid,
            currentBidder: auctionState.currentBidder,
            myTeamPurse: auctionState.myTeamPurse,
            mySquad: auctionState.mySquad,
          };
        }

        // Fallback: Try to extract from DOM (only available in browser context)
        return {
          currentPlayer: null,
          currentBid: null,
          currentBidder: null,
          myTeamPurse: null,
          mySquad: null,
        };
      });

      // Update current player if changed
      if (state.currentPlayer && typeof state.currentPlayer === 'object') {
        this.currentPlayer = state.currentPlayer as PlayerInAuction;
        this.logger.debug('Current player updated', {
          player: this.currentPlayer.name,
        });
      }

      // Update current bid
      if (state.currentBid !== null) {
        const bid =
          typeof state.currentBid === 'number'
            ? state.currentBid
            : this.parseCurrency(state.currentBid);

        if (bid !== this.currentBid) {
          this.currentBid = bid;
          this.currentBidder = state.currentBidder || null;
          this.logger.debug('Current bid updated', {
            bid: this.currentBid,
            bidder: this.currentBidder,
          });
        }
      }

      // Update budget if available
      if (state.myTeamPurse !== null) {
        const newBudget =
          typeof state.myTeamPurse === 'number'
            ? state.myTeamPurse
            : this.parseCurrency(state.myTeamPurse);

        if (newBudget !== this.budget) {
          this.budget = newBudget;
          this.logger.debug('Budget updated', { budget: this.budget });
        }
      }

      // Update squad if available
      if (state.mySquad && Array.isArray(state.mySquad)) {
        this.squad = state.mySquad as Player[];
        this.logger.debug('Squad updated', { squadSize: this.squad.length });
      }
    } catch (error) {
      this.logger.error('Failed to sync state', { error });
    }
  }

  /**
   * Parse currency string (e.g., "₹725L", "7.25cr") to lakhs
   */
  private parseCurrency(value: string): number {
    if (typeof value === 'number') return value;

    // Remove currency symbols and spaces
    const cleaned = value.replace(/[₹,\s]/g, '');

    // Check for crore suffix
    if (cleaned.endsWith('cr')) {
      return parseFloat(cleaned.replace('cr', '')) * 100;
    }

    // Check for lakh suffix
    if (cleaned.endsWith('L')) {
      return parseFloat(cleaned.replace('L', ''));
    }

    // Assume lakhs if no suffix
    return parseFloat(cleaned);
  }

  /**
   * Get current player being auctioned
   */
  getCurrentPlayer(): PlayerInAuction | null {
    return this.currentPlayer;
  }

  /**
   * Get current bid amount
   */
  getCurrentBid(): number | null {
    return this.currentBid;
  }

  /**
   * Get current bidder
   */
  getCurrentBidder(): string | null {
    return this.currentBidder;
  }

  /**
   * Get team budget
   */
  getBudget(): number {
    return this.budget;
  }

  /**
   * Get squad size
   */
  getSquadSize(): number {
    return this.squad.length;
  }

  /**
   * Get squad
   */
  getSquad(): Player[] {
    return [...this.squad];
  }

  /**
   * Add player to squad
   */
  addPlayer(player: Player): void {
    this.squad.push(player);
    this.budget -= player.price;

    this.logger.info('Player added to squad', {
      player: player.name,
      price: player.price,
      newBudget: this.budget,
      squadSize: this.squad.length,
    });
  }

  /**
   * Update budget manually
   */
  updateBudget(newBudget: number): void {
    this.budget = newBudget;
    this.logger.debug('Budget manually updated', { budget: this.budget });
  }

  /**
   * Reset current player (when new player is presented)
   */
  resetCurrentPlayer(): void {
    this.currentPlayer = null;
    this.currentBid = null;
    this.currentBidder = null;
  }

  /**
   * Set current player manually
   */
  setCurrentPlayer(player: PlayerInAuction, bid: number): void {
    this.currentPlayer = player;
    this.currentBid = bid;
    this.currentBidder = null;
  }

  /**
   * Update current bid for ongoing player
   */
  updateCurrentBid(bid: number): void {
    if (this.currentPlayer) {
      this.currentBid = bid;
      this.logger.debug('Current bid updated', {
        player: this.currentPlayer.name,
        bid: this.currentBid,
      });
    }
  }

  /**
   * Check if we can afford a bid
   */
  canAfford(bidAmount: number): boolean {
    const squadSlotsNeeded = Math.max(0, 18 - this.squad.length);
    const reservedBudget = squadSlotsNeeded * 30; // Reserve 30L per remaining mandatory slot
    const availableBudget = this.budget - reservedBudget;

    return bidAmount <= availableBudget;
  }

  /**
   * Check if squad has space
   */
  hasSquadSpace(): boolean {
    return this.squad.length < 25;
  }

  /**
   * Get overseas count
   */
  getOverseasCount(): number {
    return this.squad.filter((p) => p.isOverseas).length;
  }

  /**
   * Check if can add overseas player
   */
  canAddOverseas(): boolean {
    return this.getOverseasCount() < 8;
  }

  /**
   * Get role distribution
   */
  getRoleDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {
      BATTER: 0,
      BOWLER: 0,
      'ALL-ROUNDER': 0,
      WICKETKEEPER: 0,
    };

    for (const player of this.squad) {
      distribution[player.role] = (distribution[player.role] || 0) + 1;
    }

    return distribution;
  }

  /**
   * Export state for logging
   */
  exportState(): {
    budget: number;
    squadSize: number;
    squad: Player[];
    currentPlayer: PlayerInAuction | null;
    currentBid: number | null;
  } {
    return {
      budget: this.budget,
      squadSize: this.squad.length,
      squad: [...this.squad],
      currentPlayer: this.currentPlayer,
      currentBid: this.currentBid,
    };
  }
}
