/**
 * Log Aggregator
 * Collects and merges logs from all agent processes
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import type { LogConfig } from '../types/agent.types.js';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  teamCode?: string;
  [key: string]: any;
}

export class LogAggregator {
  private config: LogConfig;
  private logDirectory: string;
  private watchers: fs.FSWatcher[] = [];
  private aggregatedLogPath: string;
  private aggregatedStream: fs.WriteStream | null = null;
  private running: boolean = false;

  constructor(config: LogConfig) {
    this.config = config;
    this.logDirectory = config.directory;
    this.aggregatedLogPath = path.join(this.logDirectory, 'combined.log');
  }

  /**
   * Start log aggregation
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    // Ensure log directory exists
    if (!fs.existsSync(this.logDirectory)) {
      fs.mkdirSync(this.logDirectory, { recursive: true });
    }

    // Open aggregated log file
    this.aggregatedStream = fs.createWriteStream(this.aggregatedLogPath, {
      flags: 'a',
      encoding: 'utf-8',
    });

    // Watch all existing log files
    this.watchLogFiles();
  }

  /**
   * Stop log aggregation
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Close all watchers
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    // Close aggregated stream
    if (this.aggregatedStream) {
      this.aggregatedStream.end();
      this.aggregatedStream = null;
    }
  }

  /**
   * Get aggregated logs for a time range
   */
  async getLogEntries(
    startTime?: Date,
    endTime?: Date,
    teamCode?: string
  ): Promise<LogEntry[]> {
    const entries: LogEntry[] = [];

    if (!fs.existsSync(this.aggregatedLogPath)) {
      return entries;
    }

    const fileStream = fs.createReadStream(this.aggregatedLogPath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line) as LogEntry;

        // Filter by time range
        if (startTime && new Date(entry.timestamp) < startTime) {
          continue;
        }
        if (endTime && new Date(entry.timestamp) > endTime) {
          continue;
        }

        // Filter by team
        if (teamCode && entry.teamCode !== teamCode) {
          continue;
        }

        entries.push(entry);
      } catch {
        // Skip invalid JSON lines
      }
    }

    return entries;
  }

  /**
   * Get logs by level
   */
  async getLogsByLevel(level: string): Promise<LogEntry[]> {
    const allEntries = await this.getLogEntries();
    return allEntries.filter((entry) => entry.level === level);
  }

  /**
   * Search logs by message content
   */
  async searchLogs(query: string): Promise<LogEntry[]> {
    const allEntries = await this.getLogEntries();
    return allEntries.filter((entry) =>
      entry.message.toLowerCase().includes(query.toLowerCase())
    );
  }

  /**
   * Get error logs
   */
  async getErrors(): Promise<LogEntry[]> {
    return this.getLogsByLevel('error');
  }

  /**
   * Get warning logs
   */
  async getWarnings(): Promise<LogEntry[]> {
    return this.getLogsByLevel('warn');
  }

  /**
   * Generate log summary
   */
  async generateSummary(): Promise<{
    totalEntries: number;
    byLevel: Record<string, number>;
    byTeam: Record<string, number>;
    timeRange: { start: string; end: string };
  }> {
    const entries = await this.getLogEntries();

    const summary = {
      totalEntries: entries.length,
      byLevel: {} as Record<string, number>,
      byTeam: {} as Record<string, number>,
      timeRange: {
        start: entries[0]?.timestamp || '',
        end: entries[entries.length - 1]?.timestamp || '',
      },
    };

    for (const entry of entries) {
      // Count by level
      summary.byLevel[entry.level] = (summary.byLevel[entry.level] || 0) + 1;

      // Count by team
      if (entry.teamCode) {
        summary.byTeam[entry.teamCode] =
          (summary.byTeam[entry.teamCode] || 0) + 1;
      }
    }

    return summary;
  }

  /**
   * Export logs to file
   */
  async exportLogs(
    outputPath: string,
    options?: {
      startTime?: Date;
      endTime?: Date;
      teamCode?: string;
      level?: string;
    }
  ): Promise<void> {
    let entries = await this.getLogEntries(
      options?.startTime,
      options?.endTime,
      options?.teamCode
    );

    if (options?.level) {
      entries = entries.filter((entry) => entry.level === options.level);
    }

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  /**
   * Watch log files in directory
   */
  private watchLogFiles(): void {
    if (!fs.existsSync(this.logDirectory)) {
      return;
    }

    const files = fs.readdirSync(this.logDirectory);

    for (const file of files) {
      if (!file.endsWith('.log') || file === 'combined.log') {
        continue;
      }

      const filePath = path.join(this.logDirectory, file);
      this.watchLogFile(filePath);
    }

    // Watch for new log files
    const dirWatcher = fs.watch(this.logDirectory, (eventType, filename) => {
      if (
        eventType === 'rename' &&
        filename &&
        filename.endsWith('.log') &&
        filename !== 'combined.log'
      ) {
        const filePath = path.join(this.logDirectory, filename);
        if (fs.existsSync(filePath)) {
          this.watchLogFile(filePath);
        }
      }
    });

    this.watchers.push(dirWatcher);
  }

  /**
   * Watch a specific log file
   */
  private watchLogFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }

    // Read existing content
    this.readAndAppendLog(filePath);

    // Watch for new content
    const watcher = fs.watch(filePath, (eventType) => {
      if (eventType === 'change') {
        this.readAndAppendLog(filePath);
      }
    });

    this.watchers.push(watcher);
  }

  /**
   * Read log file and append to aggregated log
   */
  private async readAndAppendLog(filePath: string): Promise<void> {
    if (!this.aggregatedStream || !this.running) {
      return;
    }

    try {
      const fileStream = fs.createReadStream(filePath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          // Validate JSON
          JSON.parse(line);

          // Write to aggregated log
          this.aggregatedStream.write(line + '\n');
        } catch {
          // Skip invalid JSON
        }
      }
    } catch (error) {
      // Ignore read errors (file might be locked)
    }
  }

  /**
   * Clear all logs
   */
  async clearLogs(): Promise<void> {
    await this.stop();

    if (fs.existsSync(this.logDirectory)) {
      const files = fs.readdirSync(this.logDirectory);

      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(this.logDirectory, file);
          fs.unlinkSync(filePath);
        }
      }
    }
  }

  /**
   * Rotate logs older than specified days
   */
  async rotateLogs(daysToKeep: number = 7): Promise<void> {
    if (!fs.existsSync(this.logDirectory)) {
      return;
    }

    const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(this.logDirectory);

    for (const file of files) {
      if (!file.endsWith('.log')) {
        continue;
      }

      const filePath = path.join(this.logDirectory, file);
      const stats = fs.statSync(filePath);

      if (stats.mtimeMs < cutoffTime) {
        // Archive old log
        const archivePath = filePath + '.old';
        fs.renameSync(filePath, archivePath);
      }
    }
  }
}
