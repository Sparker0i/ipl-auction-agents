/**
 * Auction Replay Tool
 * Reconstructs auction timeline from agent logs
 */

import * as fs from 'fs';
import * as path from 'path';
import { TeamCode } from '../types/agent.types.js';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  teamCode?: TeamCode;
  player?: string;
  decision?: string;
  bid?: number;
  reasoning?: string;
  budget?: number;
  squadSize?: number;
}

export interface PlayerEvent {
  playerName: string;
  basePrice: number;
  finalPrice: number;
  soldTo: TeamCode | null;
  timestamp: Date;
  bidHistory: BidEvent[];
}

export interface BidEvent {
  teamCode: TeamCode;
  amount: number;
  timestamp: Date;
}

export interface AuctionTimeline {
  auctionCode: string;
  startTime: Date;
  endTime: Date;
  players: PlayerEvent[];
  teamStats: Map<TeamCode, TeamAuctionStats>;
}

export interface TeamAuctionStats {
  teamCode: TeamCode;
  totalSpent: number;
  playersWon: number;
  bidsMade: number;
  averageBidAmount: number;
  finalSquadSize: number;
  finalBudget: number;
}

export class AuctionReplay {
  private logsDirectory: string;

  constructor(logsDirectory: string) {
    this.logsDirectory = logsDirectory;
  }

  /**
   * Parse all log files and reconstruct auction timeline
   */
  async reconstructAuction(auctionCode: string): Promise<AuctionTimeline> {
    const logFiles = this.findLogFiles(auctionCode);
    const allEntries = await this.parseLogFiles(logFiles);

    // Sort by timestamp
    allEntries.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const timeline: AuctionTimeline = {
      auctionCode,
      startTime: new Date(allEntries[0]?.timestamp || Date.now()),
      endTime: new Date(
        allEntries[allEntries.length - 1]?.timestamp || Date.now()
      ),
      players: [],
      teamStats: new Map(),
    };

    // Process entries to build timeline
    this.buildTimeline(allEntries, timeline);

    return timeline;
  }

  /**
   * Generate replay report as markdown
   */
  generateReport(timeline: AuctionTimeline): string {
    let report = `# Auction Replay Report\n\n`;
    report += `**Auction Code**: ${timeline.auctionCode}\n`;
    report += `**Start**: ${timeline.startTime.toISOString()}\n`;
    report += `**End**: ${timeline.endTime.toISOString()}\n`;
    report += `**Duration**: ${this.formatDuration(timeline.startTime, timeline.endTime)}\n`;
    report += `**Players Sold**: ${timeline.players.length}\n\n`;

    // Team Summary
    report += '## Team Summary\n\n';
    report += '| Team | Players | Total Spent (L) | Avg Bid (L) | Bids Made | Final Budget (L) |\n';
    report += '|------|---------|-----------------|-------------|-----------|------------------|\n';

    const sortedTeams = Array.from(timeline.teamStats.values()).sort(
      (a, b) => b.totalSpent - a.totalSpent
    );

    for (const team of sortedTeams) {
      report += `| ${team.teamCode} | ${team.playersWon} | ${team.totalSpent} | ${Math.round(team.averageBidAmount)} | ${team.bidsMade} | ${team.finalBudget} |\n`;
    }

    // Player Sales Timeline
    report += '\n## Player Sales Timeline\n\n';

    for (let i = 0; i < timeline.players.length; i++) {
      const player = timeline.players[i];
      const num = i + 1;

      report += `### ${num}. ${player.playerName}\n\n`;
      report += `- **Base Price**: ₹${player.basePrice}L\n`;
      report += `- **Sold For**: ₹${player.finalPrice}L\n`;
      report += `- **Sold To**: ${player.soldTo || 'Unsold'}\n`;
      report += `- **Time**: ${player.timestamp.toLocaleTimeString()}\n`;

      if (player.bidHistory.length > 0) {
        report += `- **Bid History** (${player.bidHistory.length} bids):\n`;
        for (const bid of player.bidHistory) {
          report += `  - ${bid.teamCode}: ₹${bid.amount}L\n`;
        }
      }

      report += '\n';
    }

    return report;
  }

  /**
   * Generate HTML replay visualization
   */
  generateHTMLReplay(timeline: AuctionTimeline): string {
    let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Auction Replay - ${timeline.auctionCode}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 { color: #1a1a1a; }
    .summary {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .player-card {
      background: white;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .player-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 10px;
      margin-bottom: 10px;
    }
    .player-name {
      font-size: 1.2em;
      font-weight: bold;
      color: #1a1a1a;
    }
    .price {
      font-size: 1.1em;
      color: #2196F3;
      font-weight: bold;
    }
    .bid-history {
      margin-top: 10px;
    }
    .bid {
      display: inline-block;
      background: #e3f2fd;
      padding: 5px 10px;
      margin: 5px 5px 0 0;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .sold-to {
      background: #4CAF50;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
      font-weight: bold;
    }
    .unsold {
      background: #f44336;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e0e0e0;
    }
    th {
      background: #1976D2;
      color: white;
      font-weight: 600;
    }
    tr:hover {
      background: #f5f5f5;
    }
  </style>
</head>
<body>
  <h1>🏏 Auction Replay: ${timeline.auctionCode}</h1>

  <div class="summary">
    <h2>Auction Summary</h2>
    <p><strong>Duration:</strong> ${this.formatDuration(timeline.startTime, timeline.endTime)}</p>
    <p><strong>Players Sold:</strong> ${timeline.players.length}</p>
    <p><strong>Start:</strong> ${timeline.startTime.toLocaleString()}</p>
    <p><strong>End:</strong> ${timeline.endTime.toLocaleString()}</p>
  </div>

  <div class="summary">
    <h2>Team Performance</h2>
    <table>
      <thead>
        <tr>
          <th>Team</th>
          <th>Players</th>
          <th>Total Spent</th>
          <th>Avg Bid</th>
          <th>Bids Made</th>
          <th>Budget Left</th>
        </tr>
      </thead>
      <tbody>`;

    const sortedTeams = Array.from(timeline.teamStats.values()).sort(
      (a, b) => b.totalSpent - a.totalSpent
    );

    for (const team of sortedTeams) {
      html += `
        <tr>
          <td><strong>${team.teamCode}</strong></td>
          <td>${team.playersWon}</td>
          <td>₹${team.totalSpent}L</td>
          <td>₹${Math.round(team.averageBidAmount)}L</td>
          <td>${team.bidsMade}</td>
          <td>₹${team.finalBudget}L</td>
        </tr>`;
    }

    html += `
      </tbody>
    </table>
  </div>

  <h2>Player Sales</h2>`;

    for (let i = 0; i < timeline.players.length; i++) {
      const player = timeline.players[i];
      const soldBadge = player.soldTo
        ? `<span class="sold-to">${player.soldTo}</span>`
        : `<span class="unsold">UNSOLD</span>`;

      html += `
  <div class="player-card">
    <div class="player-header">
      <span class="player-name">${i + 1}. ${player.playerName}</span>
      ${soldBadge}
    </div>
    <p>
      <strong>Base:</strong> ₹${player.basePrice}L →
      <span class="price">₹${player.finalPrice}L</span>
    </p>`;

      if (player.bidHistory.length > 0) {
        html += `
    <div class="bid-history">
      <strong>Bids (${player.bidHistory.length}):</strong><br>`;

        for (const bid of player.bidHistory) {
          html += `<span class="bid">${bid.teamCode}: ₹${bid.amount}L</span>`;
        }

        html += `
    </div>`;
      }

      html += `
  </div>`;
    }

    html += `
</body>
</html>`;

    return html;
  }

  /**
   * Find log files for auction
   */
  private findLogFiles(auctionCode: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(this.logsDirectory)) {
      return files;
    }

    const entries = fs.readdirSync(this.logsDirectory);

    for (const entry of entries) {
      const fullPath = path.join(this.logsDirectory, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isFile() && entry.endsWith('.log')) {
        // Check if file contains auction code
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes(auctionCode)) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  /**
   * Parse log files into entries
   */
  private async parseLogFiles(logFiles: string[]): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];

    for (const file of logFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line) as LogEntry;
          entries.push(entry);
        } catch {
          // Skip invalid JSON lines
        }
      }
    }

    return entries;
  }

  /**
   * Build timeline from log entries
   */
  private buildTimeline(
    entries: LogEntry[],
    timeline: AuctionTimeline
  ): void {
    let currentPlayer: PlayerEvent | null = null;

    // Initialize team stats
    const teamCodes: TeamCode[] = [
      'CSK',
      'MI',
      'RCB',
      'DC',
      'PBKS',
      'RR',
      'KKR',
      'LSG',
      'SRH',
      'GT',
    ];

    for (const teamCode of teamCodes) {
      timeline.teamStats.set(teamCode, {
        teamCode,
        totalSpent: 0,
        playersWon: 0,
        bidsMade: 0,
        averageBidAmount: 0,
        finalSquadSize: 0,
        finalBudget: 12000, // Starting budget
      });
    }

    // Process entries
    for (const entry of entries) {
      // Detect new player
      if (entry.message.includes('New player') || entry.player) {
        if (currentPlayer) {
          timeline.players.push(currentPlayer);
        }

        currentPlayer = {
          playerName: entry.player || 'Unknown',
          basePrice: 0,
          finalPrice: 0,
          soldTo: null,
          timestamp: new Date(entry.timestamp),
          bidHistory: [],
        };
      }

      // Detect bid
      if (entry.message.includes('Placed bid') && entry.teamCode && entry.bid) {
        if (currentPlayer) {
          currentPlayer.bidHistory.push({
            teamCode: entry.teamCode,
            amount: entry.bid,
            timestamp: new Date(entry.timestamp),
          });

          const teamStats = timeline.teamStats.get(entry.teamCode);
          if (teamStats) {
            teamStats.bidsMade++;
          }
        }
      }

      // Detect player sold
      if (entry.message.includes('Player sold') && currentPlayer) {
        const lastBid = currentPlayer.bidHistory[currentPlayer.bidHistory.length - 1];
        if (lastBid) {
          currentPlayer.soldTo = lastBid.teamCode;
          currentPlayer.finalPrice = lastBid.amount;

          const teamStats = timeline.teamStats.get(lastBid.teamCode);
          if (teamStats) {
            teamStats.totalSpent += lastBid.amount;
            teamStats.playersWon++;
            teamStats.finalBudget -= lastBid.amount;
            teamStats.finalSquadSize++;
          }
        }
      }

      // Update budget tracking
      if (entry.teamCode && entry.budget !== undefined) {
        const teamStats = timeline.teamStats.get(entry.teamCode);
        if (teamStats) {
          teamStats.finalBudget = entry.budget;
        }
      }

      // Update squad size
      if (entry.teamCode && entry.squadSize !== undefined) {
        const teamStats = timeline.teamStats.get(entry.teamCode);
        if (teamStats) {
          teamStats.finalSquadSize = entry.squadSize;
        }
      }
    }

    // Add last player
    if (currentPlayer) {
      timeline.players.push(currentPlayer);
    }

    // Calculate average bid amounts
    for (const stats of timeline.teamStats.values()) {
      if (stats.bidsMade > 0) {
        stats.averageBidAmount = stats.totalSpent / stats.bidsMade;
      }
    }
  }

  /**
   * Format duration
   */
  private formatDuration(start: Date, end: Date): string {
    const durationMs = end.getTime() - start.getTime();
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }
}
