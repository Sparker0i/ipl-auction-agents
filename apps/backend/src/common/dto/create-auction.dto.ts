import { IsString, IsEnum, MinLength, MaxLength } from 'class-validator';

export enum AuctionType {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

export class CreateAuctionDto {
  @IsString()
  @MinLength(3, { message: 'Auction name must be at least 3 characters' })
  @MaxLength(50, { message: 'Auction name must not exceed 50 characters' })
  name: string;

  @IsEnum(AuctionType)
  type: AuctionType;
}
