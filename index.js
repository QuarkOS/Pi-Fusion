import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { createAssistantMessageEventStream, getProviders, getModels, calculateCost } from '@earendil-works/pi-ai';
import { ApiClient } from './lib/api.js';
import { Deliberator } from './lib/deliberation.js';

const getPiAuth = () => {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent');
  const authPath = path.join(agentDir, 'auth.json');
  if (fs.existsSync(authPath)) {
    try {
      return JSON.parse(fs.readFileSync(authPath, 'utf8'));
    } catch {
      // Ignore
    }
  }
  return {};
};

const isProviderConnected = (provider, auth) => {
  if (auth[provider] && auth[provider].key) {
    return true;
  }
  const envVars = {
    'opencode-go': ['OC_GO_CC_API_KEY', 'OPENCODE_API_KEY'],
    'openai': ['OPENAI_API_KEY'],
    'anthropic': ['ANTHROPIC_API_KEY'],
    'google': ['GEMINI_API_KEY'],
    'google-vertex': ['GEMINI_API_KEY'],
    'deepseek': ['DEEPSEEK_API_KEY'],
    'xai': ['XAI_API_KEY'],
    'groq': ['GROQ_API_KEY']
  };
  const vars = envVars[provider] || [];
  return vars.some(v => !!process.env[v]);
};

// Load default config
const defaultConfig = {
  configured: true,
  provider: 'opencode-go',
  // 3x GLM-5.2 fusion is the out-of-the-box "best" OpenCode Go mode: 3 LLM calls,
  // all glm-5.2 (1M context, coding/agent SOTA). Switch via /fusion-config to override.
  mode: '3x',
  providers: {
    'opencode-go': {
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKeyEnv: 'OC_GO_CC_API_KEY',
      defaultModels: {
        technical_expert: 'glm-5.2',
        devils_advocate: 'glm-5.2',
        systems_thinker: 'glm-5.2',
        judge: 'glm-5.2',
        synthesis: 'glm-5.2'
      }
    }
  },
  panel: {
    technical_expert: {
      systemPrompt: "You are a Technical Expert coding agent. Focus on correctness, design patterns, security, and performance. Keep your output extremely concise, direct, and under 1,500 tokens. Write code and core points directly without verbose filler to prevent timeouts."
    },
    devils_advocate: {
      systemPrompt: "You are a Devil's Advocate coding agent. Challenge assumptions, identify risks, and suggest alternatives. Be critical. Keep your output extremely concise, direct, and under 1,500 tokens. Focus on core points directly to prevent timeouts."
    },
    systems_thinker: {
      systemPrompt: "You are a Systems Thinker coding agent. Focus on integration, interfaces, maintainability, and testing. Holistic view. Keep your output extremely concise, direct, and under 1,500 tokens. Focus on core points directly to prevent timeouts."
    }
  },
  judge: {
    systemPrompt: "You are the Deliberation Judge. Compare the three panel expert responses. Output a JSON block wrapped in a standard markdown code block (using ```json ... ```) containing: consensus (array), contradictions (array), partial_coverage (array), unique_insights (array), and blind_spots (array). Keep your JSON output concise and focused."
  },
  synthesis: {
    systemPrompt: "You are the Synthesis Model. Write the final comprehensive response to the user query, grounded strictly in the panel responses and the judge's JSON analysis. Keep your output extremely concise, direct, and under 1,500 tokens. Write code and key points directly without verbose filler to prevent timeouts."
  }
};

/**
 * Pi Coding Agent extension entry point.
 * Ref: https://pi.dev/docs/extensions
 */
export default function (pi) {
  let activeUi = null;

  // Capture active UI context from agent_start event
  pi.on('agent_start', (event, ctx) => {
    activeUi = ctx.ui;
  });

  const getLocalConfig = () => {
    // Try to load local config if it exists in the workspace
    const localConfigPath = path.join(process.cwd(), 'pi-harness.config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        return JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      } catch {
        // Ignore and fallback
      }
    }
    return defaultConfig;
  };

  const getDeliberator = () => {
    const config = getLocalConfig();
    const provider = config.provider || 'opencode-go';
    const providerConfig = config.providers[provider];
    
    let apiKey = '';
    const auth = getPiAuth();
    if (auth[provider] && auth[provider].key) {
      apiKey = auth[provider].key;
    }

    const apiClient = new ApiClient({
      baseUrl: providerConfig.baseUrl,
      apiKeyEnvVar: providerConfig.apiKeyEnv,
      apiKey: apiKey
    });

    return new Deliberator({ apiClient, config });
  };

  const configureHarness = async (ui) => {
    if (!ui) return null;
    
    const choice = await ui.select('Select a deliberation model preset:', [
      'GLM-5.2 Fusion (Best · 3x · OpenCode Go)',
      'Quality / Frontier (Opus 4.8 + GPT 5.5 + Gemini 3.1 Pro)',
      'OpenCode Go (High Quality: Kimi K2.7 + Qwen 3.7 Plus)',
      'OpenCode Go (Balanced: MiniMax M3 + DeepSeek V4)',
      'Custom Configuration'
    ]);

    let config = getLocalConfig();
    config.configured = true;
    // Default to full 5-call pipeline; the GLM-5.2 preset overrides to '3x' below.
    config.mode = '5x';

    // Ensure providers object exists
    if (!config.providers) {
      config.providers = {};
    }

    if (choice.startsWith('GLM-5.2')) {
      // 3x GLM-5.2 fusion: 2 parallel experts + 1 synthesizer (3 LLM calls total),
      // all glm-5.2. The synthesizer absorbs the Judge + Systems Thinker roles.
      config.provider = 'opencode-go';
      config.mode = '3x';
      if (!config.providers['opencode-go']) {
        config.providers['opencode-go'] = {
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKeyEnv: 'OC_GO_CC_API_KEY'
        };
      }
      config.providers['opencode-go'].defaultModels = {
        technical_expert: 'glm-5.2',
        devils_advocate: 'glm-5.2',
        systems_thinker: 'glm-5.2',
        judge: 'glm-5.2',
        synthesis: 'glm-5.2'
      };
      ui.notify('GLM-5.2 Fusion (Best · 3x) Preset configured.', 'info');
    } else if (choice.startsWith('Quality')) {
      config.provider = 'openai';
      // Fallback defaults for Quality preset if not present
      if (!config.providers.openai) {
        config.providers.openai = {
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          defaultModels: {
            technical_expert: 'gpt-5.5',
            devils_advocate: 'opus-4.8',
            systems_thinker: 'gemini-3.1-pro',
            judge: 'gpt-5.5',
            synthesis: 'gpt-5.5'
          }
        };
      }
      ui.notify('Quality / Frontier Preset configured.', 'info');
    } else if (choice.includes('High Quality')) {
      config.provider = 'opencode-go';
      if (!config.providers['opencode-go']) {
        config.providers['opencode-go'] = {
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKeyEnv: 'OC_GO_CC_API_KEY'
        };
      }
      config.providers['opencode-go'].defaultModels = {
        technical_expert: 'kimi-k2.7-code',
        devils_advocate: 'qwen3.7-plus',
        systems_thinker: 'kimi-k2.7-code',
        judge: 'qwen3.7-plus',
        synthesis: 'qwen3.7-plus'
      };
      ui.notify('OpenCode Go (High Quality) Preset configured.', 'info');
    } else if (choice.includes('Balanced')) {
      config.provider = 'opencode-go';
      if (!config.providers['opencode-go']) {
        config.providers['opencode-go'] = {
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKeyEnv: 'OC_GO_CC_API_KEY'
        };
      }
      config.providers['opencode-go'].defaultModels = {
        technical_expert: 'minimax-m3',
        devils_advocate: 'deepseek-v4-pro',
        systems_thinker: 'deepseek-v4-flash',
        judge: 'qwen3.7-plus',
        synthesis: 'qwen3.7-plus'
      };
      ui.notify('OpenCode Go (Balanced) Preset configured.', 'info');
    } else {
      // Custom Configuration
      const auth = getPiAuth();
      const availableProviders = getProviders();

      const providerChoices = availableProviders.map(p => {
        const connected = isProviderConnected(p, auth);
        return {
          id: p,
          label: connected ? `${p} (connected)` : p
        };
      });

      const providerLabelChoice = await ui.select(
        'Select Provider:',
        providerChoices.map(c => c.label)
      ) || 'opencode-go';

      const selectedProviderChoice = providerChoices.find(c => c.label === providerLabelChoice) || providerChoices[0];
      const provider = selectedProviderChoice.id;
      config.provider = provider;

      const providerModels = getModels(provider);
      const defaultBaseUrl = providerModels.length > 0 ? providerModels[0].baseUrl : '';

      // Determine default API Key Env Var name
      const defaultEnvVars = {
        'opencode-go': 'OC_GO_CC_API_KEY',
        'openai': 'OPENAI_API_KEY',
        'anthropic': 'ANTHROPIC_API_KEY',
        'google': 'GEMINI_API_KEY',
        'google-vertex': 'GEMINI_API_KEY',
        'deepseek': 'DEEPSEEK_API_KEY',
        'xai': 'XAI_API_KEY',
        'groq': 'GROQ_API_KEY'
      };
      const defaultApiKeyEnv = defaultEnvVars[provider] || '';

      let baseUrl = defaultBaseUrl;
      let apiKeyEnv = defaultApiKeyEnv;

      const connectionChoice = await ui.select(`Use default connection settings for ${provider}?`, [
        `Yes (URL: ${baseUrl || 'N/A'}, Key: ${auth[provider] ? 'Saved in Pi' : (apiKeyEnv ? 'Env Var ' + apiKeyEnv : 'Custom')})`,
        'No, enter custom URL and Key Env Var'
      ]);

      if (connectionChoice && connectionChoice.startsWith('No')) {
        baseUrl = await ui.input('API Base URL:', baseUrl);
        apiKeyEnv = await ui.input('API Key Env Var name:', apiKeyEnv);
      }

      // Configure each model role
      const selectModelForRole = async (roleName, defaultModel) => {
        if (providerModels.length === 0) {
          return await ui.input(`${roleName} Model Name:`, defaultModel);
        }

        const modelOptions = providerModels.map(m => m.id);
        const customOption = '[Enter Custom Model Name...]';
        const options = [...modelOptions, customOption];

        const selected = await ui.select(
          `Select model for ${roleName} (Default: ${defaultModel}):`,
          options
        );

        if (selected === customOption) {
          return await ui.input(`Enter custom model name for ${roleName}:`, defaultModel);
        }

        return selected || defaultModel;
      };

      const existingProviderConfig = config.providers[provider] || {};
      const existingModels = existingProviderConfig.defaultModels || {};

      const technical_expert = await selectModelForRole('Technical Expert', existingModels.technical_expert || 'qwen3.7-plus');
      const devils_advocate = await selectModelForRole('Devil\'s Advocate', existingModels.devils_advocate || 'deepseek-v4-pro');
      const systems_thinker = await selectModelForRole('Systems Thinker', existingModels.systems_thinker || 'glm-5.1');
      const judge = await selectModelForRole('Judge', existingModels.judge || 'qwen3.7-plus');
      const synthesis = await selectModelForRole('Synthesis', existingModels.synthesis || 'qwen3.7-plus');

      config.providers[provider] = {
        baseUrl,
        apiKeyEnv,
        defaultModels: {
          technical_expert,
          devils_advocate,
          systems_thinker,
          judge,
          synthesis
        }
      };

      ui.notify('Custom configuration completed.', 'info');
    }

    // Write back to config file
    const localConfigPath = path.join(process.cwd(), 'pi-harness.config.json');
    try {
      fs.writeFileSync(localConfigPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
      ui.notify(`Failed to save config: ${err.message}`, 'error');
    }

    return config;
  };

  // 1. Register a slash command: /fusion <prompt>
  pi.registerCommand('fusion', {
    description: 'Run multi-model deliberation (Panel -> Judge -> Synthesis)',
    handler: async (args, ctx) => {
      const prompt = args.join(' ').trim();
      if (!prompt) {
        ctx.ui.notify('Please provide a prompt. Usage: /fusion <your query>', 'error');
        return;
      }

      // Check configuration
      let config = getLocalConfig();
      if (!config || !config.configured) {
        config = await configureHarness(ctx.ui);
      }

      if (!config) {
        ctx.ui.notify('Harness configuration aborted or failed.', 'error');
        return;
      }

      // ponytail: ctx.ui has no write()/print() — progress goes to the footer status row
      // (setStatus), and the final answer is pushed as a custom transcript message. The
      // default custom-message renderer shows it as a markdown block with no renderer
      // registration needed (interactive-mode.js -> CustomMessageComponent default path).
      ctx.ui.setStatus('fusion', '🧠 Starting deliberation pipeline…');

      try {
        const deliberator = getDeliberator();
        const result = await deliberator.deliberate(prompt, {
          onProgress: (stage, data) => {
            if (stage === 'panel-start') {
              if (data.mode === '3x') {
                ctx.ui.setStatus('fusion', `⏳ 3x ${data.models.technical_expert}: 2 experts + synthesizer`);
              } else {
                ctx.ui.setStatus('fusion', `⏳ Panel: ${data.models.technical_expert}, ${data.models.devils_advocate}, ${data.models.systems_thinker}`);
              }
            } else if (stage === 'panel-end') {
              ctx.ui.setStatus('fusion', '✅ Panel responses received');
            } else if (stage === 'judge-start') {
              ctx.ui.setStatus('fusion', `⚖️ Judge (${data.model})`);
            } else if (stage === 'judge-end') {
              ctx.ui.setStatus('fusion', '✅ Judge analysis generated');
            } else if (stage === 'synthesis-start') {
              ctx.ui.setStatus('fusion', `📝 Synthesis (${data.model})`);
            } else if (stage === 'synthesis-end') {
              ctx.ui.setStatus('fusion', '✅ Synthesis completed');
            }
          }
        });

        // Persist the synthesis as a transcript row (display:true renders it even with no
        // registered renderer). triggerTurn:false so it doesn't re-prompt the agent.
        pi.sendMessage(
          { customType: 'fusion-answer', content: result.synthesis, display: true },
          { triggerTurn: false }
        );
      } catch (error) {
        ctx.ui.notify(`Deliberation failed: ${error.message}`, 'error');
      } finally {
        ctx.ui.setStatus('fusion', undefined);
      }
    }
  });

  // 2. Register a custom agent tool: deliberate
  // This allows the Pi LLM agent itself to call this tool when solving tasks.
  // Returns the synthesis as content (what the agent sees) plus the full panel
  // responses, judge analysis, models, and usage as structured details.
  pi.registerTool({
    name: 'deliberate',
    label: 'Deliberate',
    description: 'Deliberate on a complex design decision, architectural choice, or coding question using a parallel panel of expert models (Technical, Devil\'s Advocate, Systems Thinker), a Judge, and a Synthesis model.',
    promptSnippet: 'Run multi-model deliberation on complex design questions',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The query, code choice, or design task to analyze.'
        }
      },
      required: ['prompt']
    },
    execute: async (_toolCallId, params) => {
      try {
        const deliberator = getDeliberator();
        const result = await deliberator.deliberate(params.prompt);
        return {
          content: [{ type: 'text', text: result.synthesis }],
          details: {
            judgeAnalysis: result.judgeAnalysis,
            panelResponses: result.panelResponses,
            models: result.models,
            usage: result.usage,
          },
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Deliberation failed: ${msg}` }],
          details: { error: msg },
        };
      }
    }
  });

  pi.registerProvider('fusion', {
    name: 'Pi Fusion Deliberation',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'dummy',
    api: 'fusion-api',
    models: [
      {
        id: 'fusion',
        name: 'Pi Fusion Deliberation Model',
        api: 'fusion-api',
        provider: 'fusion',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        reasoning: false,
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 4096,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0
        }
      }
    ],
    streamSimple: (model, context, options) => {
      const outer = createAssistantMessageEventStream();
      
      // Get user query/prompt
      const lastUserMsg = context.messages.filter(m => m.role === 'user').pop();
      let prompt = '';
      if (lastUserMsg) {
        if (typeof lastUserMsg.content === 'string') {
          prompt = lastUserMsg.content;
        } else if (Array.isArray(lastUserMsg.content)) {
          prompt = lastUserMsg.content
            .filter(part => part.type === 'text')
            .map(part => part.text)
            .join('\n');
        }
      }

      const freshUsage = () => ({
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      });
      const baseMessage = {
        role: "assistant",
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: freshUsage(),
        stopReason: "stop",
        timestamp: Date.now()
      };
      const msg = (text, extra = {}) => {
        const { usage, ...rest } = extra;
        return { ...baseMessage, content: [{ type: "text", text }], usage: usage || freshUsage(), ...rest };
      };

      queueMicrotask(async () => {
        try {
          if (options?.signal?.aborted) {
            const m = msg("", { stopReason: "aborted", errorMessage: "aborted" });
            outer.push({ type: "error", reason: "aborted", error: m });
            outer.end(m);
            return;
          }

          // Check configuration
          let config = getLocalConfig();
          if (!config || !config.configured) {
            config = defaultConfig;
          }

          if (!config) {
            throw new Error('Harness configuration aborted or failed.');
          }

          if (options?.onResponse) {
            await options.onResponse({ status: 200, headers: {} }, model);
          }

          const provider = config.provider || 'opencode-go';
          const providerConfig = config.providers[provider];
          
          const apiClient = new ApiClient({
            baseUrl: providerConfig.baseUrl,
            apiKeyEnvVar: providerConfig.apiKeyEnv
          });

          let streamedText = '';
          const sendDelta = (text) => {
            streamedText += text;
            outer.push({ type: "text_delta", contentIndex: 0, delta: text, partial: msg(streamedText) });
          };

          // pi's consumer (agent-loop.js) drops every delta until it sees a "start" event —
          // partialMessage is null until "start" sets it, and all delta cases guard on it.
          // Also each partial must be a full AssistantMessage or downstream usage/cost code
          // throws. Push start + open the text block before any delta.
          outer.push({ type: "start", partial: { ...baseMessage, content: [], usage: freshUsage() } });
          outer.push({ type: "text_start", contentIndex: 0, partial: msg("") });

          sendDelta('🧠 **Starting Deliberation Pipeline**\n');

          // Track whether synthesis tokens streamed live. If the synthesis call retries,
          // ApiClient drops onDelta to avoid duplicating partial tokens the caller already
          // saw; in that case the full synthesis is sent as one blob on synthesis-end.
          let synthesisStreamed = false;

          const deliberator = new Deliberator({ apiClient, config });
          const result = await deliberator.deliberate(prompt, {
            onProgress: (stage, data) => {
              if (stage === 'panel-start') {
                if (data.mode === '3x') {
                  sendDelta(` ├─ ⏳ 3x ${data.models.technical_expert}: running 2 parallel experts + synthesizer...\n`);
                } else {
                  sendDelta(` ├─ ⏳ Running parallel panel expert models (${data.models.technical_expert}, ${data.models.devils_advocate}, ${data.models.systems_thinker})...\n`);
                }
              } else if (stage === 'panel-end') {
                sendDelta(` ├─ ✅ Expert panel responses received.\n`);
              } else if (stage === 'judge-start') {
                sendDelta(` ├─ ⚖️ Comparing responses using Deliberation Judge (${data.model})...\n`);
              } else if (stage === 'judge-end') {
                sendDelta(` ├─ ✅ Deliberation analysis generated.\n`);
              } else if (stage === 'synthesis-start') {
                sendDelta(` ├─ 📝 Synthesizing final grounded response (${data.model})...\n\n`);
              } else if (stage === 'synthesis-end') {
                // Retry fallback: if synthesis didn't stream live, send it as one blob.
                if (!synthesisStreamed && data.synthesis) {
                  sendDelta(data.synthesis);
                }
                sendDelta('\n\n---\n\n');
              }
            },
            onSynthesisDelta: (delta) => {
              synthesisStreamed = true;
              sendDelta(delta);
            }
          });

          if (options?.signal?.aborted) {
            const m = msg(streamedText, { stopReason: "aborted", errorMessage: "aborted" });
            outer.push({ type: "error", reason: "aborted", error: m });
            outer.end(m);
            return;
          }

          // Real accumulated usage from all 5 LLM calls. calculateCost mutates usage.cost
          // in place using the fusion model's cost rates. Token counts are real; cost is
          // zero unless the model definition has non-zero cost rates.
          const finalUsage = result.usage || freshUsage();
          try {
            calculateCost(model, finalUsage);
          } catch {
            // calculateCost optional; if it throws, keep raw token counts with zero cost
          }

          outer.push({ type: "text_end", contentIndex: 0, content: streamedText, partial: msg(streamedText, { usage: finalUsage }) });
          const finalMessage = msg(streamedText, { usage: finalUsage });
          outer.push({ type: "done", reason: "stop", message: finalMessage });
          outer.end(finalMessage);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const m = msg(`Error running deliberation: ${errMsg}`, { stopReason: "error", errorMessage: errMsg });
          outer.push({ type: "error", reason: "error", error: m });
          outer.end(m);
        }
      });

      return outer;
    }
  });

  // 4. Register a slash command to configure presets and models
  pi.registerCommand('fusion-config', {
    description: 'Configure Pi Fusion presets and custom models',
    handler: async (args, ctx) => {
      await configureHarness(ctx.ui);
    }
  });
}

