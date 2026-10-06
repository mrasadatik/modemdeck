import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('SQLite repository integration fixture passes in a normal Node process', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'dist', 'test', 'sqlite-fixture.js')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
