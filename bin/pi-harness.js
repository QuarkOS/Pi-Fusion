#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { ApiClient } from '../lib/api.js';
import { apiKeyEnvName, getPackageJson, loadConfig } from '../lib/config.js';
import { applyPreset, customFallbackModels, PRESETS, PROVIDERS } from '../lib/presets.js';
import { Deliberator } from '../lib/deliberation.js';
import { TerminalUi } from '../lib/ui.js';

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
  console.log(`[1] ${chalk.bold.magenta('GLM-5.3 Fusion (Best)')} (3x · OpenCode Go)`);
  console.log(`[2] ${chalk.bold.yellow('Quality / Frontier')} (Grok 4.6 + GPT 5.6 Luna + Kimi K3 · OpenCode Zen)`);
  console.log(`[3] ${chalk.bold.cyan('High Quality / OpenCode Go')} (Kimi K3 + Qwen 3.8 Max)`);
  console.log(`[4] ${chalk.bold.green('Balanced / OpenCode Go')} (Kimi K3 + DeepSeek V4 Pro + GLM-5.3)`);
  console.log(`[5] ${chalk.bold.blue('Custom Configuration')}`);

  let choice = '';
  while (!['1', '2', '3', '4', '5'].includes(choice)) {
    choice = await askQuestion('\nChoose preset [1-5]: ');
  }

  let config = loadConfig(configPath);
  if (!config.providers) config.providers = {};

  if (choice === '1') {
    applyPreset(config, PRESETS.glmFusion);
    console.log(chalk.green('\n✓ GLM-5.3 Fusion (Best · 3x · OpenCode Go) configured.'));
  } else if (choice === '2') {
    applyPreset(config, PRESETS.quality);
    console.log(chalk.green('\n✓ Quality / Frontier (OpenCode Zen · grok-4.6) configured.'));
  } else if (choice === '3') {
    applyPreset(config, PRESETS.highQuality);
    console.log(chalk.green('\n✓ High Quality / OpenCode Go Preset configured.'));
  } else if (choice === '4') {
    applyPreset(config, PRESETS.balanced);
    console.log(chalk.green('\n✓ Balanced / OpenCode Go Preset configured.'));
  } else {
    // Custom Configuration
    console.log(chalk.bold.blue('\n--- Custom Model Configuration ---'));
    const provider = await askQuestion('Select Provider (opencode-go / opencode-zen / openai) [default: opencode-go]: ') || 'opencode-go';
    config.provider = provider;
    config.configured = true;
    config.mode = '5x';

    const providerDefaults = PROVIDERS[provider] || PROVIDERS['opencode-go'];
    if (!config.providers[provider]) {
      config.providers[provider] = {
        baseUrl: await askQuestion('API Base URL: ') || providerDefaults.baseUrl,
        apiKeyEnv: await askQuestion('API Key Env Var name: ') || providerDefaults.apiKeyEnv,
        defaultModels: {}
      };
    }

    const defaultModels = config.providers[provider].defaultModels;
    const fallbacks = customFallbackModels(provider);
    defaultModels.technical_expert = await askQuestion('Technical Expert Model Name: ') || fallbacks.technical_expert;
    defaultModels.devils_advocate = await askQuestion('Devil\'s Advocate Model Name: ') || fallbacks.devils_advocate;
    defaultModels.systems_thinker = await askQuestion('Systems Thinker Model Name: ') || fallbacks.systems_thinker;
    defaultModels.judge = await askQuestion('Judge Model Name: ') || fallbacks.judge;
    defaultModels.synthesis = await askQuestion('Synthesis Model Name: ') || fallbacks.synthesis;

    console.log(chalk.green('\n✓ Custom configuration configured.'));
  }

  // Save config back to file
  const finalConfigPath = configPath || path.join(process.cwd(), 'pi-harness.config.json');
  fs.writeFileSync(finalConfigPath, JSON.stringify(config, null, 2), 'utf8');
  console.log(chalk.cyan(`Config file successfully written to: ${finalConfigPath}\n`));
  return config;
}

// Parse custom model overrides (e.g. "technical_expert=kimi-k3,judge=deepseek-v4-pro")
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
  .version(getPackageJson().version)
  .argument('[prompt]', 'The query or coding task to deliberate on')
  .option('-v, --verbose', 'Print raw responses from each panel expert', false)
  .option('-i, --interactive', 'Start interactive chat/REPL mode', false)
  .option('-s, --setup', 'Run the interactive configuration wizard to select presets', false)
  .option('-p, --provider <name>', 'Provider to use (opencode-go, opencode-zen, openai)')
  .option('-c, --config <path>', 'Path to custom config JSON file')
  .option('-m, --models <overrides>', 'Comma-separated model overrides (e.g. judge=deepseek-v4-pro,synthesis=glm-5.3)')
  .addHelpText('after', '\nStar the repo: https://github.com/QuarkOS/Pi-Fusion\n')
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
      apiKeyEnvVar: apiKeyEnvName(providerConfig)
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
