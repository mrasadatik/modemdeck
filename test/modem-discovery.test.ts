import test from 'node:test';
import assert from 'node:assert/strict';
import { ModemDiscovery } from '../src/application/modem-discovery.js';
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
