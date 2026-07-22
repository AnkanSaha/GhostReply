import assert from 'node:assert/strict';
import { getAIReply } from '../src/models/openrouter.js';

function fakeRes(ok, body, { status = ok ? 200 : 500, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// 1st model errors, 2nd succeeds -> should return 2nd model's reply and try both in order.
{
  const calledModels = [];
  const fetchImpl = async (_url, opts) => {
    const { model } = JSON.parse(opts.body);
    calledModels.push(model);
    if (model === 'model-a') return fakeRes(false, { error: 'boom' });
    return fakeRes(true, { choices: [{ message: { content: 'hi from b' } }] });
  };

  const result = await getAIReply([{ role: 'user', content: 'hello' }], {
    apiKey: 'test-key',
    models: ['model-a', 'model-b'],
    fetchImpl,
    paced: false,
  });

  assert.deepEqual(calledModels, ['model-a', 'model-b']);
  assert.equal(result.text, 'hi from b');
  assert.equal(result.model, 'model-b');
}

// All models fail -> should throw.
{
  const fetchImpl = async () => fakeRes(false, { error: 'boom' });
  await assert.rejects(() =>
    getAIReply([{ role: 'user', content: 'hello' }], {
      apiKey: 'test-key',
      models: ['model-a', 'model-b'],
      fetchImpl,
      paced: false,
    })
  );
}

// Model returns 429 -> circuit breaker should skip it on the *next* call without
// even hitting fetch for it, instead of retrying a model already known to be dead.
{
  const calledModels = [];
  const fetchImpl = async (_url, opts) => {
    const { model } = JSON.parse(opts.body);
    calledModels.push(model);
    if (model === 'model-a') {
      return fakeRes(false, { error: { message: 'rate limited' } }, { status: 429 });
    }
    return fakeRes(true, { choices: [{ message: { content: 'hi from b' } }] });
  };

  const first = await getAIReply([{ role: 'user', content: 'hello' }], {
    apiKey: 'test-key',
    models: ['model-a', 'model-b'],
    fetchImpl,
    paced: false,
  });
  assert.equal(first.model, 'model-b');
  assert.deepEqual(calledModels, ['model-a', 'model-b']);

  calledModels.length = 0;
  const second = await getAIReply([{ role: 'user', content: 'hi again' }], {
    apiKey: 'test-key',
    models: ['model-a', 'model-b'],
    fetchImpl,
    paced: false,
  });
  assert.equal(second.model, 'model-b');
  assert.deepEqual(calledModels, ['model-b']); // model-a skipped, still cooling down
}

console.log('openrouter.test.js passed');
