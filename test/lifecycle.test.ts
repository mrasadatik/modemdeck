import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ModemLifecycle } from '../src/infrastructure/modem/modem-lifecycle.js';
import type { SerialTransportPort } from '../src/domain/ports/serial-transport.js';

class FakeTransport extends EventEmitter {
  readonly path = 'COM7';
  isOpen = true;
  disconnectOnWrite = false;
  answerError = false;
  write(): void {
    setImmediate(() => {
      if (this.disconnectOnWrite) this.close();
      else if (this.isOpen)
        this.emit('data', Buffer.from(this.answerError ? 'ERROR\r\n' : 'OK\r\n'));
    });
  }
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.emit('close');
  }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await delay(20);
  }
  assert.fail('timed out waiting for modem status');
}

test('modem lifecycle shutdown is idempotent before connection', async () => {
  const status = {
    connected: false,
    port: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const lifecycle = new ModemLifecycle(
    'COM_DOES_NOT_EXIST',
    115200,
    status,
    async () => undefined,
    async () => undefined,
  );
  await lifecycle.stop();
  await lifecycle.stop();
  assert.equal(status.connected, false);
});

test('does not report ready when the modem closes during initialization', async () => {
  const status = {
    connected: false,
    port: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const first = new FakeTransport();
  first.disconnectOnWrite = true;
  const second = new FakeTransport();
  const changes: boolean[] = [];
  let attempts = 0;
  let ready = 0;
  const lifecycle = new ModemLifecycle(
    '',
    115200,
    status,
    async () => undefined,
    async () => {
      ready++;
    },
    undefined,
    undefined,
    undefined,
    undefined,
    () => changes.push(status.connected),
    async (): Promise<SerialTransportPort> =>
      (attempts++ === 0 ? first : second) as unknown as SerialTransportPort,
  );
  try {
    await lifecycle.start();
    assert.equal(status.connected, false);
    assert.equal(ready, 0);
    await until(() => status.connected);
    assert.equal(ready, 1);
    assert.ok(changes.includes(false));
    assert.deepEqual(changes.filter(Boolean), [true]);
  } finally {
    await lifecycle.stop();
  }
});

test('retries discovery and reports disconnect and reconnection', async () => {
  const status = {
    connected: false,
    port: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const changes: Array<{ connected: boolean; port: string; error: string }> = [];
  const first = new FakeTransport();
  const second = new FakeTransport();
  let attempts = 0;
  const lifecycle = new ModemLifecycle(
    '',
    115200,
    status,
    async () => undefined,
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => changes.push({ connected: status.connected, port: status.port, error: status.error }),
    async (): Promise<SerialTransportPort> => {
      if (++attempts === 1) throw new Error('no modem found');
      return (attempts === 2 ? first : second) as unknown as SerialTransportPort;
    },
  );
  try {
    await lifecycle.start();
    assert.equal(status.connected, false);
    assert.match(status.error, /no modem found/);
    await until(() => status.connected);
    assert.equal(status.port, 'COM7');
    assert.equal(status.capabilities.sms, true);

    first.close();
    assert.equal(status.connected, false);
    assert.equal(status.capabilities.sms, false);
    assert.equal(status.port, '');
    assert.match(status.error, /disconnected/i);
    await until(() => status.connected);
    assert.ok(attempts >= 3);
    assert.deepEqual(
      changes.map((change) => change.connected),
      [false, true, false, true],
    );
  } finally {
    await lifecycle.stop();
  }
});

test('heartbeat keeps a silently live modem connected', async () => {
  const status = {
    connected: false,
    port: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const transport = new FakeTransport();
  const lifecycle = new ModemLifecycle(
    '',
    115200,
    status,
    async () => undefined,
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (): Promise<SerialTransportPort> => transport as unknown as SerialTransportPort,
    { intervalMs: 30 },
  );
  try {
    await lifecycle.start();
    await until(() => status.connected);
    const port = status.port;
    await delay(150);
    assert.equal(status.connected, true);
    assert.equal(status.port, port);
    assert.equal(status.error, '');
  } finally {
    await lifecycle.stop();
  }
});

test('heartbeat drops a modem that stops answering and reconnects', async () => {
  const status = {
    connected: false,
    port: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const transport = new FakeTransport();
  const lifecycle = new ModemLifecycle(
    '',
    115200,
    status,
    async () => undefined,
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (): Promise<SerialTransportPort> => transport as unknown as SerialTransportPort,
    { intervalMs: 30 },
  );
  try {
    await lifecycle.start();
    await until(() => status.connected);
    transport.answerError = true;
    await until(() => !status.connected);
    assert.match(status.error, /disconnected/i);
    transport.answerError = false;
    transport.isOpen = true;
    await until(() => status.connected);
  } finally {
    await lifecycle.stop();
  }
});

test('lifecycle retains the last connected port across drops', async () => {
  const status = {
    connected: false,
    port: '',
    lastPort: '',
    error: '',
    capabilities: {} as Record<string, boolean>,
  };
  const transport = new FakeTransport();
  const lifecycle = new ModemLifecycle(
    '',
    115200,
    status,
    async () => undefined,
    async () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (): Promise<SerialTransportPort> => transport as unknown as SerialTransportPort,
    { intervalMs: 30 },
  );
  try {
    await lifecycle.start();
    await until(() => status.connected);
    assert.equal(status.port, 'COM7');
    transport.close();
    await until(() => !status.connected);
    assert.equal(status.port, '');
    assert.equal(status.lastPort, 'COM7');
  } finally {
    await lifecycle.stop();
  }
});
