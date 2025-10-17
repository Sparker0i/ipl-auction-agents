import { Controller, Get, Query } from '@nestjs/common';
import { PlayersService } from './players.service';

@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get()
  async getPlayers(
    @Query('set') set?: string,
    @Query('role') role?: string,
    @Query('isCapped') isCapped?: string,
  ) {
    return this.playersService.findAll({
      set,
      role,
      isCapped: isCapped === 'true' ? true : isCapped === 'false' ? false : undefined,
    });
  }

  @Get(':id')
  async getPlayer(@Query('id') id: string) {
    return this.playersService.findOne(id);
  }
}
