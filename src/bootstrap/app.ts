import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../infrastructure/config/config.js';
import { createSqliteRepository } from '../infrastructure/persistence/sqlite-repository.js';
import { sessionKeyOrNull } from './session.js';
import { EventBus } from '../infrastructure/events/event-bus.js';
import { createInteractionLog } from '../infrastructure/logging/interaction-log.js';

/** Composition root for embedders and tests. server.ts supplies the runtime entrypoint. */
export function createApp({
  rootDir = path.dirname(fileURLToPath(import.meta.url)),
}: { rootDir?: string } = {}) {
  const config = loadConfig(rootDir);
  const repository = createSqliteRepository(
    config.dataPath || path.join(rootDir, 'data', 'modemdeck.sqlite'),
    {
      sms: [],
      sent: [],
      calls: [],
      ussd: [],
      contacts: [],
      parts: {},
      seen: {},
    },
    {
      persistSensitive: config.persistSensitive,
      retentionDays: config.retentionDays,
      getKey: () => sessionKeyOrNull(),
    },
  );
  const interaction = createInteractionLog(
    config.dataPath || path.join(rootDir, 'data', 'modemdeck.sqlite'),
    config.logPayloads,
  );
  return { config, repository, interaction, events: new EventBus() };
}
