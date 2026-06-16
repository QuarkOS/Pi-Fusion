import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

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
   */
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || 'https://opencode.ai/zen/go/v1';
    
    // Resolve API key
    const envVarName = config.apiKeyEnvVar || 'OC_GO_CC_API_KEY';
    this.apiKey = config.apiKey || process.env[envVarName] || '';
    
    if (!this.apiKey) {
      // Fallback: check if the key is stored in Pi auth.json
      let provider = '';
      if (envVarName === 'OC_GO_CC_API_KEY' || this.baseUrl.includes('opencode.ai')) {
        provider = 'opencode-go';
      } else if (envVarName === 'OPENAI_API_KEY' || this.baseUrl.includes('api.openai.com')) {
        provider = 'openai';
      }
      if (provider) {
        this.apiKey = getPiAuthKey(provider);
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
    console.warn(`[ApiClient] Resolved API Key from ${keySource}: ${obfKey} (length: ${this.apiKey ? this.apiKey.length : 0})`);
  }

  /**
   * Sends a chat completion request to the configured API endpoint.
   * @param {object} params
   * @param {string} params.model
   * @param {Array<object>} params.messages
   * @param {number} [params.temperature]
   * @param {number} [params.maxTokens]
   * @param {boolean} [params.jsonMode]
   * @returns {Promise<string>}
   */
  async chatCompletion({ model, messages, temperature = 0.7, maxTokens, jsonMode = false }, attempt = 1) {
    if (!this.apiKey) {
      throw new Error(
        'API Key not found. Please set the OC_GO_CC_API_KEY or OPENAI_API_KEY environment variable.'
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

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'Connection': 'keep-alive',
    };

    try {
      requestBody.stream = true;

      const response = await fetch(url, {
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
        throw new Error(`API call failed: ${errorMsg}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';

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
            const delta = parsed.choices?.[0]?.delta;
            if (delta) {
              if (delta.content) {
                accumulatedContent += delta.content;
              }
              if (delta.reasoning_content) {
                accumulatedContent += delta.reasoning_content;
              }
            }
          } catch {
            // Ignore incomplete line parse failures
          }
        }
      }

      if (!accumulatedContent) {
        throw new Error('Malformed API response: no streamed content accumulated.');
      }

      return accumulatedContent;
    } catch (error) {
      const isTransient = error.message.includes('fetch failed') || 
                          error.message.includes('closed') || 
                          error.message.includes('hang up') || 
                          error.message.includes('reset') ||
                          error.message.includes('ENOTFOUND');

      if (attempt < 5 && isTransient) {
        const backoffMs = attempt * 2000;
        const cause = error.cause ? ` (Cause: ${error.cause.message || error.cause})` : '';
        console.warn(`\n⚠️ [ApiClient] Request failed (attempt ${attempt}): ${error.message}${cause}. Retrying in ${backoffMs / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        return this.chatCompletion({ model, messages, temperature, maxTokens, jsonMode }, attempt + 1);
      }

      const causeStr = error.cause ? ` (Cause: ${error.cause.message || error.cause})` : '';
      throw new Error(`[ApiClient Error] ${error.message}${causeStr}`);
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
      const response = await fetch(url, {
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
