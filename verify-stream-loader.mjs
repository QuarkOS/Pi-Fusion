// ESM loader hook for verify-stream.mjs: redirects dependencies to inline stub modules
// so the test runs with no network and no pi-ai peer dep.
// - @earendil-works/pi-ai  -> minimal faithful AssistantMessageEventStream replica
// - ./lib/deliberation.js  -> Deliberator stub that drives onProgress + returns a synthesis
// - ./lib/api.js           -> ApiClient stub: returns canned content/usage/toolCalls

const PI_AI_SOURCE = `
export function createAssistantMessageEventStream() {
  return makeStream(e => e.type === 'done' || e.type === 'error', e => e.type === 'done' ? e.message : e.error);
}
function makeStream(isComplete, extract) {
  let queue = []; let waiting = []; let done = false;
  let resolveResult; const resultP = new Promise(r => { resolveResult = r; });
  return {
    push(event) {
      if (done) return;
      if (isComplete(event)) { done = true; resolveResult(extract(event)); }
      const w = waiting.shift();
      if (w) w({ value: event, done: false }); else queue.push(event);
    },
    end(result) {
      done = true;
      if (result !== undefined) resolveResult(result);
      while (waiting.length) waiting.shift()({ value: undefined, done: true });
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise(resolve => waiting.push(resolve));
        }
      };
    },
    result() { return resultP; }
  };
}
export function getProviders() { return ['opencode-go']; }
export function getModels() { return []; }
// Faithful enough stub: mutates usage.cost in place from model.cost rates, like the real one.
export function calculateCost(model, usage) {
  const c = model?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  usage.cost.input = (usage.input / 1e6) * c.input;
  usage.cost.output = (usage.output / 1e6) * c.output;
  usage.cost.cacheRead = (usage.cacheRead / 1e6) * c.cacheRead;
  usage.cost.cacheWrite = (usage.cacheWrite / 1e6) * c.cacheWrite;
  usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
`;

const DELIB_SOURCE = `
export class Deliberator {
  constructor(opts) { this.opts = opts; }
  async deliberate(prompt, options = {}) {
    const onProgress = options.onProgress || (() => {});
    const onSynthesisDelta = options.onSynthesisDelta || (() => {});
    const mode = options.mode || this.opts?.config?.mode || '5x';
    const models = { technical_expert: 'te', devils_advocate: 'da', systems_thinker: 'st', judge: 'j', synthesis: 'sy' };
    const withHtml = String(prompt).startsWith('HTML:');
    const synthesis = withHtml
      ? 'Here is the file:\\n\\n\`\`\`html\\n<!DOCTYPE html><html></html>\\n\`\`\`\\n'
      : 'TEST SYNTHESIS\\n\\nFinal answer.';
    onProgress('panel-start', {
      models: { technical_expert: models.technical_expert, devils_advocate: models.devils_advocate, systems_thinker: mode === '3x' ? models.synthesis : models.systems_thinker },
      mode
    });
    onProgress('panel-end', { panelResponses: { technical_expert: 't', devils_advocate: 'd', systems_thinker: mode === '3x' ? '' : 's' } });
    if (mode !== '3x') {
      onProgress('judge-start', { model: models.judge });
      onProgress('judge-end', { judgeAnalysis: { consensus: [], contradictions: [], partial_coverage: [], unique_insights: [], blind_spots: [] } });
    }
    onProgress('synthesis-start', { model: models.synthesis });
    if (withHtml) onSynthesisDelta(synthesis); else
      for (const tok of ['TEST ', 'SYNTHESIS', '\\n\\n', 'Final ', 'answer.']) onSynthesisDelta(tok);
    onProgress('synthesis-end', { synthesis });
    return {
      synthesis,
      judgeAnalysis: mode === '3x' ? null : { consensus: [], contradictions: [], partial_coverage: [], unique_insights: [], blind_spots: [] },
      panelResponses: { technical_expert: 't', devils_advocate: 'd', systems_thinker: mode === '3x' ? '' : 's' },
      models,
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150,
               cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    };
  }
}
`;

const API_SOURCE = `
export class ApiClient {
  constructor(opts) { this.opts = opts; this.callCount = 0; }
  async chatCompletion({ model, messages, onDelta, tools }) {
    this.callCount++;
    // The file-agent call (has tools) returns canned write tool calls. The multi-file case
    // is triggered by 'MULTI:' in the prompt; single-file by anything else; no-file by 'NONE:'.
    const userText = JSON.stringify(messages).toLowerCase();
    if (tools && tools.length > 0) {
      if (userText.includes('none:')) {
        if (onDelta) onDelta('Nothing to save.');
        return { content: 'Nothing to save.', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } }, toolCalls: [] };
      }
      if (userText.includes('multi:')) {
        return { content: '', usage: { input: 20, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 30, cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } },
          toolCalls: [
            { id: 'call_a', name: 'write', arguments: { path: 'index.html', content: '<html>a</html>' } },
            { id: 'call_b', name: 'write', arguments: { path: 'style.css', content: 'body{}' } },
          ] };
      }
      return { content: '', usage: { input: 15, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 23, cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } },
        toolCalls: [{ id: 'call_solo', name: 'write', arguments: { path: 'water-simulation.html', content: '<!DOCTYPE html><html></html>' } }] };
    }
    // Panel/judge/synthesis calls (no tools): return canned content.
    const content = 'CANNED RESPONSE';
    if (onDelta) onDelta(content);
    return { content, usage: { input: 30, output: 15, cacheRead: 0, cacheWrite: 0, totalTokens: 45, cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } }, toolCalls: [] };
  }
  async testConnection() { return true; }
}
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@earendil-works/pi-ai') {
    return { url: 'data:text/javascript,' + encodeURIComponent(PI_AI_SOURCE), shortCircuit: true };
  }
  if (specifier === './lib/deliberation.js') {
    return { url: 'data:text/javascript,' + encodeURIComponent(DELIB_SOURCE), shortCircuit: true };
  }
  if (specifier === './lib/api.js') {
    return { url: 'data:text/javascript,' + encodeURIComponent(API_SOURCE), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
