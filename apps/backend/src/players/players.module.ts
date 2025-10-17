import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';
import { PlayerProgressionService } from './player-progression.service';

@Module({
  controllers: [PlayersController],
  providers: [PlayersService, PlayerProgressionService],
  exports: [PlayersService, PlayerProgressionService],
})
export class PlayersModule {}
