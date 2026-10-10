import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ModemDiscovery, portChange } from '../src/application/modem-discovery.js';
import type { SerialTransportPort } from '../src/domain/ports/serial-transport.js';

class FakeTransport implements SerialTransportPort {
  readonly isOpen = true;
  private listener: ((data: Buffer) => void) | undefined;
  constructor(
    readonly path: string,
    private readonly response: string,
  ) {}
  write(): void {
    setTimeout(() => this.listener?.(Buffer.from(this.response)), 0);
  }
  on(event: string, listener: (...args: never[]) => void): this {
    if (event === 'data') this.listener = listener as (data: Buffer) => void;
    return this;
  }
  removeListener(): this {
    this.listener = undefined;
    return this;
  }
  removeAllListeners(): void {
    this.listener = undefined;
  }
  close(): void {
    this.listener = undefined;
  }
}

test('discovery rejects promptly when a port is unplugged during probing', async () => {
  class UnpluggedTransport extends EventEmitter {
    readonly path = 'COM8';
    isOpen = true;
    write(): void {
      setImmediate(() => {
        this.isOpen = false;
        this.emit('error', new Error('unplugged'));
        this.emit('close');
      });
    }
    close(): void {
      this.isOpen = false;
    }
  }
  const started = Date.now();
  await assert.rejects(
    new ModemDiscovery(
      async () => [{ path: 'COM8' }],
      async () => new UnpluggedTransport() as unknown as SerialTransportPort,
    ).find(),
    /no responding AT modem found/,
  );
  assert.ok(Date.now() - started < 1200);
});

test('discovery probes ports concurrently and selects an AT responder', async () => {
  const found = await new ModemDiscovery(
    async () => [{ path: 'bad' }, { path: 'good' }],
    async (path) => new FakeTransport(path, path === 'good' ? 'AT\r\nOK\r\n' : 'AT\r\nERROR\r\n'),
  ).find();
  assert.equal(found.path, 'good');
  found.close();
});

test('discovery prioritizes modem-role ports over diagnostic AT responders', async () => {
  const probes: string[] = [];
  const found = await new ModemDiscovery(
    async () => [
      { path: 'COM3', friendlyName: 'Qualcomm Diagnostics Interface' },
      { path: 'COM4', friendlyName: 'Qualcomm USB Modem 6000', role: 'modem' },
    ],
    async (path) => {
      probes.push(path);
      return new FakeTransport(path, 'AT\r\nOK\r\n');
    },
    1,
  ).find();
  assert.equal(found.path, 'COM4');
  assert.equal(probes[0], 'COM4');
  found.close();
});

test('discovery does not discard an unknown port that is the only AT responder', async () => {
  const found = await new ModemDiscovery(
    async () => [{ path: 'COM9', friendlyName: 'USB Serial Device' }],
    async (path) => new FakeTransport(path, 'AT\r\nOK\r\n'),
  ).find();
  assert.equal(found.path, 'COM9');
  found.close();
});

test('port moves are reported only between distinct live ports', () => {
  assert.deepEqual(portChange('', { connected: true, port: 'COM3' }), null);
  assert.deepEqual(portChange('COM3', { connected: true, port: 'COM3' }), null);
  assert.deepEqual(portChange('COM3', { connected: false, port: '' }), null);
  assert.deepEqual(portChange('COM3', { connected: true, port: '' }), null);
  assert.deepEqual(portChange('COM3', { connected: true, port: 'COM4' }), {
    previous: 'COM3',
    current: 'COM4',
  });
});
