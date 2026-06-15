import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import chalk from 'chalk';
import { ApiClient } from './lib/api.js';
import { Deliberator } from './lib/deliberation.js';

async function runVerification() {
  console.log(chalk.bold.blue('🏁 Starting Pi Deliberation Harness Verification...\n'));

  // Load config
  const configPath = path.join(process.cwd(), 'pi-harness.config.json');
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('❌ Configuration file not found!'));
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // Initialize client
  const provider = config.provider;
  const providerConfig = config.providers[provider];
  console.log(`Configured Provider: ${chalk.cyan(provider)}`);
  console.log(`Base URL: ${chalk.cyan(providerConfig.baseUrl)}`);
  console.log(`API Key Env Var: ${chalk.cyan(providerConfig.apiKeyEnvVar)}`);

  const client = new ApiClient({
    baseUrl: providerConfig.baseUrl,
    apiKeyEnvVar: providerConfig.apiKeyEnvVar
  });

  // Test connection
  console.log('\n📡 Testing connection to API...');
  const connected = await client.testConnection();
  if (!connected) {
    console.warn(chalk.yellow('⚠️ Connection check returned non-200. Proceeding with caution. (Might be endpoint-specific)'));
  } else {
    console.log(chalk.green('✓ API Connection check passed.'));
  }

  // Run deliberation on a simple prompt
  const testPrompt = 'Write a short description of recursion in programming.';
  console.log(`\n🧠 Running deliberation pipeline for prompt: "${chalk.italic(testPrompt)}"\n`);

  const deliberator = new Deliberator({ apiClient: client, config });

  try {
    const result = await deliberator.deliberate(testPrompt, {
      provider,
      onProgress: (stage, data) => {
        console.log(`  [Stage Progress] ${chalk.yellow(stage)}:`, data ? Object.keys(data) : '');
      }
    });

    console.log(chalk.green('\n✓ Deliberation completed successfully.'));
    
    // Validate output structure
    if (!result.synthesis) {
      throw new Error('Synthesis output is empty.');
    }
    if (!result.judgeAnalysis || typeof result.judgeAnalysis !== 'object') {
      throw new Error('Judge analysis is missing or not an object.');
    }
    const expectedKeys = ['consensus', 'contradictions', 'partial_coverage', 'unique_insights', 'blind_spots'];
    for (const key of expectedKeys) {
      if (!Array.isArray(result.judgeAnalysis[key])) {
        throw new Error(`Judge analysis is missing array for key: ${key}`);
      }
    }

    console.log(chalk.bold.green('✓ Validation Passed!'));
    console.log(`Synthesis length: ${result.synthesis.length} characters`);
    console.log(`Judge categories generated: ${expectedKeys.filter(k => result.judgeAnalysis[k].length > 0).join(', ')}`);
    console.log(chalk.bold.blue('\n🎉 Verification completed successfully.'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Verification failed: ${error.message}`));
    process.exit(1);
  }
}

runVerification();
