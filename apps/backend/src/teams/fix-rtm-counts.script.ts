import { PrismaClient } from '@prisma/client';

/**
 * Script to fix rtmCappedUsed and rtmUncappedUsed for existing auctions
 * Run this to update teams created before the fix
 */
async function fixRTMCounts() {
  const prisma = new PrismaClient();

  try {
    // Get all teams across all auctions
    const teams = await prisma.auctionTeam.findMany({
      select: {
        id: true,
        teamName: true,
        auctionId: true,
        rtmCappedUsed: true,
        rtmUncappedUsed: true,
      },
    });

    console.log(`Found ${teams.length} teams to update`);

    for (const team of teams) {
      // Find retained players for this team
      const retainedPlayers = await prisma.player.findMany({
        where: {
          auctionSet: 'Retained',
          iplTeam2024: team.teamName,
        },
        select: {
          id: true,
          name: true,
          isCapped: true,
        },
      });

      const cappedRetentions = retainedPlayers.filter(p => p.isCapped).length;
      const uncappedRetentions = retainedPlayers.filter(p => !p.isCapped).length;

      // Update team with correct counts
      await prisma.auctionTeam.update({
        where: { id: team.id },
        data: {
          rtmCappedUsed: cappedRetentions,
          rtmUncappedUsed: uncappedRetentions,
        },
      });

      console.log(
        `✅ Updated ${team.teamName} (Auction: ${team.auctionId}): ` +
        `Capped: ${team.rtmCappedUsed} → ${cappedRetentions}, ` +
        `Uncapped: ${team.rtmUncappedUsed} → ${uncappedRetentions}`
      );
    }

    console.log('\n✅ All teams updated successfully!');
  } catch (error) {
    console.error('❌ Error fixing RTM counts:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
fixRTMCounts()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
