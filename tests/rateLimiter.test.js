import assert from 'node:assert/strict';
import { throttle } from '../src/tools/rateLimiter.js';

// Two calls sharing a key should be spaced at least minIntervalMs apart.
{
  const key = 'test-key-' + Date.now();
  const start = Date.now();
  await throttle(key, 100);
  await throttle(key, 100);
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 100, `expected >=100ms between paced calls, got ${elapsed}ms`);
}

// Different keys shouldn't block each other.
{
  const start = Date.now();
  await throttle('key-a-' + Date.now(), 500);
  await throttle('key-b-' + Date.now(), 500);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 500, `expected unrelated keys to not wait on each other, got ${elapsed}ms`);
}

console.log('rateLimiter.test.js passed');
