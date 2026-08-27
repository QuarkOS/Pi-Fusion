import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiClient } from '../lib/api.js';

function completionResponse(content = 'recovered') {
  const body = [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    `data: ${JSON.stringify({
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        total_tokens: 15,
      },
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n');

  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function errorResponse(status, { retryAfter, message = 'temporarily unavailable' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (retryAfter !== undefined) headers['retry-after'] = retryAfter;

  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers,
  });
}

function makeClient(fetchImpl, overrides = {}) {
  const delays = [];
  const warnings = [];
  const client = new ApiClient({
    baseUrl: 'https://example.test/v1',
    apiKey: 'test-key',
    fetchImpl,
    maxAttempts: 5,
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 10000,
    sleep: async (delayMs) => {
      delays.push(delayMs);
    },
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    ...overrides,
  });
  return { client, delays, warnings };
}

describe('ApiClient transient retries', () => {
  it('retries rate limits and transient gateway statuses', async () => {
    const statuses = [408, 409, 425, 429, 500, 503, 529, 599];

    for (const status of statuses) {
      let calls = 0;
      const deltas = [];
      const { client, delays, warnings } = makeClient(async () => {
        calls += 1;
        return calls === 1 ? errorResponse(status) : completionResponse();
      });

      const result = await client.chatCompletion({
        model: 'test-model',
        messages: [{ role: 'user', content: 'test' }],
        onDelta: (delta) => deltas.push(delta),
      });

      assert.equal(calls, 2, `HTTP ${status} should retry once`);
      assert.deepEqual(delays, [10], `HTTP ${status} should use first backoff`);
      assert.equal(warnings.length, 1, `HTTP ${status} should log the retry`);
      assert.equal(result.content, 'recovered');
      assert.deepEqual(deltas, ['recovered'], 'successful retry should still stream');
      assert.equal(result.usage.totalTokens, 15);
    }
  });

  it('honors Retry-After from the provider', async () => {
    let calls = 0;
    const { client, delays } = makeClient(async () => {
      calls += 1;
      return calls === 1
        ? errorResponse(429, { retryAfter: '3' })
        : completionResponse();
    });

    await client.chatCompletion({
      model: 'test-model',
      messages: [],
    });

    assert.equal(calls, 2);
    assert.deepEqual(delays, [3000]);
  });

  it('stops after the configured attempt limit with capped exponential backoff', async () => {
    let calls = 0;
    const { client, delays, warnings } = makeClient(async () => {
      calls += 1;
      return errorResponse(503, { message: 'still overloaded' });
    }, {
      maxAttempts: 4,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 250,
    });

    await assert.rejects(
      client.chatCompletion({ model: 'test-model', messages: [] }),
      /API call failed \(HTTP 503\): still overloaded/
    );

    assert.equal(calls, 4);
    assert.deepEqual(delays, [100, 200, 250]);
    assert.equal(warnings.length, 3);
  });

  it('does not retry credential, model, or validation failures', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      let calls = 0;
      const { client, delays, warnings } = makeClient(async () => {
        calls += 1;
        return errorResponse(status, {
          retryAfter: '1',
          message: 'hard failure',
        });
      });

      await assert.rejects(
        client.chatCompletion({ model: 'missing-model', messages: [] }),
        new RegExp(`HTTP ${status}`)
      );

      assert.equal(calls, 1, `HTTP ${status} must fail immediately`);
      assert.deepEqual(delays, []);
      assert.deepEqual(warnings, []);
    }
  });

  it('preserves retries for transient network failures', async () => {
    let calls = 0;
    const { client, delays } = makeClient(async () => {
      calls += 1;
      if (calls === 1) {
        const error = new TypeError('fetch failed');
        error.cause = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' });
        throw error;
      }
      return completionResponse('network recovered');
    });

    const result = await client.chatCompletion({
      model: 'test-model',
      messages: [],
    });

    assert.equal(calls, 2);
    assert.deepEqual(delays, [10]);
    assert.equal(result.content, 'network recovered');
  });
});
