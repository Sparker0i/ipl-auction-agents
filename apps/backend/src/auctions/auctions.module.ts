import { Module, forwardRef } from '@nestjs/common';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { TeamsModule } from '../teams/teams.module';
import { PlayersModule } from '../players/players.module';
import { WebSocketModule } from '../websocket/websocket.module';

@Module({
  imports: [TeamsModule, PlayersModule, forwardRef(() => WebSocketModule)],
  controllers: [AuctionsController],
  providers: [AuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
