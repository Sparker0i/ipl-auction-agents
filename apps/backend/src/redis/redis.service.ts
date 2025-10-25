import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = parseInt(this.configService.get<string>('REDIS_PORT', '6379'), 10);
    const password = this.configService.get<string>('REDIS_PASSWORD');

    console.log('🔧 Redis configuration:', { host, port, hasPassword: !!password });

    this.client = createClient({
      socket: {
        host,
        port,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('❌ Redis: Too many reconnection attempts');
            return new Error('Too many retries');
          }
          console.log(`🔄 Redis: Reconnecting (attempt ${retries})...`);
          return retries * 100; // Exponential backoff
        },
      },
      password: password || undefined,
    });

    this.client.on('error', (err) => console.error('Redis Client Error:', err));
    this.client.on('connect', () => console.log('✅ Redis connected'));
    this.client.on('reconnecting', () => console.log('🔄 Redis reconnecting...'));
    this.client.on('ready', () => console.log('✅ Redis ready'));

    await this.client.connect();
    console.log('✅ Redis client connected and authenticated');
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

  // Auction data caching operations
  async cacheAuction(auctionId: string, auctionData: any, ttlSeconds: number = 30): Promise<void> {
    await this.client.set(
      `auction:${auctionId}:cache`,
      JSON.stringify(auctionData),
      { EX: ttlSeconds },
    );
  }

  async getCachedAuction(auctionId: string): Promise<any | null> {
    const data = await this.client.get(`auction:${auctionId}:cache`);
    return data ? JSON.parse(data) : null;
  }

  async invalidateAuctionCache(auctionId: string): Promise<void> {
    await this.client.del(`auction:${auctionId}:cache`);
  }

  // Team data caching operations
  async cacheTeam(teamId: string, teamData: any, ttlSeconds: number = 30): Promise<void> {
    await this.client.set(
      `team:${teamId}:cache`,
      JSON.stringify(teamData),
      { EX: ttlSeconds },
    );
  }

  async getCachedTeam(teamId: string): Promise<any | null> {
    const data = await this.client.get(`team:${teamId}:cache`);
    return data ? JSON.parse(data) : null;
  }

  async invalidateTeamCache(teamId: string): Promise<void> {
    await this.client.del(`team:${teamId}:cache`);
  }

  // Batch invalidation for auction updates
  async invalidateAuctionAndTeams(auctionId: string, teamIds: string[]): Promise<void> {
    const pipeline = this.client.multi();
    pipeline.del(`auction:${auctionId}:cache`);
    for (const teamId of teamIds) {
      pipeline.del(`team:${teamId}:cache`);
    }
    await pipeline.exec();
  }

  // Player data caching operations
  async cachePlayer(playerId: string, playerData: any, ttlSeconds: number = 300): Promise<void> {
    await this.client.set(
      `player:${playerId}:cache`,
      JSON.stringify(playerData),
      { EX: ttlSeconds }, // Players change less frequently, longer TTL
    );
  }

  async getCachedPlayer(playerId: string): Promise<any | null> {
    const data = await this.client.get(`player:${playerId}:cache`);
    return data ? JSON.parse(data) : null;
  }

  // Batch operations for multiple keys
  async batchGet(keys: string[]): Promise<(any | null)[]> {
    const pipeline = this.client.multi();
    for (const key of keys) {
      pipeline.get(key);
    }
    const results = await pipeline.exec();
    return results.map(result => result ? JSON.parse(result as string) : null);
  }

  async batchSet(items: { key: string; value: any; ttl?: number }[]): Promise<void> {
    const pipeline = this.client.multi();
    for (const item of items) {
      pipeline.set(
        item.key,
        JSON.stringify(item.value),
        item.ttl ? { EX: item.ttl } : undefined,
      );
    }
    await pipeline.exec();
  }

  // Pass tracking operations
  async markTeamPassed(auctionId: string, playerId: string, teamId: string): Promise<void> {
    const key = `auction:${auctionId}:player:${playerId}:passes`;
    await this.client.sAdd(key, teamId);
    // Set expiry: passes are valid only for this player's auction
    await this.client.expire(key, 300); // 5 minutes
  }

  async checkTeamPassed(auctionId: string, playerId: string, teamId: string): Promise<boolean> {
    const key = `auction:${auctionId}:player:${playerId}:passes`;
    return this.client.sIsMember(key, teamId);
  }

  async clearTeamPass(auctionId: string, playerId: string, teamId: string): Promise<void> {
    const key = `auction:${auctionId}:player:${playerId}:passes`;
    await this.client.sRem(key, teamId);
  }

  async getPassedTeams(auctionId: string, playerId: string): Promise<string[]> {
    const key = `auction:${auctionId}:player:${playerId}:passes`;
    return this.client.sMembers(key);
  }

  async clearPassesForPlayer(auctionId: string, playerId: string): Promise<void> {
    const key = `auction:${auctionId}:player:${playerId}:passes`;
    await this.client.del(key);
  }
}
