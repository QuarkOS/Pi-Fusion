import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedConfigPath = path.join(packageRoot, 'pi-harness.config.json');
const packageJsonPath = path.join(packageRoot, 'package.json');

export function getPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

export function getDefaultConfig() {
  return JSON.parse(fs.readFileSync(packagedConfigPath, 'utf8'));
}

/**
 * Load a workspace or explicit config file, falling back to the packaged default.
 * @param {string} [configPath]
 */
export function loadConfig(configPath) {
  const candidates = [
    configPath,
    path.join(process.cwd(), 'pi-harness.config.json'),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch {
      // Ignore and check next path
    }
  }

  return getDefaultConfig();
}

/** Config files have used both apiKeyEnv and apiKeyEnvVar. */
export function apiKeyEnvName(providerConfig) {
  return providerConfig?.apiKeyEnv || providerConfig?.apiKeyEnvVar;
}
