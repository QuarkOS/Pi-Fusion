import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'pi-harness.config.json'), 'utf8'));

describe('syntax', () => {
  it('parses shipped JS with node --check', () => {
    const files = [
      'index.js',
      'bin/pi-harness.js',
      'lib/api.js',
      'lib/config.js',
      'lib/deliberation.js',
      'lib/event-stream.js',
      'lib/pi-ai.js',
      'lib/presets.js',
      'lib/ui.js',
      'test/offline.test.js',
    ];
    for (const file of files) {
      const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    }
  });
});

describe('package metadata', () => {
  it('declares @earendil-works/pi-ai as an optional peer', () => {
    assert.equal(pkg.peerDependencies['@earendil-works/pi-ai'], '*');
    assert.equal(pkg.peerDependenciesMeta['@earendil-works/pi-ai'].optional, true);
  });

  it('exports the Pi extension as the package default', () => {
    assert.equal(pkg.exports['.'], './index.js');
    assert.equal(pkg.exports['./index.js'], './index.js');
    assert.deepEqual(pkg.pi.extensions, ['./index.js']);
  });

  it('points npm test at files shipped in the package', () => {
    assert.match(pkg.scripts.test, /test\/offline\.test\.js/);
    assert.ok(pkg.files.includes('test/'));
    assert.doesNotMatch(pkg.scripts.test, /verify-harness/);
  });
});

describe('default config', () => {
  it('is 3x glm-5.3 on OpenCode Go', () => {
    assert.equal(config.mode, '3x');
    assert.equal(config.provider, 'opencode-go');
    const models = config.providers['opencode-go'].defaultModels;
    for (const role of ['technical_expert', 'devils_advocate', 'systems_thinker', 'judge', 'synthesis']) {
      assert.equal(models[role], 'glm-5.3', role);
    }
    assert.equal(config.providers['opencode-go'].baseUrl, 'https://opencode.ai/zen/go/v1');
    assert.ok(!Object.values(models).includes('grok-4.6'), 'Go default must not use Zen-only grok-4.6');
  });

  it('puts grok-4.6 on OpenCode Zen, not Go', () => {
    const zen = config.providers['opencode-zen'];
    assert.equal(zen.baseUrl, 'https://opencode.ai/zen/v1');
    assert.equal(zen.defaultModels.technical_expert, 'grok-4.6');
    assert.equal(zen.defaultModels.synthesis, 'grok-4.6');
    assert.equal(zen.defaultModels.devils_advocate, 'gpt-5.6-luna');
    assert.equal(zen.defaultModels.systems_thinker, 'kimi-k3');
  });

  it('uses the public OpenAI API with gpt-5.6-sol, not a private proxy or gpt-4o', () => {
    assert.equal(config.providers.openai.baseUrl, 'https://api.openai.com/v1');
    assert.equal(config.providers.openai.defaultModels.technical_expert, 'gpt-5.6-sol');
    assert.doesNotMatch(JSON.stringify(config), /fredericks\.at/i);
    assert.doesNotMatch(JSON.stringify(config), /gpt-4o/);
    assert.doesNotMatch(JSON.stringify(config), /opus-4\.8|gpt-5\.5|gemini-3\.1-pro/);
  });
});

describe('presets', () => {
  it('keeps Go presets on Go ids and Quality on Zen grok-4.6', async () => {
    const { PRESETS, GO_QUALITY_FALLBACK_MODELS, applyPreset } = await import(
      pathToFileUrl(path.join(root, 'lib/presets.js'))
    );
    assert.equal(PRESETS.glmFusion.provider, 'opencode-go');
    assert.equal(PRESETS.glmFusion.defaultModels.technical_expert, 'glm-5.3');
    assert.equal(PRESETS.balanced.defaultModels.technical_expert, 'kimi-k3');
    assert.equal(PRESETS.balanced.defaultModels.systems_thinker, 'glm-5.3');
    assert.equal(PRESETS.balanced.defaultModels.devils_advocate, 'deepseek-v4-pro');
    assert.equal(PRESETS.highQuality.defaultModels.devils_advocate, 'qwen3.8-max');
    assert.equal(PRESETS.quality.provider, 'opencode-zen');
    assert.equal(PRESETS.quality.defaultModels.technical_expert, 'grok-4.6');
    assert.equal(GO_QUALITY_FALLBACK_MODELS.technical_expert, 'grok-4.5');

    const applied = applyPreset({ providers: {} }, PRESETS.quality);
    assert.equal(applied.providers['opencode-zen'].baseUrl, 'https://opencode.ai/zen/v1');
    assert.ok(!JSON.stringify(PRESETS.glmFusion).includes('grok-4.6'));
    assert.ok(!JSON.stringify(PRESETS.balanced).includes('grok-4.6'));
  });
});

describe('CLI', () => {
  it('--version matches package.json', () => {
    const result = spawnSync(process.execPath, [path.join(root, 'bin/pi-harness.js'), '--version'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), pkg.version);
  });
});

describe('Pi entry', () => {
  it('loads without @earendil-works/pi-ai installed', async () => {
    const spec = pathToFileUrl(path.join(root, 'index.js'));
    const mod = await import(spec);
    assert.equal(typeof mod.default, 'function');

    const registered = { commands: [], tools: [], providers: [] };
    mod.default({
      on() {},
      registerCommand(name) {
        registered.commands.push(name);
      },
      registerTool(tool) {
        registered.tools.push(tool.name);
      },
      registerProvider(name) {
        registered.providers.push(name);
      },
    });
    assert.ok(registered.commands.includes('fusion'));
    assert.ok(registered.commands.includes('fusion-config'));
    assert.ok(registered.tools.includes('deliberate'));
    assert.ok(registered.providers.includes('fusion'));
  });
});

function pathToFileUrl(filePath) {
  let resolved = path.resolve(filePath);
  if (path.sep === '\\') resolved = resolved.replace(/\\/g, '/');
  if (!resolved.startsWith('/')) resolved = `/${resolved}`;
  return `file://${resolved}`;
}
