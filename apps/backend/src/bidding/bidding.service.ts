import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Bid increment rules from PRD
const BID_INCREMENTS = [
  { min: 30, max: 100, increment: 5 },     // ₹30L - ₹1cr: increment ₹5L
  { min: 100, max: 200, increment: 10 },   // ₹1cr - ₹2cr: increment ₹10L
  { min: 200, max: 500, increment: 20 },   // ₹2cr - ₹5cr: increment ₹20L
  { min: 500, max: Infinity, increment: 25 }, // ₹5cr+: increment ₹25L
];

// Squad constraints from PRD
const MIN_SQUAD_SIZE = 18;
const MAX_SQUAD_SIZE = 25;
const MAX_OVERSEAS = 8;

@Injectable()
export class BiddingService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Calculate next valid bid amount based on current bid
   */
  getNextBidIncrement(currentBidLakh: number): number {
    for (const rule of BID_INCREMENTS) {
      if (currentBidLakh >= rule.min && currentBidLakh < rule.max) {
        return rule.increment;
      }
    }
    return BID_INCREMENTS[BID_INCREMENTS.length - 1].increment;
  }

  /**
   * Calculate minimum next bid
   */
  calculateNextBid(currentBidLakh: number): number {
    const increment = this.getNextBidIncrement(currentBidLakh);
    return currentBidLakh + increment;
  }

  /**
   * Validate if a bid is valid
   */
  async validateBid(
    auctionId: string,
    teamId: string,
    playerId: string,
    bidAmountLakh: number,
  ): Promise<{ valid: boolean; error?: string }> {
    // Get auction state
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        currentPlayer: true,
      },
    });

    if (!auction) {
      return { valid: false, error: 'Auction not found' };
    }

    if (auction.status !== 'in_progress') {
      return { valid: false, error: 'Auction is not in progress' };
    }

    if (auction.currentPlayerId !== playerId) {
      return { valid: false, error: 'Player is not currently being auctioned' };
    }

    // Get team details
    const team = await this.prisma.auctionTeam.findUnique({
      where: { id: teamId },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });

    if (!team || team.auctionId !== auctionId) {
      return { valid: false, error: 'Invalid team for this auction' };
    }

    // Check if team has joined
    if (!team.ownerSessionId) {
      return { valid: false, error: 'Team has not joined the auction' };
    }

    // Get player details
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      return { valid: false, error: 'Player not found' };
    }

    // Validate bid amount
    // If no bids yet (currentBidLakh is null), first bid must be at least base price
    // Otherwise, bid must be at least current bid + increment
    let minNextBid: number;

    if (auction.currentBidLakh === null) {
      // First bid - must be at least base price (no increment required)
      minNextBid = player.basePriceLakh;
    } else {
      // Subsequent bids - must be current bid + increment
      minNextBid = this.calculateNextBid(auction.currentBidLakh);
    }

    if (bidAmountLakh < minNextBid) {
      const currentBidDisplay = auction.currentBidLakh ?? player.basePriceLakh;
      return {
        valid: false,
        error: `Bid must be at least ₹${minNextBid}L (minimum increment from ₹${currentBidDisplay}L)`,
      };
    }

    // Check purse
    const bidCr = bidAmountLakh / 100;
    if (team.purseRemainingCr.toNumber() < bidCr) {
      return {
        valid: false,
        error: `Insufficient purse. Available: ₹${team.purseRemainingCr.toNumber()}cr, Required: ₹${bidCr}cr`,
      };
    }

    // Check squad size (18-25 constraint)
    if (team.playerCount >= MAX_SQUAD_SIZE) {
      return {
        valid: false,
        error: `Squad is full (${MAX_SQUAD_SIZE} players maximum)`,
      };
    }

    // Check overseas count
    if (player.isOverseas && team.overseasCount >= MAX_OVERSEAS) {
      return {
        valid: false,
        error: `Maximum ${MAX_OVERSEAS} overseas players allowed`,
      };
    }

    return { valid: true };
  }

  /**
   * Place a bid
   */
  async placeBid(
    auctionId: string,
    teamId: string,
    playerId: string,
    bidAmountLakh: number,
  ) {
    // Validate bid
    const validation = await this.validateBid(auctionId, teamId, playerId, bidAmountLakh);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    // Update auction with new bid
    const updatedAuction = await this.prisma.auction.update({
      where: { id: auctionId },
      data: {
        currentBidLakh: bidAmountLakh,
        currentBiddingTeamId: teamId,
      },
      include: {
        currentPlayer: true,
        currentBiddingTeam: true,
      },
    });

    // Create auction event
    await this.prisma.auctionEvent.create({
      data: {
        auctionId,
        playerId,
        eventType: 'BID',
        teamId,
        bidAmountCr: bidAmountLakh / 100,
        metadata: {
          round: updatedAuction.currentRound,
          set: updatedAuction.currentSet,
        },
      },
    });

    // Update Redis state
    await this.redis.setAuctionState(auctionId, 'currentBidLakh', bidAmountLakh.toString());
    await this.redis.setAuctionState(auctionId, 'currentBiddingTeamId', teamId);

    console.log(`💰 Bid placed: ${updatedAuction.currentBiddingTeam?.teamName} - ₹${bidAmountLakh}L for ${updatedAuction.currentPlayer?.name}`);

    return {
      auction: updatedAuction,
      player: updatedAuction.currentPlayer,
      biddingTeam: updatedAuction.currentBiddingTeam,
      bidAmountLakh,
    };
  }

  /**
   * Sell player to current highest bidder
   */
  async sellPlayer(auctionId: string, playerId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        currentPlayer: true,
        currentBiddingTeam: true,
      },
    });

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.currentPlayerId !== playerId) {
      throw new BadRequestException('Player is not currently being auctioned');
    }

    if (!auction.currentBiddingTeamId || !auction.currentBidLakh) {
      throw new BadRequestException('No bids placed for this player');
    }

    const finalPriceCr = auction.currentBidLakh / 100;

    // Check if player is already assigned to a team IN THIS AUCTION
    const existingAssignment = await this.prisma.teamPlayer.findFirst({
      where: {
        playerId,
        team: {
          auctionId,
        },
      },
      include: { team: true, player: true },
    });

    if (existingAssignment) {
      // Player was already sold/retained - this shouldn't happen
      throw new BadRequestException(
        `Player "${existingAssignment.player.name}" is already assigned to team "${existingAssignment.team.teamName}" ` +
        `for ₹${existingAssignment.purchasePriceCr}cr. This indicates the auction state is inconsistent. ` +
        `Please click "Next" to load a new player instead of selling the current player again.`
      );
    }

    // Add player to team
    await this.prisma.teamPlayer.create({
      data: {
        teamId: auction.currentBiddingTeamId,
        playerId,
        purchasePriceCr: finalPriceCr,
        isRetained: false,
      },
    });

    // Update team stats
    const player = auction.currentPlayer;
    if (!player) {
      throw new BadRequestException('Current player not found');
    }

    await this.prisma.auctionTeam.update({
      where: { id: auction.currentBiddingTeamId },
      data: {
        purseRemainingCr: { decrement: finalPriceCr },
        playerCount: { increment: 1 },
        overseasCount: player.isOverseas ? { increment: 1 } : undefined,
      },
    });

    // Create SOLD event
    await this.prisma.auctionEvent.create({
      data: {
        auctionId,
        playerId,
        eventType: 'SOLD',
        teamId: auction.currentBiddingTeamId,
        bidAmountCr: finalPriceCr,
        metadata: {
          round: auction.currentRound,
          set: auction.currentSet,
        },
      },
    });

    console.log(`✅ SOLD: ${player.name} to ${auction.currentBiddingTeam?.teamName} for ₹${finalPriceCr}cr`);

    return {
      player,
      team: auction.currentBiddingTeam,
      finalPriceCr,
    };
  }

  /**
   * Mark player as unsold
   */
  async markUnsold(auctionId: string, playerId: string) {
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        currentPlayer: true,
      },
    });

    if (!auction) {
      throw new BadRequestException('Auction not found');
    }

    if (auction.currentPlayerId !== playerId) {
      throw new BadRequestException('Player is not currently being auctioned');
    }

    // Create UNSOLD event
    await this.prisma.auctionEvent.create({
      data: {
        auctionId,
        playerId,
        eventType: 'UNSOLD',
        metadata: {
          round: auction.currentRound,
          set: auction.currentSet,
        },
      },
    });

    console.log(`⏭️  UNSOLD: ${auction.currentPlayer?.name}`);

    return {
      player: auction.currentPlayer,
    };
  }
}
