import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface TeamRetention {
  retentionCostCr: number;
}

// IPL 2024 retention costs from PRD (RTM cards calculated dynamically)
const TEAM_RETENTIONS: Record<string, TeamRetention> = {
  RCB: { retentionCostCr: 37 },
  RR: { retentionCostCr: 79 },
  CSK: { retentionCostCr: 65 },
  KKR: { retentionCostCr: 57 },
  PBKS: { retentionCostCr: 9.5 },
  DC: { retentionCostCr: 47 },
  LSG: { retentionCostCr: 51 },
  SRH: { retentionCostCr: 75 },
  GT: { retentionCostCr: 51 },
  MI: { retentionCostCr: 75 },
};

const IPL_TEAMS = ['RCB', 'CSK', 'MI', 'KKR', 'DC', 'RR', 'PBKS', 'SRH', 'GT', 'LSG'];
const BASE_PURSE_CR = 120;
const MAX_RETENTION_PLUS_RTM = 6; // Total of 6 Retentions + RTMs

@Injectable()
export class TeamsInitService {
  constructor(private prisma: PrismaService) {}

  /**
   * Initialize all 10 IPL teams for an auction with retentions
   */
  async initializeTeams(auctionId: string): Promise<void> {
    console.log(`🏏 Initializing teams for auction ${auctionId}`);

    for (const teamName of IPL_TEAMS) {
      const retention = TEAM_RETENTIONS[teamName];
      const purseRemaining = BASE_PURSE_CR - retention.retentionCostCr;

      // Count retained players to calculate RTM cards
      const retainedPlayersCount = await this.prisma.player.count({
        where: {
          auctionSet: 'Retained',
          iplTeam2024: teamName,
        },
      });

      // RTM Cards = 6 - Retentions (from PRD rules)
      const rtmCards = MAX_RETENTION_PLUS_RTM - retainedPlayersCount;

      // Count capped/uncapped retentions to initialize RTM tracking
      const retainedPlayers = await this.prisma.player.findMany({
        where: {
          auctionSet: 'Retained',
          iplTeam2024: teamName,
        },
        select: {
          isCapped: true,
        },
      });

      const cappedRetentions = retainedPlayers.filter(p => p.isCapped).length;
      const uncappedRetentions = retainedPlayers.filter(p => !p.isCapped).length;

      // Create team
      const team = await this.prisma.auctionTeam.create({
        data: {
          auctionId,
          teamName,
          basePurseCr: BASE_PURSE_CR,
          retentionCostCr: retention.retentionCostCr,
          purseRemainingCr: purseRemaining,
          rtmCardsTotal: rtmCards,
          rtmCardsUsed: 0,
          rtmCappedUsed: cappedRetentions,    // Initialize with retention count
          rtmUncappedUsed: uncappedRetentions, // Initialize with retention count
          playerCount: 0,
          overseasCount: 0,
        },
      });

      // Add retained players
      await this.addRetainedPlayers(team.id, teamName);
    }

    console.log(`✅ Initialized ${IPL_TEAMS.length} teams`);
  }

  /**
   * Add retained players to a team from the database
   */
  private async addRetainedPlayers(teamId: string, teamName: string): Promise<void> {
    // Find all retained players for this team
    const retainedPlayers = await this.prisma.player.findMany({
      where: {
        auctionSet: 'Retained',
        iplTeam2024: teamName,
      },
    });

    if (retainedPlayers.length === 0) {
      console.log(`⚠️  No retained players found for ${teamName}`);
      return;
    }

    let totalPlayerCount = 0;
    let totalOverseasCount = 0;

    for (const player of retainedPlayers) {
      // Convert base price from lakhs to crores
      const retentionPriceCr = player.basePriceLakh / 100;

      // Check if this player is already assigned to THIS SPECIFIC TEAM
      const existing = await this.prisma.teamPlayer.findUnique({
        where: {
          teamId_playerId: {
            teamId,
            playerId: player.id,
          },
        },
      });

      if (existing) {
        // This should not happen in normal flow - it means the team already has this player
        console.warn(`⚠️  Player ${player.name} already assigned to team ${teamName}, skipping`);
        continue;
      }

      await this.prisma.teamPlayer.create({
        data: {
          teamId,
          playerId: player.id,
          purchasePriceCr: retentionPriceCr,
          isRetained: true,
          retentionPriceCr: retentionPriceCr,
        },
      });

      totalPlayerCount++;
      if (player.isOverseas) {
        totalOverseasCount++;
      }
    }

    // Update team counts
    await this.prisma.auctionTeam.update({
      where: { id: teamId },
      data: {
        playerCount: totalPlayerCount,
        overseasCount: totalOverseasCount,
      },
    });

    console.log(`  ✅ ${teamName}: ${totalPlayerCount} players (${totalOverseasCount} overseas)`);
  }

  /**
   * Get team details with retained players
   */
  async getTeamDetails(teamId: string) {
    return this.prisma.auctionTeam.findUnique({
      where: { id: teamId },
      include: {
        players: {
          include: {
            player: true,
          },
          where: {
            isRetained: true,
          },
        },
      },
    });
  }

  /**
   * Get all teams for an auction with basic info
   */
  async getAllTeamsForAuction(auctionId: string) {
    return this.prisma.auctionTeam.findMany({
      where: { auctionId },
      include: {
        players: {
          include: {
            player: true,
          },
          where: {
            isRetained: true,
          },
        },
      },
      orderBy: {
        teamName: 'asc',
      },
    });
  }
}
