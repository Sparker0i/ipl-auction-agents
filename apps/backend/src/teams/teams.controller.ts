import { Controller, Get, Param } from '@nestjs/common';
import { TeamsService } from './teams.service';

@Controller('auctions/:auctionId/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get(':teamId')
  async getTeam(
    @Param('auctionId') auctionId: string,
    @Param('teamId') teamId: string,
  ) {
    return this.teamsService.findOne(auctionId, teamId);
  }
}
