import { Controller, Post, Get, Delete, Body, Param, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { AuctionsService } from './auctions.service';
import { CreateAuctionDto } from '../common/dto/create-auction.dto';
import { JoinAuctionDto } from '../common/dto/join-auction.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAuction(@Body() createAuctionDto: CreateAuctionDto) {
    return this.auctionsService.create(createAuctionDto);
  }

  @Get('room/:roomCode')
  async getAuctionByRoomCode(@Param('roomCode') roomCode: string) {
    return this.auctionsService.findByRoomCode(roomCode);
  }

  @Get(':auctionId')
  async getAuctionById(@Param('auctionId') auctionId: string) {
    return this.auctionsService.findById(auctionId);
  }

  @Post(':auctionId/join')
  @HttpCode(HttpStatus.OK)
  async joinAuction(
    @Param('auctionId') auctionId: string,
    @Body() joinAuctionDto: JoinAuctionDto,
  ) {
    return this.auctionsService.joinAuction(
      auctionId,
      joinAuctionDto.teamId,
      joinAuctionDto.sessionId,
    );
  }

  @Post(':auctionId/start')
  @HttpCode(HttpStatus.OK)
  async startAuction(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string },
  ) {
    return this.auctionsService.startAuction(auctionId, body.adminSessionId);
  }

  @Post(':auctionId/skip-player')
  @HttpCode(HttpStatus.OK)
  async skipPlayer(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string; playerId: string },
  ) {
    return this.auctionsService.skipPlayer(auctionId, body.adminSessionId, body.playerId);
  }

  @Post(':auctionId/transition-ar1')
  @HttpCode(HttpStatus.OK)
  async transitionToAR1(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string },
  ) {
    return this.auctionsService.transitionToAcceleratedRound1(auctionId, body.adminSessionId);
  }

  @Post(':auctionId/transition-ar2')
  @HttpCode(HttpStatus.OK)
  async transitionToAR2(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string },
  ) {
    return this.auctionsService.transitionToAcceleratedRound2(auctionId, body.adminSessionId);
  }

  @Post(':auctionId/load-player')
  @HttpCode(HttpStatus.OK)
  async loadSpecificPlayer(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string; playerId: string },
  ) {
    return this.auctionsService.loadSpecificPlayer(auctionId, body.adminSessionId, body.playerId);
  }

  @Get(':auctionId/available-ar1-players')
  async getAvailableAR1Players(@Param('auctionId') auctionId: string) {
    return this.auctionsService.getAvailableAR1Players(auctionId);
  }

  @Get(':auctionId/available-ar2-players')
  async getAvailableAR2Players(@Param('auctionId') auctionId: string) {
    return this.auctionsService.getAvailableAR2Players(auctionId);
  }

  @Post(':auctionId/queue-ar1-players')
  @HttpCode(HttpStatus.OK)
  async queueAR1Players(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string; playerIds: string[] },
  ) {
    return this.auctionsService.queueAR1Players(auctionId, body.adminSessionId, body.playerIds);
  }

  @Post(':auctionId/end')
  @HttpCode(HttpStatus.OK)
  async endAuction(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string },
  ) {
    return this.auctionsService.endAuction(auctionId, body.adminSessionId);
  }

  @Delete(':auctionId')
  @HttpCode(HttpStatus.OK)
  async deleteAuction(
    @Param('auctionId') auctionId: string,
    @Body() body: { adminSessionId: string },
  ) {
    await this.auctionsService.deleteAuction(auctionId, body.adminSessionId);
    return { message: 'Auction deleted successfully' };
  }

  @Post('cleanup/old')
  @HttpCode(HttpStatus.OK)
  async cleanupOldAuctions(@Query('days') days?: string) {
    const olderThanDays = days ? parseInt(days, 10) : 7;
    const count = await this.auctionsService.deleteOldAuctions(olderThanDays);
    return { message: `Deleted ${count} old completed auctions` };
  }

  @Post('cleanup/abandoned')
  @HttpCode(HttpStatus.OK)
  async cleanupAbandonedAuctions() {
    const count = await this.auctionsService.cleanupAbandonedAuctions();
    return { message: `Cleaned up ${count} abandoned auctions` };
  }

  @Post('cleanup/all-except-recent')
  @HttpCode(HttpStatus.OK)
  async cleanupAllExceptRecent() {
    const count = await this.auctionsService.cleanupAllExceptRecent();
    return { message: `Deleted ${count} old auctions, kept most recent one` };
  }

  @Post('cleanup/all')
  @HttpCode(HttpStatus.OK)
  async deleteAllAuctions() {
    const count = await this.auctionsService.deleteAllAuctions();
    return { message: `Deleted ALL ${count} auctions` };
  }

  // Get pool data (sold, pending, unsold players)
  @Get(':auctionId/pool')
  async getPoolData(@Param('auctionId') auctionId: string) {
    return this.auctionsService.getPoolData(auctionId);
  }

  // Get squads data (all teams with their players)
  @Get(':auctionId/squads')
  async getSquadsData(@Param('auctionId') auctionId: string) {
    return this.auctionsService.getSquadsData(auctionId);
  }
}

