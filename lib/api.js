import process from 'node:process';

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
      // If we didn't find the key, let's try fallback to standard OPENAI_API_KEY
      this.apiKey = process.env.OPENAI_API_KEY || '';
      if (this.apiKey && !config.baseUrl) {
        // If we found OPENAI_API_KEY and base URL wasn't customized, point to the OpenAI base URL
        this.baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      }
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
   * @returns {Promise<string>}
   */
  async chatCompletion({ model, messages, temperature = 0.7, maxTokens, jsonMode = false }) {
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

    if (jsonMode) {
      // Standard OpenAI format for JSON response enforcement
      requestBody.response_format = { type: 'json_object' };
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };

    try {
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

      const result = await response.json();
      
      if (!result.choices || result.choices.length === 0 || !result.choices[0].message) {
        throw new Error('Malformed API response: no completion choice returned.');
      }

      return result.choices[0].message.content || '';
    } catch (error) {
      throw new Error(`[ApiClient Error] ${error.message}`);
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
