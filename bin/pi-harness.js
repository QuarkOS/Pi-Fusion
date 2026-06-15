#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../lib/api.js';
import { Deliberator } from '../lib/deliberation.js';
import { TerminalUi } from '../lib/ui.js';

// Resolve configuration
function loadConfig(configPath) {
  const defaultPaths = [
    configPath,
    path.join(process.cwd(), 'pi-harness.config.json'),
    path.join(path.dirname(new URL(import.meta.url).pathname), '../pi-harness.config.json')
  ].filter(Boolean);

  for (const p of defaultPaths) {
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // Ignore and check next path
    }
  }

  // Fallback default config if no config files can be read
  return {
    configured: false,
    provider: 'opencode-go',
    providers: {
      'opencode-go': {
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKeyEnv: 'OC_GO_CC_API_KEY',
        defaultModels: {
          technical_expert: 'qwen3.7-plus',
          devils_advocate: 'deepseek-v4-pro',
          systems_thinker: 'kimi-k2.7-code',
          judge: 'deepseek-v4-pro',
          synthesis: 'qwen3.7-plus'
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
}

// Interactive prompt utility
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

// Wizard to set configurations
async function runSetupWizard(configPath) {
  console.log(chalk.bold.cyan('\n⚙️  Pi Fusion Configuration Wizard'));
  console.log('Select a deliberation model preset:');
  console.log(`[1] ${chalk.bold.yellow('Quality / Frontier')} (Opus 4.8 + GPT 5.5 + Gemini 3.1 Pro)`);
  console.log(`[2] ${chalk.bold.green('Balanced / OpenCode Go')} (Gemini 3 Flash + Kimi K2.7 Code + Deepseek V4 Pro)`);
  console.log(`[3] ${chalk.bold.blue('Custom Configuration')}`);

  let choice = '';
  while (choice !== '1' && choice !== '2' && choice !== '3') {
    choice = await askQuestion('\nChoose preset [1-3]: ');
  }

  let config = loadConfig(configPath);
  config.configured = true;

  if (choice === '1') {
    config.provider = 'openai';
    if (!config.providers) config.providers = {};
    if (!config.providers.openai) {
      config.providers.openai = {
        baseUrl: 'https://api.openai.com/v1',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        defaultModels: {}
      };
    }
    config.providers.openai.defaultModels = {
      technical_expert: 'gpt-5.5',
      devils_advocate: 'opus-4.8',
      systems_thinker: 'gemini-3.1-pro',
      judge: 'gpt-5.5',
      synthesis: 'gpt-5.5'
    };
    console.log(chalk.green('\n✓ Quality / Frontier Preset configured.'));
  } else if (choice === '2') {
    config.provider = 'opencode-go';
    if (!config.providers) config.providers = {};
    if (!config.providers['opencode-go']) {
      config.providers['opencode-go'] = {
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKeyEnvVar: 'OC_GO_CC_API_KEY',
        defaultModels: {}
      };
    }
    config.providers['opencode-go'].defaultModels = {
      technical_expert: 'qwen3.7-plus',
      devils_advocate: 'deepseek-v4-pro',
      systems_thinker: 'kimi-k2.7-code',
      judge: 'deepseek-v4-pro',
      synthesis: 'qwen3.7-plus'
    };
    console.log(chalk.green('\n✓ Balanced / OpenCode Go Preset configured.'));
  } else {
    // Custom Configuration
    console.log(chalk.bold.blue('\n--- Custom Model Configuration ---'));
    const provider = await askQuestion('Select Provider (opencode-go / openai) [default: opencode-go]: ') || 'opencode-go';
    config.provider = provider;

    if (!config.providers) config.providers = {};
    if (!config.providers[provider]) {
      config.providers[provider] = {
        baseUrl: await askQuestion('API Base URL: ') || 'https://opencode.ai/zen/go/v1',
        apiKeyEnvVar: await askQuestion('API Key Env Var name: ') || 'OC_GO_CC_API_KEY',
        defaultModels: {}
      };
    }

    const defaultModels = config.providers[provider].defaultModels;
    defaultModels.technical_expert = await askQuestion('Technical Expert Model Name: ') || 'qwen3.7-plus';
    defaultModels.devils_advocate = await askQuestion('Devil\'s Advocate Model Name: ') || 'deepseek-v4-pro';
    defaultModels.systems_thinker = await askQuestion('Systems Thinker Model Name: ') || 'glm-5.1';
    defaultModels.judge = await askQuestion('Judge Model Name: ') || 'qwen3.7-plus';
    defaultModels.synthesis = await askQuestion('Synthesis Model Name: ') || 'qwen3.7-plus';

    console.log(chalk.green('\n✓ Custom configuration configured.'));
  }

  // Save config back to file
  const finalConfigPath = configPath || path.join(process.cwd(), 'pi-harness.config.json');
  fs.writeFileSync(finalConfigPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(chalk.cyan(`Config file successfully written to: ${finalConfigPath}\n`));
  return config;
}

// Parse custom model overrides (e.g. "technical_expert=qwen3.7-max,judge=deepseek-v4-pro")
function parseModelOverrides(overridesStr, config, provider) {
  if (!overridesStr) return;
  const parts = overridesStr.split(',');
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key && value && config.providers[provider] && config.providers[provider].defaultModels[key] !== undefined) {
      config.providers[provider].defaultModels[key] = value;
    }
  }
}

// The core running logic
async function runQuery(prompt, deliberator, ui, options) {
  const provider = options.provider || deliberator.config.provider;
  
  try {
    const result = await deliberator.deliberate(prompt, {
      provider,
      onProgress: (stage, data) => {
        switch (stage) {
          case 'panel-start':
            ui.startStage('panel-start', data);
            break;
          case 'panel-end':
            ui.succeedStage('Panel stage completed.');
            if (options.verbose) {
              ui.printPanelResponses(data.panelResponses);
            }
            break;
          case 'judge-start':
            ui.startStage('judge-start', data);
            break;
          case 'judge-end':
            ui.succeedStage('Judge stage completed.');
            ui.printJudgeAnalysis(data.judgeAnalysis);
            break;
          case 'synthesis-start':
            ui.startStage('synthesis-start', data);
            break;
          case 'synthesis-end':
            ui.succeedStage('Synthesis completed.');
            break;
        }
      }
    });

    console.log(chalk.bold.green('\n━━━━━━━━━━━━━━━━━━━━ FINAL RESPONSE ━━━━━━━━━━━━━━━━━━━━\n'));
    ui.printMarkdown(result.synthesis);
    console.log(chalk.bold.green('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  } catch (error) {
    ui.failStage('Deliberation failed.');
    console.error(chalk.red(`\nError during execution: ${error.message}\n`));
  }
}

// Start interactive REPL mode
function startRepl(deliberator, ui, options) {
  console.log(chalk.bold.cyan('\n🧠 Pi Deliberation Harness Interactive Mode'));
  console.log(chalk.gray(`Provider: ${options.provider || deliberator.config.provider}`));
  console.log(chalk.gray('Type your prompt below. Press Enter to submit. Type "exit" or "quit" to leave.\n'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.bold.blue('pi-harness> ')
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      console.log(chalk.cyan('Goodbye!'));
      rl.close();
      return;
    }

    rl.pause(); // Pause standard input while deliberating
    await runQuery(input, deliberator, ui, options);
    rl.resume();
    rl.prompt();
  }).on('close', () => {
    process.exit(0);
  });
}

// CLI setup
const program = new Command();

program
  .name('pi-harness')
  .description('Multi-model deliberation harness based on the OpenRouter Fusion pattern')
  .version('1.0.0')
  .argument('[prompt]', 'The query or coding task to deliberate on')
  .option('-v, --verbose', 'Print raw responses from each panel expert', false)
  .option('-i, --interactive', 'Start interactive chat/REPL mode', false)
  .option('-s, --setup', 'Run the interactive configuration wizard to select presets', false)
  .option('-p, --provider <name>', 'Provider to use (opencode-go, openai)')
  .option('-c, --config <path>', 'Path to custom config JSON file')
  .option('-m, --models <overrides>', 'Comma-separated model overrides (e.g. judge=deepseek-v4-pro,synthesis=glm-5.1)')
  .action(async (prompt, options) => {
    // Determine target config path
    const targetConfigPath = options.config || path.join(process.cwd(), 'pi-harness.config.json');

    // Load config
    let config = loadConfig(options.config);

    // Run setup wizard if requested or not yet configured
    if (options.setup || !config.configured) {
      config = await runSetupWizard(targetConfigPath);
    }

    const provider = options.provider || config.provider || 'opencode-go';

    // Apply model overrides
    if (options.models) {
      parseModelOverrides(options.models, config, provider);
    }

    // Initialize client and orchestrators
    const providerConfig = config.providers[provider];
    if (!providerConfig) {
      console.error(chalk.red(`Error: Provider "${provider}" is not configured.`));
      process.exit(1);
    }

    const apiClient = new ApiClient({
      baseUrl: providerConfig.baseUrl,
      apiKeyEnvVar: providerConfig.apiKeyEnvVar
    });

    const deliberator = new Deliberator({ apiClient, config });
    const ui = new TerminalUi();

    // Decide runtime mode
    if (options.interactive || !prompt) {
      startRepl(deliberator, ui, options);
    } else {
      await runQuery(prompt, deliberator, ui, options);
    }
  });

program.parse(process.argv);
