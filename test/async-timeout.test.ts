import test from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../src/infrastructure/async.js';

test('withTimeout passes through fast work', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, 'too slow'), 7);
});

test('withTimeout rejects hung work with the given message', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20, 'wedged'), /wedged/);
});

test('withTimeout resolves slow-but-winning races with their value', async () => {
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 30));
  assert.equal(await withTimeout(slow, 5000, 'wedged'), 'done');
});
