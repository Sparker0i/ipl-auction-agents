import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { TeamsInitService } from './teams-init.service';

@Module({
  controllers: [TeamsController],
  providers: [TeamsService, TeamsInitService],
  exports: [TeamsService, TeamsInitService],
})
export class TeamsModule {}
