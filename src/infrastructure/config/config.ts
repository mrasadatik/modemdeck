import fs from 'node:fs';
import path from 'node:path';
import type { ModemConfig } from '../../domain/entities/types.js';

export function validateConfig(config: ModemConfig): ModemConfig {
  if (typeof config.port !== 'string') throw new Error('MODEMDECK_PORT is invalid');
  if (!Number.isInteger(config.http) || config.http < 1 || config.http > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  if (typeof config.dialup !== 'string') throw new Error('DIALUP is invalid');
  if (!Number.isInteger(config.baud) || config.baud < 1200 || config.baud > 4000000)
    throw new Error('MODEMDECK_BAUD is invalid');
  if (config.authToken !== undefined && typeof config.authToken !== 'string')
    throw new Error('MODEMDECK_AUTH_TOKEN is invalid');
  if (config.dataPath !== undefined && typeof config.dataPath !== 'string')
    throw new Error('MODEMDECK_DATA_PATH is invalid');
  if (config.persistSensitive !== undefined && typeof config.persistSensitive !== 'boolean')
    throw new Error('MODEMDECK_PERSIST_SENSITIVE is invalid');
  if (
    config.retentionDays !== undefined &&
    (!Number.isInteger(config.retentionDays) || config.retentionDays < 0)
  )
    throw new Error('MODEMDECK_RETENTION_DAYS is invalid');
  if (config.port && !/^[A-Za-z0-9._:-]{1,120}$/.test(config.port))
    throw new Error('MODEMDECK_PORT is invalid');
  if (config.dialup && config.dialup.length > 120) throw new Error('DIALUP is invalid');
  if (config.profile !== undefined && typeof config.profile !== 'string')
    throw new Error('MODEMDECK_PROFILE is invalid');
  if (config.profile && !/^[A-Za-z0-9._-]{1,80}$/.test(config.profile))
    throw new Error('MODEMDECK_PROFILE is invalid');
  if (config.captureRaw !== undefined && typeof config.captureRaw !== 'boolean')
    throw new Error('MODEMDECK_CAPTURE_RAW is invalid');
  if (config.capturePath !== undefined && typeof config.capturePath !== 'string')
    throw new Error('MODEMDECK_CAPTURE_PATH is invalid');
  if (config.capturePath && config.capturePath.length > 260)
    throw new Error('MODEMDECK_CAPTURE_PATH is invalid');
  if (config.logPayloads !== undefined && typeof config.logPayloads !== 'boolean')
    throw new Error('MODEMDECK_LOG_PAYLOADS is invalid');
  return config;
}

export function saveConfig(rootDir: string, config: ModemConfig): void {
  const file = path.join(rootDir, 'config.json');
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporary, file);
}

/** Load file configuration, with environment variables taking precedence. */
export function loadConfig(rootDir: string, env: NodeJS.ProcessEnv = process.env): ModemConfig {
  const file = path.join(rootDir, 'config.json');
  let fileConfig: Partial<ModemConfig> = {};
  try {
    if (fs.existsSync(file)) fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error: unknown) {
    console.error(
      'Ignoring invalid config.json:',
      error instanceof Error ? error.message : String(error),
    );
  }
  const result: ModemConfig = {
    port: '',
    http: 3000,
    dialup: '',
    baud: 115200,
    authToken: '',
    dataPath: path.join(rootDir, 'data', 'modemdeck.sqlite'),
    persistSensitive: false,
    retentionDays: 90,
    profile: 'generic-standards',
    captureRaw: false,
    capturePath: path.join(rootDir, 'data', 'traces', 'live.ndjson'),
    logPayloads: false,
    ...fileConfig,
  };
  const overrides: Partial<ModemConfig> = {};
  if (env.MODEMDECK_PORT !== undefined) overrides.port = env.MODEMDECK_PORT;
  if (env.PORT !== undefined) overrides.http = Number(env.PORT);
  if (env.DIALUP !== undefined) overrides.dialup = env.DIALUP;
  if (env.MODEMDECK_BAUD !== undefined) overrides.baud = Number(env.MODEMDECK_BAUD);
  if (env.MODEMDECK_AUTH_TOKEN !== undefined) overrides.authToken = env.MODEMDECK_AUTH_TOKEN;
  if (env.MODEMDECK_DATA_PATH !== undefined) overrides.dataPath = env.MODEMDECK_DATA_PATH;
  if (env.MODEMDECK_PERSIST_SENSITIVE !== undefined)
    overrides.persistSensitive = env.MODEMDECK_PERSIST_SENSITIVE === 'true';
  if (env.MODEMDECK_RETENTION_DAYS !== undefined)
    overrides.retentionDays = Number(env.MODEMDECK_RETENTION_DAYS);
  if (env.MODEMDECK_PROFILE !== undefined) overrides.profile = env.MODEMDECK_PROFILE;
  if (env.MODEMDECK_CAPTURE_RAW !== undefined)
    overrides.captureRaw = env.MODEMDECK_CAPTURE_RAW === 'true';
  if (env.MODEMDECK_CAPTURE_PATH !== undefined) overrides.capturePath = env.MODEMDECK_CAPTURE_PATH;
  if (env.MODEMDECK_LOG_PAYLOADS !== undefined)
    overrides.logPayloads = env.MODEMDECK_LOG_PAYLOADS === 'true';
  Object.assign(result, overrides);
  return validateConfig(result);
}
