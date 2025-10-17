import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class JoinAuctionDto {
  @IsUUID()
  teamId: string;

  @IsString()
  @MinLength(10)
  @MaxLength(100)
  sessionId: string;
}
