import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService) {}

  async findOne(auctionId: string, teamId: string) {
    return this.prisma.auctionTeam.findFirst({
      where: {
        id: teamId,
        auctionId,
      },
      include: {
        players: {
          include: {
            player: true,
          },
        },
      },
    });
  }
}
