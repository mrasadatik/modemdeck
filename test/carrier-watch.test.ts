import test from 'node:test';
import assert from 'node:assert/strict';
import { CarrierWatch } from '../src/application/carrier-watch.js';

const scripted = (answers: Record<string, string[]>) => async (command: string) => {
  if (command in answers) return answers[command];
  throw new Error(`unsupported ${command}`);
};

test('carrier watch parses signal, registration and operator', async () => {
  const watch = new CarrierWatch(
    scripted({
      'AT+CSQ': ['+CSQ: 20,0'],
      'AT+COPS?': ['+COPS: 0,0,"TestNet",7'],
      'AT+CREG?': ['+CREG: 0,1'],
    }),
  );
  assert.deepEqual(await watch.poll(), {
    signalPct: 65,
    registration: 'registered (home)',
    operator: 'TestNet',
  });
});

test('carrier watch tolerates missing readings and transport failure', async () => {
  const partial = new CarrierWatch(scripted({}));
  assert.deepEqual(await partial.poll(), {
    signalPct: null,
    registration: 'n/a',
    operator: '',
  });
  const failing = new CarrierWatch((() => {
    throw new Error('port gone');
  }) as unknown as (command: string) => Promise<string[]>);
  assert.equal(await failing.poll(), null);
});
