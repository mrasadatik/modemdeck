import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, saveConfig, validateConfig } from '../src/infrastructure/config/config.js';

test('configuration applies defaults, file values, then environment overrides', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modemdeck-config-'));
  try {
    fs.writeFileSync(
      path.join(rootDir, 'config.json'),
      JSON.stringify({
        port: 'COM-file',
        http: 3100,
        baud: 9600,
        authToken: 'file-token',
        persistSensitive: true,
        retentionDays: 30,
      }),
    );
    const config = loadConfig(rootDir, {
      MODEMDECK_PORT: 'COM-env',
      PORT: '3200',
      MODEMDECK_BAUD: '19200',
      MODEMDECK_AUTH_TOKEN: 'env-token',
      MODEMDECK_PERSIST_SENSITIVE: 'false',
      MODEMDECK_RETENTION_DAYS: '60',
    });
    assert.equal(config.port, 'COM-env');
    assert.equal(config.http, 3200);
    assert.equal(config.baud, 19200);
    assert.equal(config.authToken, 'env-token');
    assert.equal(config.persistSensitive, false);
    assert.equal(config.retentionDays, 60);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('configuration preserves file values when environment variables are absent', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modemdeck-config-'));
  try {
    fs.writeFileSync(
      path.join(rootDir, 'config.json'),
      JSON.stringify({
        port: 'COM-file',
        http: 3100,
        authToken: 'file-token',
        persistSensitive: true,
      }),
    );
    const config = loadConfig(rootDir, {});
    assert.equal(config.port, 'COM-file');
    assert.equal(config.http, 3100);
    assert.equal(config.authToken, 'file-token');
    assert.equal(config.persistSensitive, true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('configuration rejects malformed persisted types', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modemdeck-config-'));
  try {
    fs.writeFileSync(
      path.join(rootDir, 'config.json'),
      JSON.stringify({ baud: '115200', captureRaw: 'true' }),
    );
    assert.throws(() => loadConfig(rootDir, {}), /MODEMDECK_BAUD is invalid/);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('configuration writes a valid replacement file atomically', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modemdeck-config-'));
  try {
    const config = validateConfig({
      port: '',
      http: 3000,
      dialup: '',
      baud: 115200,
      profile: 'generic-standards',
    });
    saveConfig(rootDir, config);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(rootDir, 'config.json'), 'utf8')),
      config,
    );
    assert.equal(fs.existsSync(path.join(rootDir, 'config.json.tmp')), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
