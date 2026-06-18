// Self-check for the fusion provider streamSimple event protocol.
// Verifies the fix for "outputs not received in pi": pi's agent-loop.js drops every
// delta until a "start" event arrives, and downstream usage/cost code needs a complete
// AssistantMessage on every partial. This asserts both, plus the abort path.
// Run: node verify-stream.mjs   (no network, no pi-ai peer dep needed)
import { register } from 'node:module';
import assert from 'node:assert/strict';

register('./verify-stream-loader.mjs', import.meta.url);

const mod = await import('./index.js');

let fusionProvider = null;
const pi = {
  on: () => {},
  registerCommand: () => {},
  registerTool: () => {},
  registerProvider: (name, config) => { if (name === 'fusion') fusionProvider = config; },
};
mod.default(pi);

assert.ok(fusionProvider, 'fusion provider registered');
assert.ok(typeof fusionProvider.streamSimple === 'function', 'streamSimple registered');

const model = { id: 'fusion', api: 'fusion-api', provider: 'fusion',
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
const context = { messages: [{ role: 'user', content: 'test query', timestamp: Date.now() }] };
let onResponseCalled = false;
const options = {
  signal: new AbortController().signal,
  onResponse: () => { onResponseCalled = true; },
};

// ApiClient warns about a missing key; silence that one line for clean output.
const origWarn = console.warn;
console.warn = () => {};
try {
  const stream = fusionProvider.streamSimple(model, context, options);
  const evs = [];
  for await (const e of stream) evs.push(e);

  // 1. start must be first — pi drops deltas without it (the original bug).
  assert.equal(evs[0]?.type, 'start', 'first event must be "start"');

  // 2. every partial/message/error must be a complete AssistantMessage.
  const required = ['role', 'content', 'api', 'provider', 'model', 'usage', 'stopReason', 'timestamp'];
  for (const e of evs) {
    const obj = e.partial ?? e.message ?? e.error;
    for (const f of required) assert.ok(f in obj, `event ${e.type} missing field ${f}`);
    assert.ok(obj.usage && typeof obj.usage.cost === 'object', `event ${e.type} missing usage.cost`);
  }

  // 3. terminates with done. Default stub returns a single write tool call from the
  //    file-agent, so done.reason === "toolUse" and the message carries one toolCall.
  const last = evs[evs.length - 1];
  assert.equal(last.type, 'done', 'stream must end with done');
  assert.equal(last.reason, 'toolUse', 'default path: file agent emits write → toolUse');
  assert.ok(last.message.content[0].text.includes('TEST SYNTHESIS'), 'final message text contains synthesis');
  const defaultToolCalls = last.message.content.filter(c => c.type === 'toolCall');
  assert.equal(defaultToolCalls.length, 1, 'default path: one write tool call');
  assert.equal(defaultToolCalls[0].name, 'write');

  // 4. progress + synthesis deltas actually flowed through the stream.
  const deltas = evs.filter(e => e.type === 'text_delta');
  assert.ok(deltas.some(d => d.delta.includes('Starting Deliberation Pipeline')), 'progress delta emitted');

  // 5. synthesis streamed live token-by-token (not as one blob). The stub sends 5 tokens
  //    via onSynthesisDelta; they must appear as individual deltas in order.
  const synthDeltas = deltas.filter(d => ['TEST ', 'SYNTHESIS', '\n\n', 'Final ', 'answer.'].includes(d.delta));
  assert.equal(synthDeltas.length, 5, 'synthesis must stream as 5 live token deltas');
  assert.equal(synthDeltas.map(d => d.delta).join(''), 'TEST SYNTHESIS\n\nFinal answer.', 'synthesis tokens in order');

  // 6. synthesis NOT duplicated: the full text was streamed live, so it must NOT also be
  //    sent as a single blob delta (the retry fallback path). The 'TEST SYNTHESIS' string
  //    should only appear split across the 5 token deltas, never as one delta.
  assert.ok(!deltas.some(d => d.delta === 'TEST SYNTHESIS\n\nFinal answer.'), 'synthesis not duplicated as blob');

  // 6b. 3x mode (the default config now): no Judge tier progress deltas, and the panel
  //     header reflects 3x. The stub skips judge-start/judge-end when mode==='3x'.
  assert.ok(!deltas.some(d => d.delta.includes('Deliberation Judge')), '3x mode: no judge progress delta');
  assert.ok(deltas.some(d => d.delta.includes('3x') && d.delta.includes('2 parallel experts')), '3x panel header present');
  assert.equal(last.message.usage.input, 115, 'usage accumulated (delib + file agent)');

  assert.ok(onResponseCalled, 'onResponse callback invoked');

  // 7. real usage: the final message carries accumulated tokens from the deliberation
  //    (stub: 100 in + 50 out) PLUS the file-agent call (stub: 15 in + 8 out) = 115/58.
  assert.equal(last.message.usage.input, 115, 'final usage.input = 115 (delib + file agent)');
  assert.equal(last.message.usage.output, 58, 'final usage.output = 58 (delib + file agent)');
  assert.equal(last.message.usage.totalTokens, 173, 'final usage.totalTokens = 173');
  assert.ok(last.message.usage.cost.total > 0, 'calculateCost produced non-zero total cost');
  const expectedCost = (115 * 3 + 58 * 15) / 1e6;
  assert.ok(Math.abs(last.message.usage.cost.total - expectedCost) < 1e-12, 'cost = (input*3 + output*15)/1e6');

  // 8. abort path: a pre-aborted signal yields error immediately.
  const ac = new AbortController(); ac.abort();
  const stream2 = fusionProvider.streamSimple(model, context, { signal: ac.signal });
  const evs2 = [];
  for await (const e of stream2) evs2.push(e);
  assert.equal(evs2[0]?.type, 'error', 'aborted stream must start with error');
  assert.equal(evs2[0]?.reason, 'aborted');

  // 9. mode branching: 3x skips the Judge tier, 5x emits it. Directly exercise the
  //    Deliberator (stubbed) with each mode and capture the onProgress stage sequence.
  const { Deliberator } = await import('./lib/deliberation.js');
  const stages = (mode) => {
    const seen = [];
    const d = new Deliberator({ config: { mode, providers: { 'opencode-go': { defaultModels: {} } } } });
    return d.deliberate('x', { onProgress: (s) => seen.push(s) }).then(() => seen);
  };
  const s3 = await stages('3x');
  assert.ok(!s3.includes('judge-start') && !s3.includes('judge-end'), '3x: no judge stages');
  assert.ok(s3.includes('panel-start') && s3.includes('synthesis-end'), '3x: panel + synthesis stages present');
  const s5 = await stages('5x');
  assert.ok(s5.includes('judge-start') && s5.includes('judge-end'), '5x: judge stages present');

  // 10. multi-file: the file-agent stub returns 2 write tool calls when the prompt
  //     contains 'MULTI:'. Both must be emitted as toolcall blocks and done.reason=toolUse.
  const multiCtx = { messages: [{ role: 'user', content: 'MULTI: build a webpage', timestamp: Date.now() }] };
  const streamMulti = fusionProvider.streamSimple(model, multiCtx, {
    signal: new AbortController().signal, onResponse: () => {},
  });
  const evsMulti = [];
  for await (const e of streamMulti) evsMulti.push(e);
  const doneMulti = evsMulti[evsMulti.length - 1];
  const multiTcEnds = evsMulti.filter(e => e.type === 'toolcall_end');
  assert.equal(multiTcEnds.length, 2, 'multi-file: two toolcall_end events');
  assert.equal(doneMulti.type, 'done', 'multi-file: done');
  assert.equal(doneMulti.reason, 'toolUse', 'multi-file: done reason toolUse');
  const multiTcBlocks = doneMulti.message.content.filter(c => c.type === 'toolCall');
  assert.equal(multiTcBlocks.length, 2, 'multi-file: two toolCall blocks in final message');
  assert.equal(multiTcBlocks[0].arguments.path, 'index.html');
  assert.equal(multiTcBlocks[1].arguments.path, 'style.css');

  // 10b. no-file: when the file-agent decides nothing needs saving (prompt has 'NONE:'),
  //     no tool calls are emitted and done.reason === "stop" (plain text finish).
  const noneCtx = { messages: [{ role: 'user', content: 'NONE: explain recursion', timestamp: Date.now() }] };
  const streamNone = fusionProvider.streamSimple(model, noneCtx, {
    signal: new AbortController().signal, onResponse: () => {},
  });
  const evsNone = [];
  for await (const e of streamNone) evsNone.push(e);
  const doneNone = evsNone[evsNone.length - 1];
  assert.equal(doneNone.type, 'done', 'no-file: done');
  assert.equal(doneNone.reason, 'stop', 'no-file: done reason stop (no tool calls)');
  assert.equal(doneNone.message.content.filter(c => c.type === 'toolCall').length, 0, 'no-file: zero toolCall blocks');

  // 11. follow-up short-circuit with MULTIPLE write toolResults: after Pi executes the
  //     2 tool calls from test 10, it calls fusion back. Fusion must NOT re-deliberate —
  //     it emits a confirmation listing all saved paths and stops.
  const followCtx = {
    messages: [
      { role: 'user', content: 'MULTI: build a webpage', timestamp: Date.now() },
      { role: 'assistant', content: [
          { type: 'text', text: 'synthesis...' },
          { type: 'toolCall', id: 'call_a', name: 'write', arguments: { path: 'index.html', content: 'x' } },
          { type: 'toolCall', id: 'call_b', name: 'write', arguments: { path: 'style.css', content: 'y' } },
        ], api: 'fusion-api', provider: 'fusion', model: 'fusion', usage: { input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0, cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0} }, stopReason: 'toolUse', timestamp: Date.now() },
      { role: 'toolResult', toolCallId: 'call_a', toolName: 'write', content: [{ type: 'text', text: 'wrote' }], isError: false, timestamp: Date.now() },
      { role: 'toolResult', toolCallId: 'call_b', toolName: 'write', content: [{ type: 'text', text: 'wrote' }], isError: false, timestamp: Date.now() },
    ]
  };
  const streamFollow = fusionProvider.streamSimple(model, followCtx, {
    signal: new AbortController().signal, onResponse: () => {},
  });
  const evsFollow = [];
  for await (const e of streamFollow) evsFollow.push(e);
  const followDeltas = evsFollow.filter(e => e.type === 'text_delta');
  const followText = followDeltas.map(d => d.delta).join('');
  const doneFollow = evsFollow[evsFollow.length - 1];
  assert.ok(followText.includes('Saved 2 files'), 'follow-up confirms 2 files saved');
  assert.ok(followText.includes('index.html'), 'follow-up lists index.html');
  assert.ok(followText.includes('style.css'), 'follow-up lists style.css');
  assert.ok(!followDeltas.some(d => d.delta.includes('Starting Deliberation Pipeline')), 'follow-up did NOT re-deliberate');
  assert.equal(doneFollow.type, 'done', 'follow-up ends with done');
  assert.equal(doneFollow.reason, 'stop', 'follow-up done reason is stop');
  assert.equal(evsFollow.filter(e => e.type === 'toolcall_end').length, 0, 'follow-up emits no further tool calls');

  console.log(`verify-stream: OK — ${evs.length} events (${deltas.length} deltas, ${synthDeltas.length} synthesis), usage=${last.message.usage.totalTokens}t cost=$${last.message.usage.cost.total.toFixed(6)}, 3x+5x mode, multi-file+no-file file-agent, multi-toolResult follow-up, abort OK`);
} finally {
  console.warn = origWarn;
}
