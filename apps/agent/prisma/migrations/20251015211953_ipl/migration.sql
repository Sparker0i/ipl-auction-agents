-- CreateTable
CREATE TABLE "players" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "country" VARCHAR(50) NOT NULL,
    "age" INTEGER,
    "role" VARCHAR(30) NOT NULL,
    "specialism" VARCHAR(100),
    "basePriceLakh" INTEGER NOT NULL,
    "auctionSet" VARCHAR(10) NOT NULL,
    "isCapped" BOOLEAN NOT NULL,
    "isOverseas" BOOLEAN NOT NULL DEFAULT false,
    "iplTeam2024" VARCHAR(10),
    "iplMatches" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "roomCode" VARCHAR(6),
    "type" VARCHAR(10) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'waiting',
    "currentRound" VARCHAR(20),
    "currentSet" VARCHAR(10),
    "currentPlayerId" TEXT,
    "currentBidLakh" INTEGER,
    "currentBiddingTeamId" TEXT,
    "timerSeconds" INTEGER NOT NULL DEFAULT 60,
    "adminSessionId" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_teams" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "teamName" VARCHAR(10) NOT NULL,
    "ownerSessionId" VARCHAR(100),
    "basePurseCr" DECIMAL(5,2) NOT NULL DEFAULT 120.00,
    "retentionCostCr" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "purseRemainingCr" DECIMAL(5,2) NOT NULL,
    "rtmCardsTotal" INTEGER NOT NULL DEFAULT 0,
    "rtmCardsUsed" INTEGER NOT NULL DEFAULT 0,
    "rtmCappedUsed" INTEGER NOT NULL DEFAULT 0,
    "rtmUncappedUsed" INTEGER NOT NULL DEFAULT 0,
    "playerCount" INTEGER NOT NULL DEFAULT 0,
    "overseasCount" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "auction_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_players" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "purchasePriceCr" DECIMAL(5,2) NOT NULL,
    "isRetained" BOOLEAN NOT NULL DEFAULT false,
    "retentionPriceCr" DECIMAL(5,2),
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_events" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "eventType" VARCHAR(20) NOT NULL,
    "teamId" TEXT,
    "bidAmountCr" DECIMAL(5,2),
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "players_auctionSet_idx" ON "players"("auctionSet");

-- CreateIndex
CREATE INDEX "players_role_idx" ON "players"("role");

-- CreateIndex
CREATE INDEX "players_iplTeam2024_idx" ON "players"("iplTeam2024");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_roomCode_key" ON "auctions"("roomCode");

-- CreateIndex
CREATE INDEX "auctions_status_idx" ON "auctions"("status");

-- CreateIndex
CREATE INDEX "auctions_roomCode_idx" ON "auctions"("roomCode");

-- CreateIndex
CREATE INDEX "auction_teams_auctionId_idx" ON "auction_teams"("auctionId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_teams_auctionId_teamName_key" ON "auction_teams"("auctionId", "teamName");

-- CreateIndex
CREATE INDEX "team_players_teamId_idx" ON "team_players"("teamId");

-- CreateIndex
CREATE INDEX "team_players_playerId_idx" ON "team_players"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "team_players_teamId_playerId_key" ON "team_players"("teamId", "playerId");

-- CreateIndex
CREATE INDEX "auction_events_auctionId_idx" ON "auction_events"("auctionId");

-- CreateIndex
CREATE INDEX "auction_events_timestamp_idx" ON "auction_events"("timestamp");

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_currentPlayerId_fkey" FOREIGN KEY ("currentPlayerId") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_currentBiddingTeamId_fkey" FOREIGN KEY ("currentBiddingTeamId") REFERENCES "auction_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_teams" ADD CONSTRAINT "auction_teams_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "auction_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_players" ADD CONSTRAINT "team_players_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_events" ADD CONSTRAINT "auction_events_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_events" ADD CONSTRAINT "auction_events_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_events" ADD CONSTRAINT "auction_events_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "auction_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
