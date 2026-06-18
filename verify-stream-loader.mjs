// ESM loader hook for verify-stream.mjs: redirects the two dependencies that would
// trigger real I/O / require the not-installed pi-ai peer dep to inline stub modules.
// - @earendil-works/pi-ai  -> minimal faithful AssistantMessageEventStream replica
// - ./lib/deliberation.js  -> Deliberator stub that drives onProgress + returns a synthesis
// ./lib/api.js loads for real (node builtins only); its constructor only prints a warning.

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
    for (const tok of ['TEST ', 'SYNTHESIS', '\\n\\n', 'Final ', 'answer.']) onSynthesisDelta(tok);
    onProgress('synthesis-end', { synthesis: 'TEST SYNTHESIS\\n\\nFinal answer.' });
    return {
      synthesis: 'TEST SYNTHESIS\\n\\nFinal answer.',
      judgeAnalysis: mode === '3x' ? null : { consensus: [], contradictions: [], partial_coverage: [], unique_insights: [], blind_spots: [] },
      panelResponses: { technical_expert: 't', devils_advocate: 'd', systems_thinker: mode === '3x' ? '' : 's' },
      models,
      usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, totalTokens: 150,
               cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
    };
  }
}
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@earendil-works/pi-ai') {
    return { url: 'data:text/javascript,' + encodeURIComponent(PI_AI_SOURCE), shortCircuit: true };
  }
  if (specifier === './lib/deliberation.js') {
    return { url: 'data:text/javascript,' + encodeURIComponent(DELIB_SOURCE), shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
