import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { SerialPort } from 'serialport';
import { SerialTransport } from '../src/infrastructure/serial/serial-transport.js';

/** Minimal fake with the SerialPort surface SerialTransport touches. */
class FakePort extends EventEmitter {
  readonly path = 'COM9';
  isOpen = true;
  failWrite: 'sync' | 'async' | null = null;
  failClose = false;
  write(_data: unknown, callback?: (error: Error | null) => void): void {
    if (this.failWrite === 'sync')
      throw new Error('Writing to COM port (WriteFileEx): Invalid handle');
    if (this.failWrite === 'async') {
      setImmediate(() =>
        callback?.(new Error('Writing to COM port (WriteFileEx): Invalid handle')),
      );
      return;
    }
    setImmediate(() => callback?.(null));
  }
  close(callback?: (error: Error | null) => void): void {
    setImmediate(() => callback?.(this.failClose ? new Error('Close: Invalid handle') : null));
  }
}

const asPort = (fake: FakePort): SerialPort => fake as unknown as SerialPort;

test('serial transport swallows port errors with no subscribers instead of crashing', () => {
  const fake = new FakePort();
  new SerialTransport(asPort(fake));
  assert.doesNotThrow(() => {
    // A raw SerialPort would throw here (unhandled 'error' event).
    fake.emit('error', new Error('Writing to COM port (WriteFileEx): Invalid handle'));
  });
});

test('serial transport dispatches port errors to error subscribers', async () => {
  const fake = new FakePort();
  const transport = new SerialTransport(asPort(fake));
  const seen: string[] = [];
  transport.on('error', ((error: Error) => seen.push(error.message)) as (...args: never[]) => void);
  fake.emit('error', new Error('boom'));
  assert.deepEqual(seen, ['boom']);
});

test('serial transport routes async write failures to error subscribers', async () => {
  const fake = new FakePort();
  fake.failWrite = 'async';
  const transport = new SerialTransport(asPort(fake));
  const seen: string[] = [];
  const listener = ((error: Error) => seen.push(error.message)) as (...args: never[]) => void;
  transport.on('error', listener);
  assert.doesNotThrow(() => transport.write('AT\r'));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 1);
  assert.match(seen[0], /Invalid handle/);
});

test('serial transport routes sync write failures to error subscribers', () => {
  const fake = new FakePort();
  fake.failWrite = 'sync';
  const transport = new SerialTransport(asPort(fake));
  const seen: string[] = [];
  const listener = ((error: Error) => seen.push(error.message)) as (...args: never[]) => void;
  transport.on('error', listener);
  assert.doesNotThrow(() => transport.write('AT\r'));
  assert.equal(seen.length, 1);
});

test('serial transport close failures never throw', async () => {
  const fake = new FakePort();
  fake.failClose = true;
  const transport = new SerialTransport(asPort(fake));
  assert.doesNotThrow(() => transport.close());
  await new Promise((resolve) => setImmediate(resolve));
});

test('serial transport keeps a permanent error guard after removeAllListeners', () => {
  const fake = new FakePort();
  const transport = new SerialTransport(asPort(fake));
  transport.on('data', (() => undefined) as (...args: never[]) => void);
  transport.removeAllListeners();
  assert.doesNotThrow(() => fake.emit('error', new Error('late failure')));
});
