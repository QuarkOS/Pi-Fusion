import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429]);

function isRetryableHttpStatus(status) {
  return RETRYABLE_HTTP_STATUSES.has(status) || (status >= 500 && status <= 599);
}

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(0, retryAt - now);
}

function isTransientNetworkError(error) {
  if (error?.name === 'AbortError' || error?.cause?.name === 'AbortError') {
    return false;
  }

  const details = [
    error?.message,
    error?.code,
    error?.cause?.message,
    error?.cause?.code,
  ].filter(Boolean).join(' ');

  return /fetch failed|closed|hang up|reset|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED/i.test(details);
}

const getPiAuthKey = (provider) => {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  const authPath = path.join(agentDir, 'auth.json');
  if (fs.existsSync(authPath)) {
    try {
      const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      return auth[provider]?.key || '';
    } catch {
      // Ignore
    }
  }
  return '';
};

/**
 * API client to communicate with OpenCode Go or custom OpenAI endpoints.
 */
export class ApiClient {
  /**
   * @param {object} config
   * @param {string} [config.baseUrl]
   * @param {string} [config.apiKey]
   * @param {string} [config.apiKeyEnvVar]
   * @param {number} [config.maxAttempts]
   * @param {number} [config.retryBaseDelayMs]
   * @param {number} [config.retryMaxDelayMs]
   * @param {typeof fetch} [config.fetchImpl]
   * @param {(delayMs: number) => Promise<void>} [config.sleep]
   * @param {{warn: function}} [config.logger]
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'https://opencode.ai/zen/go/v1';
    this.maxAttempts = Number.isInteger(config.maxAttempts) && config.maxAttempts > 0
      ? config.maxAttempts
      : 5;
    this.retryBaseDelayMs = Number.isFinite(config.retryBaseDelayMs) && config.retryBaseDelayMs >= 0
      ? config.retryBaseDelayMs
      : 2000;
    this.retryMaxDelayMs = Number.isFinite(config.retryMaxDelayMs) && config.retryMaxDelayMs >= 0
      ? config.retryMaxDelayMs
      : 30000;
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    this.sleep = config.sleep || ((delayMs) => new Promise(resolve => setTimeout(resolve, delayMs)));
    this.logger = config.logger || console;
    
    // Resolve API key
    const envVarName = config.apiKeyEnvVar || 'OC_GO_CC_API_KEY';
    this.apiKey = config.apiKey || process.env[envVarName] || '';

    const opencodeEnvFallbacks = ['OPENCODE_API_KEY', 'ZEN_API_KEY', 'OC_GO_CC_API_KEY'];
    if (!this.apiKey && this.baseUrl.includes('opencode.ai')) {
      for (const name of opencodeEnvFallbacks) {
        if (process.env[name]) {
          this.apiKey = process.env[name];
          break;
        }
      }
    }
    
    if (!this.apiKey) {
      const authProviders = [];
      if (this.baseUrl.includes('/zen/go')) {
        authProviders.push('opencode-go', 'opencode', 'opencode-zen');
      } else if (this.baseUrl.includes('opencode.ai')) {
        authProviders.push('opencode-zen', 'opencode', 'opencode-go');
      } else if (envVarName === 'OPENAI_API_KEY' || this.baseUrl.includes('api.openai.com')) {
        authProviders.push('openai');
      } else if (envVarName === 'XAI_API_KEY' || this.baseUrl.includes('api.x.ai')) {
        authProviders.push('xai');
      }
      for (const provider of authProviders) {
        this.apiKey = getPiAuthKey(provider);
        if (this.apiKey) break;
      }
    }

    if (!this.apiKey) {
      // If we didn't find the key, let's try fallback to standard OPENAI_API_KEY
      this.apiKey = process.env.OPENAI_API_KEY || '';
      if (this.apiKey && !config.baseUrl) {
        // If we found OPENAI_API_KEY and base URL wasn't customized, point to the OpenAI base URL
        this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      }
    }

    let keySource = 'none';
    if (config.apiKey) {
      keySource = 'explicit config';
    } else if (process.env[envVarName]) {
      keySource = `env var ${envVarName}`;
    } else {
      let provider = '';
      if (envVarName === 'OC_GO_CC_API_KEY' || this.baseUrl.includes('opencode.ai')) {
        provider = 'opencode-go';
      }
      if (provider && getPiAuthKey(provider)) {
        keySource = `Pi auth.json (${provider})`;
      } else if (process.env.OPENAI_API_KEY) {
        keySource = 'fallback env var OPENAI_API_KEY';
      }
    }
    const obfKey = this.apiKey ? `${this.apiKey.substring(0, 5)}...${this.apiKey.substring(Math.max(0, this.apiKey.length - 5))}` : 'None';
    if (process.env.DEBUG) {
      console.warn(`[ApiClient] Resolved API Key from ${keySource}: ${obfKey} (length: ${this.apiKey ? this.apiKey.length : 0})`);
    }
  }

  /**
   * Sends a chat completion request to the configured API endpoint.
   * @param {object} params
   * @param {string} params.model
   * @param {Array<object>} params.messages
   * @param {number} [params.temperature]
   * @param {number} [params.maxTokens]
   * @param {boolean} [params.jsonMode]
   * @param {function} [params.onDelta] Called with each content token chunk as it streams.
   * @param {Array} [params.tools] OpenAI-format tool definitions.
   * @param {string} [params.toolChoice] OpenAI tool_choice value.
   * @returns {Promise<{content: string, usage: object, toolCalls: Array<{id, name, arguments}>}>}
   */
  async chatCompletion({ model, messages, temperature = 0.7, maxTokens, jsonMode = false, onDelta, tools, toolChoice }, attempt = 1) {
    if (!this.apiKey) {
      throw new Error(
        'API Key not found. Please set OC_GO_CC_API_KEY, OPENCODE_API_KEY, or OPENAI_API_KEY.'
      );
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    
    const requestBody = {
      model,
      messages,
      temperature,
    };

    if (maxTokens) {
      requestBody.max_tokens = maxTokens;
    }

    if (jsonMode && !this.baseUrl.includes('opencode.ai')) {
      // Standard OpenAI format for JSON response enforcement
      requestBody.response_format = { type: 'json_object' };
    }

    if (tools) {
      requestBody.tools = tools;
      if (toolChoice) requestBody.tool_choice = toolChoice;
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'Connection': 'keep-alive',
    };

    let emittedDelta = false;

    try {
      requestBody.stream = true;
      // ponytail: request usage in the final stream chunk. Not all OpenAI-compatible
      // providers honour stream_options (e.g. some older proxies). If absent, usage
      // stays zeroed — that's a known ceiling, not a crash. Upgrade: read /models or a
      // per-model metadata endpoint to fill usage when the stream omits it.
      requestBody.stream_options = { include_usage: true };

      // A retry can keep streaming when the failed attempt emitted no content (for
      // example, a 429 or 503). Once any content reached the caller, later attempts
      // suppress deltas to avoid replaying a partial response.
      const liveOnDelta = onDelta
        ? (delta) => {
            emittedDelta = true;
            onDelta(delta);
          }
        : undefined;

      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `HTTP ${response.status} ${response.statusText}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.error && parsed.error.message) {
            errorMsg = parsed.error.message;
          }
        } catch {
          errorMsg = errorText || errorMsg;
        }
        const error = new Error(`API call failed (HTTP ${response.status}): ${errorMsg}`);
        error.status = response.status;
        error.retryable = isRetryableHttpStatus(response.status);
        error.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
        throw error;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      // ponytail: tool_calls arrive as incremental fragments keyed by index. We accumulate
      // id/name/arguments-per-index into a map, then build the final array at the end.
      // Ceiling: assumes a single choices[0] (no parallel sampled completions). Fine for
      // tool-calling agents which always use n=1.
      const toolCallAccum = new Map();
      let usage = {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(dataStr);
            // Capture usage — usually on the final chunk when stream_options.include_usage is set.
            if (parsed.usage) {
              usage.input = parsed.usage.prompt_tokens ?? usage.input;
              usage.output = parsed.usage.completion_tokens ?? usage.output;
              usage.totalTokens = parsed.usage.total_tokens ?? (usage.input + usage.output);
              if (parsed.usage.prompt_tokens_details?.cached_tokens != null) {
                usage.cacheRead = parsed.usage.prompt_tokens_details.cached_tokens;
              }
            }
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              if (delta.content) {
                accumulatedContent += delta.content;
                if (liveOnDelta) liveOnDelta(delta.content);
              }
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  const acc = toolCallAccum.get(idx) || { id: '', name: '', arguments: '' };
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                  if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                  toolCallAccum.set(idx, acc);
                }
              }
              // reasoning_content is the model's internal thinking (CoT), not the answer.
              // Deliberately NOT accumulated into content — it would pollute the judge and
              // synthesis inputs. It is simply discarded from the returned content.
            }
          } catch {
            // Ignore incomplete line parse failures
          }
        }
      }

      const toolCalls = [...toolCallAccum.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, acc]) => {
          let args = {};
          try { args = JSON.parse(acc.arguments); } catch { args = {}; }
          return { id: acc.id, name: acc.name, arguments: args };
        });

      if (!accumulatedContent && toolCalls.length === 0 && !usage.totalTokens) {
        throw new Error('Malformed API response: no streamed content, tool calls, or usage data received.');
      }

      return { content: accumulatedContent, usage, toolCalls };
    } catch (error) {
      const isTransient = error?.retryable === true || isTransientNetworkError(error);

      if (attempt < this.maxAttempts && isTransient) {
        const exponentialDelay = Math.min(
          this.retryMaxDelayMs,
          this.retryBaseDelayMs * (2 ** (attempt - 1))
        );
        const backoffMs = error?.retryAfterMs == null
          ? exponentialDelay
          : Math.min(this.retryMaxDelayMs, error.retryAfterMs);
        const cause = error?.cause ? ` (Cause: ${error.cause.message || error.cause})` : '';
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`\n⚠️ [ApiClient] Request failed (attempt ${attempt}/${this.maxAttempts}): ${message}${cause}. Retrying in ${backoffMs / 1000} seconds...`);
        await this.sleep(backoffMs);
        return this.chatCompletion({
          model,
          messages,
          temperature,
          maxTokens,
          jsonMode,
          onDelta: emittedDelta ? undefined : onDelta,
          tools,
          toolChoice,
        }, attempt + 1);
      }

      const causeStr = error?.cause ? ` (Cause: ${error.cause.message || error.cause})` : '';
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[ApiClient Error] ${message}${causeStr}`);
    }
  }

  /**
   * Helper to verify if the API connection and credentials are valid.
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    try {
      // Try listing models as a simple ping
      const url = `${this.baseUrl.replace(/\/$/, '')}/models`;
      const response = await this.fetchImpl(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
