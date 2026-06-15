import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
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
  // Helper to initialize deliberator
  const getDeliberator = () => {
    let config = defaultConfig;
    
    // Try to load local config if it exists in the workspace
    const localConfigPath = path.join(process.cwd(), 'pi-harness.config.json');
    if (fs.existsSync(localConfigPath)) {
      try {
        config = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      } catch {
        // Fallback to default
      }
    }

    const provider = config.provider || 'opencode-go';
    const providerConfig = config.providers[provider];
    
    const apiClient = new ApiClient({
      baseUrl: providerConfig.baseUrl,
      apiKeyEnvVar: providerConfig.apiKeyEnv
    });

    return new Deliberator({ apiClient, config });
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
}
