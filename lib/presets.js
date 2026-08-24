/**
 * Model IDs checked 2026-08-24 against:
 * - OpenCode Go: GET https://opencode.ai/zen/go/v1/models and https://opencode.ai/docs/go/
 * - OpenCode Zen: GET https://opencode.ai/zen/v1/models and https://opencode.ai/docs/zen/
 * - OpenAI API: https://developers.openai.com/api/docs/models (gpt-5.6-sol / luna)
 * - xAI: https://docs.x.ai/developers/quickstart (grok-4.6)
 *
 * grok-4.6 is on Zen and xAI. It is not on Go (Go still lists grok-4.5).
 * glm-5.3 is on Go. Zen's newest GLM is still glm-5.2.
 */

export const PROVIDERS = {
  'opencode-go': {
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKeyEnv: 'OC_GO_CC_API_KEY',
  },
  'opencode-zen': {
    baseUrl: 'https://opencode.ai/zen/v1',
    apiKeyEnv: 'OPENCODE_API_KEY',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  xai: {
    baseUrl: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
  },
};

function all(model) {
  return {
    technical_expert: model,
    devils_advocate: model,
    systems_thinker: model,
    judge: model,
    synthesis: model,
  };
}

export const PRESETS = {
  glmFusion: {
    mode: '3x',
    provider: 'opencode-go',
    catalog: 'OpenCode Go',
    defaultModels: all('glm-5.3'),
  },
  quality: {
    mode: '5x',
    provider: 'opencode-zen',
    catalog: 'OpenCode Zen',
    defaultModels: {
      technical_expert: 'grok-4.6',
      devils_advocate: 'gpt-5.6-luna',
      systems_thinker: 'kimi-k3',
      judge: 'gpt-5.6-luna',
      synthesis: 'grok-4.6',
    },
  },
  highQuality: {
    mode: '5x',
    provider: 'opencode-go',
    catalog: 'OpenCode Go',
    defaultModels: {
      technical_expert: 'kimi-k3',
      devils_advocate: 'qwen3.8-max',
      systems_thinker: 'kimi-k3',
      judge: 'qwen3.8-max',
      synthesis: 'kimi-k3',
    },
  },
  balanced: {
    mode: '5x',
    provider: 'opencode-go',
    catalog: 'OpenCode Go',
    defaultModels: {
      technical_expert: 'kimi-k3',
      devils_advocate: 'deepseek-v4-pro',
      systems_thinker: 'glm-5.3',
      judge: 'deepseek-v4-pro',
      synthesis: 'kimi-k3',
    },
  },
};

/** Go-only substitute if Quality is forced onto the Go catalog. */
export const GO_QUALITY_FALLBACK_MODELS = {
  technical_expert: 'grok-4.5',
  devils_advocate: 'gpt-5.6-luna',
  systems_thinker: 'kimi-k3',
  judge: 'gpt-5.6-luna',
  synthesis: 'grok-4.5',
};

export const OPENAI_DEFAULT_MODELS = all('gpt-5.6-sol');

export function applyPreset(config, preset) {
  const defaults = PROVIDERS[preset.provider];
  config.configured = true;
  config.mode = preset.mode;
  config.provider = preset.provider;
  if (!config.providers) config.providers = {};
  const existing = config.providers[preset.provider] || {};
  config.providers[preset.provider] = {
    ...existing,
    baseUrl: defaults.baseUrl,
    apiKeyEnv: existing.apiKeyEnv || defaults.apiKeyEnv,
    defaultModels: { ...preset.defaultModels },
  };
  return config;
}

export function customFallbackModels(provider) {
  if (provider === 'openai') return { ...OPENAI_DEFAULT_MODELS };
  if (provider === 'opencode-zen') return { ...PRESETS.quality.defaultModels };
  if (provider === 'xai') return all('grok-4.6');
  return { ...PRESETS.balanced.defaultModels };
}
