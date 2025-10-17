import { Module, forwardRef } from '@nestjs/common';
import { AuctionGateway } from './auction.gateway';
import { BiddingModule } from '../bidding/bidding.module';
import { PlayersModule } from '../players/players.module';
import { AuctionsModule } from '../auctions/auctions.module';

@Module({
  imports: [
    BiddingModule,
    PlayersModule,
    forwardRef(() => AuctionsModule),
  ],
  providers: [AuctionGateway],
  exports: [AuctionGateway],
})
export class WebSocketModule {}
