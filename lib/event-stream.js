/**
 * Duck-typed AssistantMessageEventStream.
 * Pi's agent loop awaits stream.result() and iterates events; this matches
 * @earendil-works/pi-ai's createAssistantMessageEventStream without importing it
 * at module load (so `import '@quarkos/pi-fusion'` works without the peer).
 */
export function createAssistantMessageEventStream() {
  return makeStream(
    (e) => e.type === 'done' || e.type === 'error',
    (e) => (e.type === 'done' ? e.message : e.error)
  );
}

function makeStream(isComplete, extract) {
  let queue = [];
  let waiting = [];
  let done = false;
  let resolveResult;
  const resultP = new Promise((r) => {
    resolveResult = r;
  });
  return {
    push(event) {
      if (done) return;
      if (isComplete(event)) {
        done = true;
        resolveResult(extract(event));
      }
      const w = waiting.shift();
      if (w) w({ value: event, done: false });
      else queue.push(event);
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
          return new Promise((resolve) => waiting.push(resolve));
        },
      };
    },
    result() {
      return resultP;
    },
  };
}
