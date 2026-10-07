import type { PlatformCommand } from './modem-provider.js';
import { createWindowsProvider, type PlatformProvider } from './providers.js';

/** Factory + Strategy for provider selection: choose the right environment plugin at bootstrap. */
export function createDefaultProvider(
  run: PlatformCommand,
  env: NodeJS.ProcessEnv = process.env,
): PlatformProvider {
  const explicit = env.MODEMDECK_PROVIDER;
  if (explicit === 'windows' || (!explicit && process.platform === 'win32'))
    return createWindowsProvider(run);
  throw new Error(
    `No PlatformProvider registered for this environment (os=${process.platform}, requested=${explicit ?? 'auto'}).`,
  );
}
