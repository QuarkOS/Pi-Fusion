import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { ApiClient } from './lib/api.js';
import { Deliberator } from './lib/deliberation.js';

// Load default config
const defaultConfig = {
  provider: 'opencode-go',
  providers: {
    'opencode-go': {
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKeyEnv: 'OC_GO_CC_API_KEY',
      defaultModels: {
        technical_expert: 'kimi-k2.7-code',
        devils_advocate: 'deepseek-v4-pro',
        systems_thinker: 'kimi-k2.6',
        judge: 'deepseek-v4-pro',
        synthesis: 'kimi-k2.7-code'
      }
    }
  },
  panel: {
    technical_expert: {
      systemPrompt: "You are a Technical Expert coding agent. Focus on correctness, design patterns, security, and performance. Be concise."
    },
    devils_advocate: {
      systemPrompt: "You are a Devil's Advocate coding agent. Challenge assumptions, identify risks, and suggest alternatives. Be critical."
    },
    systems_thinker: {
      systemPrompt: "You are a Systems Thinker coding agent. Focus on integration, interfaces, maintainability, and testing. Holistic view."
    }
  },
  judge: {
    systemPrompt: "You are the Deliberation Judge. Compare the three panel expert responses. Output ONLY valid JSON containing: consensus (array), contradictions (array), partial_coverage (array), unique_insights (array), and blind_spots (array)."
  },
  synthesis: {
    systemPrompt: "You are the Synthesis Model. Write the final comprehensive response to the user query, grounded strictly in the panel responses and the judge's JSON analysis."
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
    
    const apiClient = new ApiClient({
      baseUrl: providerConfig.baseUrl,
      apiKeyEnvVar: providerConfig.apiKeyEnv
    });

    return new Deliberator({ apiClient, config });
  };

  const configureHarness = async (ui) => {
    if (!ui) return null;
    
    const choice = await ui.select('Select a deliberation model preset:', [
      'Quality / Frontier (Opus 4.8 + GPT 5.5 + Gemini 3.1 Pro)',
      'Balanced / OpenCode Go (Gemini 3 Flash + Kimi K2.7 Code + Deepseek V4 Pro)',
      'Custom Configuration'
    ]);

    let config = {
      configured: true,
      provider: 'opencode-go',
      providers: {
        'opencode-go': {
          baseUrl: 'https://opencode.ai/zen/go/v1',
          apiKeyEnv: 'OC_GO_CC_API_KEY',
          defaultModels: {
            technical_expert: 'kimi-k2.7-code',
            devils_advocate: 'deepseek-v4-pro',
            systems_thinker: 'kimi-k2.6',
            judge: 'deepseek-v4-pro',
            synthesis: 'kimi-k2.7-code'
          }
        },
        'openai': {
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          defaultModels: {
            technical_expert: 'gpt-5.5',
            devils_advocate: 'opus-4.8',
            systems_thinker: 'gemini-3.1-pro',
            judge: 'gpt-5.5',
            synthesis: 'gpt-5.5'
          }
        }
      },
      panel: {
        technical_expert: {
          systemPrompt: "You are a Technical Expert coding agent. Focus on correctness, design patterns, security, and performance. Be concise."
        },
        devils_advocate: {
          systemPrompt: "You are a Devil's Advocate coding agent. Challenge assumptions, identify risks, and suggest alternatives. Be critical."
        },
        systems_thinker: {
          systemPrompt: "You are a Systems Thinker coding agent. Focus on integration, interfaces, maintainability, and testing. Holistic view."
        }
      },
      judge: {
        systemPrompt: "You are the Deliberation Judge. Compare the three panel expert responses. Output ONLY valid JSON containing: consensus (array), contradictions (array), partial_coverage (array), unique_insights (array), and blind_spots (array)."
      },
      synthesis: {
        systemPrompt: "You are the Synthesis Model. Write the final comprehensive response to the user query, grounded strictly in the panel responses and the judge's JSON analysis."
      }
    };

    if (choice.startsWith('Quality')) {
      config.provider = 'openai';
      ui.notify('Quality / Frontier Preset configured.', 'info');
    } else if (choice.startsWith('Balanced')) {
      config.provider = 'opencode-go';
      ui.notify('Balanced / OpenCode Go Preset configured.', 'info');
    } else {
      // Custom Configuration
      const provider = await ui.select('Select Provider:', ['opencode-go', 'openai']) || 'opencode-go';
      config.provider = provider;

      const baseUrl = await ui.input('API Base URL:', provider === 'opencode-go' ? 'https://opencode.ai/zen/go/v1' : 'https://api.openai.com/v1');
      const apiKeyEnv = await ui.input('API Key Env Var name:', provider === 'opencode-go' ? 'OC_GO_CC_API_KEY' : 'OPENAI_API_KEY');

      const technical_expert = await ui.input('Technical Expert Model Name:', 'qwen3.7-plus');
      const devils_advocate = await ui.input('Devil\'s Advocate Model Name:', 'deepseek-v4-pro');
      const systems_thinker = await ui.input('Systems Thinker Model Name:', 'glm-5.1');
      const judge = await ui.input('Judge Model Name:', 'qwen3.7-plus');
      const synthesis = await ui.input('Synthesis Model Name:', 'qwen3.7-plus');

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

      ctx.ui.notify('Starting deliberation pipeline...', 'info');

      try {
        const deliberator = getDeliberator();
        const result = await deliberator.deliberate(prompt, {
          onProgress: (stage) => {
            ctx.ui.notify(`Stage progress: ${stage}`, 'info');
          }
        });

        // Write output directly back into the Pi session TUI/editor
        ctx.ui.write('\n\n--- 🧠 Deliberation Synthesis Answer ---\n\n');
        ctx.ui.write(result.synthesis);
        ctx.ui.write('\n\n---------------------------------------\n\n');
      } catch (error) {
        ctx.ui.notify(`Deliberation failed: ${error.message}`, 'error');
      }
    }
  });

  // 2. Register a custom agent tool: deliberate
  // This allows the Pi LLM agent itself to call this tool when solving tasks
  pi.registerTool('deliberate', {
    description: 'Deliberate on a complex design decision, architectural choice, or coding question using a parallel panel of expert models (Technical, Devil\'s Advocate, Systems Thinker), a Judge, and a Synthesis model.',
    schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The query, code choice, or design task to analyze.'
        }
      },
      required: ['prompt']
    },
    execute: async ({ prompt }) => {
      try {
        const deliberator = getDeliberator();
        const result = await deliberator.deliberate(prompt);
        return `DELIBERATION RESULT:\n\n${result.synthesis}`;
      } catch (error) {
        return `Deliberation failed: ${error.message}`;
      }
    }
  });

  // 3. Register a custom model provider for the deliberation model
  pi.registerProvider('fusion', {
    name: 'Pi Fusion Deliberation',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    apiKey: 'dummy',
    api: 'fusion-api',
    models: [
      {
        id: 'fusion',
        name: 'Pi Fusion Deliberation Model',
        reasoning: false,
        input: ['text'],
        contextWindow: 128000,
        maxTokens: 4096
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

      queueMicrotask(async () => {
        try {
          // Check configuration
          let config = getLocalConfig();
          if (!config || !config.configured) {
            if (activeUi) {
              config = await configureHarness(activeUi);
            }
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

          const deliberator = new Deliberator({ apiClient, config });
          const result = await deliberator.deliberate(prompt);
          const resultText = result.synthesis;

          const partial = {
            role: "assistant",
            content: []
          };

          // Start text block
          partial.content = [{ type: "text", text: "" }];
          outer.push({ type: "text_start", contentIndex: 0, partial: { ...partial } });

          // Send delta
          partial.content[0].text = resultText;
          outer.push({ type: "text_delta", contentIndex: 0, delta: resultText, partial: { ...partial } });

          // End text block
          outer.push({ type: "text_end", contentIndex: 0, content: resultText, partial: { ...partial } });

          // Complete message
          const finalMessage = {
            role: "assistant",
            content: [
              { type: "text", text: resultText }
            ],
            stopReason: "stop"
          };
          outer.push({ type: "done", reason: "stop", message: finalMessage });
          outer.end(finalMessage);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          const finalMessage = {
            role: "assistant",
            content: [
              { type: "text", text: `Error running deliberation: ${errMsg}` }
            ],
            stopReason: "error"
          };
          outer.push({ type: "error", reason: "error", error: finalMessage });
          outer.end(finalMessage);
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

