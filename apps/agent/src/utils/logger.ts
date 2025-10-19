import winston from 'winston';
import path from 'path';
import fs from 'fs';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: string;
  directory: string;
  maxFileSize: string;
  maxFiles: number;
}

/**
 * Custom log levels
 */
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Create logger instance
 */
export function createLogger(
  agentName: string,
  config: LoggerConfig
): winston.Logger {
  // Ensure log directory exists
  if (!fs.existsSync(config.directory)) {
    fs.mkdirSync(config.directory, { recursive: true });
  }

  // Agent-specific log directory
  const agentLogDir = path.join(config.directory, 'agents');
  if (!fs.existsSync(agentLogDir)) {
    fs.mkdirSync(agentLogDir, { recursive: true });
  }

  const logFile = path.join(agentLogDir, `${agentName}.log`);

  return winston.createLogger({
    levels,
    level: config.level,
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS',
      }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: { agent: agentName },
    transports: [
      // File transport
      new winston.transports.File({
        filename: logFile,
        maxsize: parseSize(config.maxFileSize),
        maxFiles: config.maxFiles,
      }),
      // Console transport
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, agent, ...rest }) => {
            const meta = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
            return `${timestamp} [${agent}] ${level}: ${message} ${meta}`;
          })
        ),
      }),
    ],
  });
}

/**
 * Parse size string (e.g., "10MB") to bytes
 */
function parseSize(sizeStr: string): number {
  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };

  const match = sizeStr.match(/^(\d+)(B|KB|MB|GB)$/i);
  if (!match) {
    throw new Error(`Invalid size format: ${sizeStr}`);
  }

  const [, value, unit] = match;
  return parseInt(value, 10) * units[unit.toUpperCase()];
}

/**
 * Create orchestrator logger
 */
export function createOrchestratorLogger(
  config: LoggerConfig
): winston.Logger {
  if (!fs.existsSync(config.directory)) {
    fs.mkdirSync(config.directory, { recursive: true });
  }

  const logFile = path.join(config.directory, 'orchestrator.log');

  return winston.createLogger({
    levels,
    level: config.level,
    format: winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS',
      }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
    ),
    defaultMeta: { component: 'orchestrator' },
    transports: [
      new winston.transports.File({
        filename: logFile,
        maxsize: parseSize(config.maxFileSize),
        maxFiles: config.maxFiles,
      }),
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, ...rest }) => {
            const meta = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
            return `${timestamp} [ORCHESTRATOR] ${level}: ${message} ${meta}`;
          })
        ),
      }),
    ],
  });
}
