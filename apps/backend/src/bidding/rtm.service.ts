import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface RTMState {
  playerId: string;
  playerName: string;
  isCapped: boolean;
  originalWinnerTeamId: string;
  originalWinnerTeamName: string;
  rtmTeamId: string;
  rtmTeamName: string;
  matchedBidLakh: number;
  counterBidAllowed: boolean;
  counterBidMade: boolean; // Track if counter-bid was placed
  expiresAt: number; // timestamp for counter-bid window
}

@Injectable()
export class RTMService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Check if RTM is available for a player
   */
  async checkRTMEligibility(
    auctionId: string,
    playerId: string,
  ): Promise<{ eligible: boolean; teamId?: string; teamName?: string; error?: string }> {
    // Get player details
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player || !player.iplTeam2024) {
      return { eligible: false, error: 'Player not eligible for RTM (no 2024 team)' };
    }

    // Find the team that matches player's 2024 team
    const rtmTeam = await this.prisma.auctionTeam.findFirst({
      where: {
        auctionId,
        teamName: player.iplTeam2024,
      },
    });

    if (!rtmTeam) {
      return { eligible: false, error: 'RTM team not found in auction' };
    }

    // Check if RTM team has joined (ownerSessionId must be set)
    if (!rtmTeam.ownerSessionId) {
      return { eligible: false, error: 'RTM team has not joined the auction' };
    }

    // Check if team has RTM cards available
    if (rtmTeam.rtmCardsUsed >= rtmTeam.rtmCardsTotal) {
      return { eligible: false, error: 'No RTM cards remaining' };
    }

    // Check capped/uncapped limits (max 5 capped, max 2 uncapped)
    console.log(`🔍 RTM Check: ${rtmTeam.teamName} | Player: ${player.name} (${player.isCapped ? 'CAPPED' : 'UNCAPPED'}) | Capped Used: ${rtmTeam.rtmCappedUsed}/5 | Uncapped Used: ${rtmTeam.rtmUncappedUsed}/2`);

    if (player.isCapped && rtmTeam.rtmCappedUsed >= 5) {
      console.log(`❌ RTM blocked: ${rtmTeam.teamName} has ${rtmTeam.rtmCappedUsed}/5 capped slots used (player: ${player.name})`);
      return { eligible: false, error: 'Maximum 5 capped RTM/Retentions reached' };
    }

    if (!player.isCapped && rtmTeam.rtmUncappedUsed >= 2) {
      console.log(`❌ RTM blocked: ${rtmTeam.teamName} has ${rtmTeam.rtmUncappedUsed}/2 uncapped slots used (player: ${player.name})`);
      return { eligible: false, error: 'Maximum 2 uncapped RTM/Retentions reached' };
    }

    console.log(`✅ RTM eligible: ${rtmTeam.teamName} has ${player.isCapped ? rtmTeam.rtmCappedUsed : rtmTeam.rtmUncappedUsed}/${player.isCapped ? 5 : 2} ${player.isCapped ? 'capped' : 'uncapped'} slots used`);


    return {
      eligible: true,
      teamId: rtmTeam.id,
      teamName: rtmTeam.teamName,
    };
  }

  /**
   * Trigger RTM process after player sold
   */
  async triggerRTM(
    auctionId: string,
    playerId: string,
    winningTeamId: string,
    finalBidLakh: number,
  ): Promise<RTMState | null> {
    // Check eligibility
    const eligibility = await this.checkRTMEligibility(auctionId, playerId);

    if (!eligibility.eligible) {
      return null; // RTM not available
    }

    // Verify winning team is NOT the RTM team
    if (eligibility.teamId === winningTeamId) {
      return null; // Can't RTM your own winning bid
    }

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
    });

    if (!player) {
      throw new BadRequestException('Player not found');
    }

    const winningTeam = await this.prisma.auctionTeam.findUnique({
      where: { id: winningTeamId },
    });

    if (!winningTeam) {
      throw new BadRequestException('Winning team not found');
    }

    if (!eligibility.teamId || !eligibility.teamName) {
      throw new BadRequestException('RTM team information missing');
    }

    // Create RTM state in Redis
    const rtmState: RTMState = {
      playerId,
      playerName: player.name,
      isCapped: player.isCapped,
      originalWinnerTeamId: winningTeamId,
      originalWinnerTeamName: winningTeam.teamName,
      rtmTeamId: eligibility.teamId,
      rtmTeamName: eligibility.teamName,
      matchedBidLakh: finalBidLakh,
      counterBidAllowed: false, // Stage 1: Waiting for RTM team to use card
      counterBidMade: false, // No counter-bid yet
      expiresAt: Date.now() + 60000, // 60 second window for counter-bid
    };

    // Store RTM state in Redis with expiry
    await this.redis.setRTMState(auctionId, rtmState);

    console.log(`🎯 RTM triggered: ${eligibility.teamName} can match ₹${finalBidLakh}L for ${player.name}`);

    return rtmState;
  }

  /**
   * Use RTM card - team matches the bid
   */
  async useRTM(
    auctionId: string,
    teamId: string,
  ): Promise<{ success: boolean; state: RTMState; message: string }> {
    // Get RTM state from Redis
    const rtmState = await this.redis.getRTMState(auctionId);

    if (!rtmState) {
      throw new BadRequestException('No active RTM available');
    }

    // Verify it's the correct team
    if (rtmState.rtmTeamId !== teamId) {
      throw new BadRequestException('Only the RTM-eligible team can use RTM');
    }

    // Check if RTM window expired
    if (Date.now() > rtmState.expiresAt) {
      throw new BadRequestException('RTM window has expired');
    }

    // Get RTM team details
    const rtmTeam = await this.prisma.auctionTeam.findUnique({
      where: { id: teamId },
    });

    if (!rtmTeam) {
      throw new BadRequestException('RTM team not found');
    }

    // Validate purse sufficiency for matched bid
    const requiredPurseCr = rtmState.matchedBidLakh / 100;
    if (rtmTeam.purseRemainingCr.toNumber() < requiredPurseCr) {
      throw new BadRequestException('Insufficient purse to match bid');
    }

    // Update state to indicate RTM used, waiting for counter-bid
    rtmState.counterBidAllowed = true;

    await this.redis.setRTMState(auctionId, rtmState);

    console.log(`✅ RTM used by ${rtmState.rtmTeamName} - awaiting counter-bid from ${rtmState.originalWinnerTeamName}`);

    return {
      success: true,
      state: rtmState,
      message: `${rtmState.rtmTeamName} matched the bid. ${rtmState.originalWinnerTeamName} can make ONE final counter-bid.`,
    };
  }

  /**
   * Original winner makes counter-bid
   */
  async counterBid(
    auctionId: string,
    teamId: string,
    newBidLakh: number,
  ): Promise<{ success: boolean; message: string }> {
    // Get RTM state
    const rtmState = await this.redis.getRTMState(auctionId);

    if (!rtmState) {
      throw new BadRequestException('No active RTM process');
    }

    // Verify it's the original winner
    if (rtmState.originalWinnerTeamId !== teamId) {
      throw new BadRequestException('Only original winner can make counter-bid');
    }

    // Check if counter-bid is allowed
    if (!rtmState.counterBidAllowed) {
      throw new BadRequestException('Counter-bid window has closed');
    }

    // Validate bid is higher than matched bid
    if (newBidLakh <= rtmState.matchedBidLakh) {
      throw new BadRequestException('Counter-bid must be higher than matched bid');
    }

    // Get team details
    const team = await this.prisma.auctionTeam.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new BadRequestException('Team not found');
    }

    // Validate purse sufficiency
    const requiredPurseCr = newBidLakh / 100;
    if (team.purseRemainingCr.toNumber() < requiredPurseCr) {
      throw new BadRequestException('Insufficient purse for counter-bid');
    }

    // Update RTM state with counter-bid
    rtmState.matchedBidLakh = newBidLakh;
    rtmState.counterBidAllowed = false; // Only ONE counter-bid allowed
    rtmState.counterBidMade = true; // Counter-bid was placed

    await this.redis.setRTMState(auctionId, rtmState);

    console.log(`💰 Counter-bid: ${rtmState.originalWinnerTeamName} raised to ₹${newBidLakh}L`);

    return {
      success: true,
      message: `${rtmState.originalWinnerTeamName} made counter-bid of ₹${newBidLakh}L`,
    };
  }

  /**
   * Finalize RTM - either RTM team accepts final price or passes
   */
  async finalizeRTM(
    auctionId: string,
    rtmTeamAccepts: boolean,
  ): Promise<{
    success: boolean;
    winningTeamId: string;
    winningTeamName: string;
    finalPriceLakh: number;
    isRTM: boolean;
  }> {
    // Get RTM state
    const rtmState = await this.redis.getRTMState(auctionId);

    if (!rtmState) {
      throw new BadRequestException('No active RTM process');
    }

    const player = await this.prisma.player.findUnique({
      where: { id: rtmState.playerId },
    });

    if (!player) {
      throw new BadRequestException('Player not found');
    }

    let winningTeamId: string;
    let winningTeamName: string;
    let isRTM: boolean;

    if (rtmTeamAccepts) {
      // RTM team wins the player
      winningTeamId = rtmState.rtmTeamId;
      winningTeamName = rtmState.rtmTeamName;
      isRTM = true;

      // Consume RTM card
      await this.consumeRTMCard(rtmState.rtmTeamId, player.isCapped);

      console.log(`✅ RTM finalized: ${winningTeamName} gets ${player.name} for ₹${rtmState.matchedBidLakh}L`);
    } else {
      // RTM team passes, original winner gets the player
      winningTeamId = rtmState.originalWinnerTeamId;
      winningTeamName = rtmState.originalWinnerTeamName;
      isRTM = false;

      console.log(`❌ RTM passed: ${winningTeamName} gets ${player.name} for ₹${rtmState.matchedBidLakh}L`);
    }

    // Check if player is already assigned IN THIS AUCTION (shouldn't happen)
    const existingAssignment = await this.prisma.teamPlayer.findFirst({
      where: {
        playerId: rtmState.playerId,
        team: {
          auctionId,
        },
      },
      include: { team: true },
    });

    if (existingAssignment) {
      throw new BadRequestException(
        `Player "${player.name}" is already assigned to team "${existingAssignment.team.teamName}". ` +
        `This indicates an inconsistent state.`
      );
    }

    // Add player to winning team
    const finalPriceCr = rtmState.matchedBidLakh / 100;
    await this.prisma.teamPlayer.create({
      data: {
        teamId: winningTeamId,
        playerId: rtmState.playerId,
        purchasePriceCr: finalPriceCr,
        isRetained: false,
      },
    });

    // Update team stats
    await this.prisma.auctionTeam.update({
      where: { id: winningTeamId },
      data: {
        purseRemainingCr: { decrement: finalPriceCr },
        playerCount: { increment: 1 },
        overseasCount: player.isOverseas ? { increment: 1 } : undefined,
      },
    });

    // Get auction details for event metadata
    const auction = await this.prisma.auction.findUnique({
      where: { id: auctionId },
      select: { currentRound: true, currentSet: true },
    });

    // Create SOLD event
    await this.prisma.auctionEvent.create({
      data: {
        auctionId,
        playerId: rtmState.playerId,
        eventType: 'SOLD',
        teamId: winningTeamId,
        bidAmountCr: finalPriceCr,
        metadata: {
          round: auction?.currentRound || 'MAIN',
          set: auction?.currentSet || null,
          isRTM,
        },
      },
    });

    console.log(`💰 Player assigned: ${player.name} → ${winningTeamName} for ₹${finalPriceCr}cr`);

    // Clear RTM state
    await this.redis.clearRTMState(auctionId);

    return {
      success: true,
      winningTeamId,
      winningTeamName,
      finalPriceLakh: rtmState.matchedBidLakh,
      isRTM,
    };
  }

  /**
   * Consume RTM card and update team stats
   */
  private async consumeRTMCard(teamId: string, isCapped: boolean): Promise<void> {
    const team = await this.prisma.auctionTeam.findUnique({
      where: { id: teamId },
    });

    if (!team) {
      throw new BadRequestException('Team not found');
    }

    // Update RTM usage
    await this.prisma.auctionTeam.update({
      where: { id: teamId },
      data: {
        rtmCardsUsed: team.rtmCardsUsed + 1,
        rtmCappedUsed: isCapped ? team.rtmCappedUsed + 1 : team.rtmCappedUsed,
        rtmUncappedUsed: !isCapped ? team.rtmUncappedUsed + 1 : team.rtmUncappedUsed,
      },
    });

    console.log(`🎴 RTM card consumed by ${team.teamName} (${isCapped ? 'Capped' : 'Uncapped'})`);
  }

  /**
   * Get current RTM state
   */
  async getRTMState(auctionId: string): Promise<RTMState | null> {
    return this.redis.getRTMState(auctionId);
  }

  /**
   * Cancel/clear RTM state
   */
  async cancelRTM(auctionId: string): Promise<void> {
    await this.redis.clearRTMState(auctionId);
    console.log('❌ RTM cancelled/cleared');
  }
}
