import { Module } from '@nestjs/common';
import { BiddingService } from './bidding.service';
import { RTMService } from './rtm.service';

@Module({
  providers: [BiddingService, RTMService],
  exports: [BiddingService, RTMService],
})
export class BiddingModule {}
