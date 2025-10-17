import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.client = createClient({
      socket: {
        host,
        port,
      },
    });

    this.client.on('error', (err) => console.error('Redis Client Error:', err));
    this.client.on('connect', () => console.log('✅ Redis connected'));

    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
    console.log('🔌 Redis disconnected');
  }

  getClient(): RedisClientType {
    return this.client;
  }

  // Auction state operations
  async setAuctionState(auctionId: string, field: string, value: string): Promise<void> {
    await this.client.hSet(`auction:${auctionId}:state`, field, value);
  }

  async getAuctionState(auctionId: string, field: string): Promise<string | undefined> {
    return this.client.hGet(`auction:${auctionId}:state`, field);
  }

  async getAllAuctionState(auctionId: string): Promise<Record<string, string>> {
    return this.client.hGetAll(`auction:${auctionId}:state`);
  }

  async deleteAuctionState(auctionId: string): Promise<void> {
    await this.client.del(`auction:${auctionId}:state`);
  }

  // Active users operations
  async addAuctionUser(auctionId: string, sessionId: string): Promise<void> {
    await this.client.sAdd(`auction:${auctionId}:users`, sessionId);
  }

  async removeAuctionUser(auctionId: string, sessionId: string): Promise<void> {
    await this.client.sRem(`auction:${auctionId}:users`, sessionId);
  }

  async getAuctionUsers(auctionId: string): Promise<string[]> {
    return this.client.sMembers(`auction:${auctionId}:users`);
  }

  // Player queue operations
  async pushToPlayerQueue(auctionId: string, set: string, playerId: string): Promise<void> {
    await this.client.rPush(`auction:${auctionId}:queue:${set}`, playerId);
  }

  async popFromPlayerQueue(auctionId: string, set: string): Promise<string | null> {
    return this.client.lPop(`auction:${auctionId}:queue:${set}`);
  }

  async getPlayerQueueLength(auctionId: string, set: string): Promise<number> {
    return this.client.lLen(`auction:${auctionId}:queue:${set}`);
  }

  // RTM state operations
  async setRTMState(auctionId: string, state: any): Promise<void> {
    await this.client.set(
      `auction:${auctionId}:rtm`,
      JSON.stringify(state),
      { EX: 120 }, // 2 minute expiry
    );
  }

  async getRTMState(auctionId: string): Promise<any | null> {
    const data = await this.client.get(`auction:${auctionId}:rtm`);
    return data ? JSON.parse(data) : null;
  }

  async clearRTMState(auctionId: string): Promise<void> {
    await this.client.del(`auction:${auctionId}:rtm`);
  }
}
