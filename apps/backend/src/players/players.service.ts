import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface PlayerFilters {
  set?: string;
  role?: string;
  isCapped?: boolean;
}

@Injectable()
export class PlayersService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters: PlayerFilters) {
    const where: any = {};

    if (filters.set) where.auctionSet = filters.set;
    if (filters.role) where.role = filters.role;
    if (filters.isCapped !== undefined) where.isCapped = filters.isCapped;

    return this.prisma.player.findMany({
      where,
      orderBy: [{ auctionSet: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    return this.prisma.player.findUnique({
      where: { id },
    });
  }

  async findBySet(auctionSet: string) {
    return this.prisma.player.findMany({
      where: { auctionSet },
      orderBy: { name: 'asc' },
    });
  }
}
