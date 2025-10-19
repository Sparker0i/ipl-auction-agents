import {
  LLMConfig,
  LLMDecision,
  LLMRequestOptions,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
} from '../types/llm.types.js';
import type { Logger } from 'winston';

/**
 * Ollama API client
 */
export class OllamaClient {
  private config: LLMConfig;
  private logger: Logger;

  constructor(config: LLMConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Query Ollama for bid decision with retry logic
   */
  async queryDecision(prompt: string, options?: LLMRequestOptions): Promise<LLMDecision> {
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();

      try {
        this.logger.debug('Querying Ollama', {
          model: this.config.model,
          promptLength: prompt.length,
          attempt,
        });

        // Quick availability check before attempting query
        if (attempt === 1) {
          const isAvailable = await this.quickHealthCheck();
          if (!isAvailable) {
            throw new Error('LLM_UNAVAILABLE: Ollama service not responding');
          }
        }

        const request: OllamaGenerateRequest = {
          model: this.config.model,
          prompt,
          format: 'json',
          stream: false,
          options: {
            temperature: options?.temperature ?? this.config.temperature,
            top_p: 0.9,
          },
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, options?.timeout ?? this.config.timeout);

        const response = await fetch(`${this.config.baseUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data: OllamaGenerateResponse = await response.json();

        const duration = Date.now() - startTime;
        this.logger.info('Ollama query completed', {
          duration,
          responseLength: data.response.length,
          attempt,
        });

        // Parse JSON response
        const decision = this.parseDecision(data.response);

        return decision;
      } catch (error) {
        const duration = Date.now() - startTime;
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof Error && error.name === 'AbortError') {
          this.logger.warn('Ollama query timeout', { duration, attempt });
          lastError = new Error('LLM_TIMEOUT');
        } else {
          this.logger.error('Ollama query failed', { error, duration, attempt });
        }

        // Retry on connection errors or timeouts (but not parse errors)
        if (attempt < maxRetries && !lastError.message.includes('LLM_PARSE_ERROR')) {
          this.logger.info('Retrying Ollama query', { nextAttempt: attempt + 1 });
          await this.sleep(1000 * attempt); // Exponential backoff
          continue;
        }

        // All retries exhausted
        throw lastError;
      }
    }

    throw lastError || new Error('LLM query failed after all retries');
  }

  /**
   * Quick health check (faster than full availability check)
   */
  private async quickHealthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (error) {
      this.logger.warn('Ollama health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse LLM JSON response
   */
  private parseDecision(response: string): LLMDecision {
    try {
      const parsed = JSON.parse(response);

      // Validate response structure
      if (!parsed.decision || !['bid', 'pass'].includes(parsed.decision)) {
        throw new Error('Invalid decision value');
      }

      if (parsed.decision === 'bid' && (typeof parsed.maxBid !== 'number' || parsed.maxBid <= 0)) {
        throw new Error('Invalid maxBid for bid decision');
      }

      return {
        decision: parsed.decision,
        maxBid: parsed.decision === 'bid' ? parsed.maxBid : null,
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    } catch (error) {
      this.logger.error('Failed to parse LLM response', { response, error });
      throw new Error('LLM_PARSE_ERROR');
    }
  }

  /**
   * Check if Ollama is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      return response.ok;
    } catch (error) {
      this.logger.warn('Ollama not available', { error });
      return false;
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`);

      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }

      const data = await response.json();
      return data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      this.logger.error('Failed to list models', { error });
      return [];
    }
  }

  /**
   * Pre-warm model (loads it into memory)
   */
  async warmupModel(): Promise<void> {
    try {
      this.logger.info('Warming up Ollama model', { model: this.config.model });

      await this.queryDecision(
        'You are an IPL auction agent. This is a warmup query. Respond with: {"decision": "pass", "maxBid": null, "reasoning": "warmup"}',
        { timeout: 30000 }
      );

      this.logger.info('Model warmup complete');
    } catch (error) {
      this.logger.warn('Model warmup failed', { error });
    }
  }
}
