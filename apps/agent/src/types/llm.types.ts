/**
 * LLM configuration
 */
export interface LLMConfig {
  provider: 'ollama';
  baseUrl: string;
  model: string;
  temperature: number;
  timeout: number;
  fallbackOnTimeout: boolean;
}

/**
 * LLM decision response
 */
export interface LLMDecision {
  decision: 'bid' | 'pass';
  maxBid: number | null; // in lakhs, null if pass
  reasoning: string;
}

/**
 * LLM request options
 */
export interface LLMRequestOptions {
  temperature?: number;
  timeout?: number;
  format?: 'json';
}

/**
 * Ollama generate request
 */
export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  format?: 'json';
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
  };
}

/**
 * Ollama generate response
 */
export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
}
