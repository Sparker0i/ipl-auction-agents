import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { BrowserConfig } from '../types/agent.types.js';
import { LLMConfig } from '../types/llm.types.js';

dotenv.config();

/**
 * Application configuration
 */
export interface AppConfig {
  orchestrator: {
    maxConcurrentAgents: number;
    agentHealthCheckInterval: number;
    agentRestartAttempts: number;
    agentStaggerDelay?: number;
    heartbeatTimeout?: number;
  };
  browser: BrowserConfig;
  llm: LLMConfig;
  auction: {
    frontendUrl: string;
    bidDelayMs: number;
    stateCheckIntervalMs: number;
  };
  logging: {
    level: string;
    directory: string;
    maxFileSize: string;
    maxFiles: number;
  };
  teams: string[];
}

/**
 * Load configuration from file
 */
function loadConfigFile(): AppConfig {
  const env = process.env.NODE_ENV || 'development';
  const configDir = path.join(process.cwd(), 'config');

  // Try environment-specific config first
  let configPath = path.join(configDir, `${env}.json`);
  if (!fs.existsSync(configPath)) {
    // Fall back to default config
    configPath = path.join(configDir, 'default.json');
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  const configData = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(configData);
}

/**
 * Merge config with environment variables
 */
function mergeEnvConfig(config: AppConfig): AppConfig {
  return {
    ...config,
    auction: {
      ...config.auction,
      frontendUrl: process.env.AUCTION_FRONTEND_URL || config.auction.frontendUrl,
      bidDelayMs: process.env.BID_DELAY_MS
        ? parseInt(process.env.BID_DELAY_MS, 10)
        : config.auction.bidDelayMs,
      stateCheckIntervalMs: process.env.STATE_CHECK_INTERVAL_MS
        ? parseInt(process.env.STATE_CHECK_INTERVAL_MS, 10)
        : config.auction.stateCheckIntervalMs,
    },
    browser: {
      ...config.browser,
      headless: process.env.AGENT_HEADLESS === 'true' || config.browser.headless,
      slowMo: process.env.BROWSER_SLOW_MO
        ? parseInt(process.env.BROWSER_SLOW_MO, 10)
        : config.browser.slowMo,
      executablePath: process.env.BROWSER_EXECUTABLE_PATH || config.browser.executablePath,
    },
    llm: {
      ...config.llm,
      baseUrl: process.env.OLLAMA_BASE_URL || config.llm.baseUrl,
      model: process.env.OLLAMA_MODEL || config.llm.model,
      temperature: process.env.LLM_TEMPERATURE
        ? parseFloat(process.env.LLM_TEMPERATURE)
        : config.llm.temperature,
      timeout: process.env.LLM_TIMEOUT
        ? parseInt(process.env.LLM_TIMEOUT, 10)
        : config.llm.timeout,
    },
    logging: {
      ...config.logging,
      level: process.env.LOG_LEVEL || config.logging.level,
      directory: process.env.LOG_DIRECTORY || config.logging.directory,
    },
    orchestrator: {
      ...config.orchestrator,
      agentStaggerDelay: process.env.AGENT_STAGGER_DELAY
        ? parseInt(process.env.AGENT_STAGGER_DELAY, 10)
        : config.orchestrator.agentStaggerDelay,
    },
  };
}

/**
 * Get application configuration
 */
export function getConfig(): AppConfig {
  const fileConfig = loadConfigFile();
  return mergeEnvConfig(fileConfig);
}

/**
 * Validate configuration
 */
export function validateConfig(config: AppConfig): void {
  if (!config.teams || config.teams.length === 0) {
    throw new Error('Configuration error: No teams defined');
  }

  // Note: We allow more teams in config than maxConcurrentAgents because
  // some teams may be human-controlled. The orchestrator will only spawn
  // agents for teams that need AI control.
  if (config.orchestrator.maxConcurrentAgents <= 0) {
    throw new Error('Configuration error: maxConcurrentAgents must be positive');
  }

  if (!config.auction.frontendUrl) {
    throw new Error('Configuration error: Frontend URL not specified');
  }

  if (config.browser.timeout <= 0) {
    throw new Error('Configuration error: Browser timeout must be positive');
  }
}

/**
 * Singleton config instance
 */
let configInstance: AppConfig | null = null;

/**
 * Get or create config instance
 */
export function loadConfig(): AppConfig {
  if (!configInstance) {
    configInstance = getConfig();
    validateConfig(configInstance);
  }
  return configInstance;
}
