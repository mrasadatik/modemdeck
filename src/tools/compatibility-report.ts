import Database from 'better-sqlite3';
import path from 'node:path';
const file =
  process.env.MODEMDECK_DATA_PATH || path.join(process.cwd(), 'data', 'modemdeck.sqlite');
const db = new Database(file, { readonly: true });
try {
  const rows = db
    .prepare(
      'SELECT section, kind, name, COUNT(*) AS observations, MAX(created_at) AS last_seen FROM interaction_log GROUP BY section, kind, name ORDER BY section, name',
    )
    .all();
  console.log(
    JSON.stringify(
      {
        source: file,
        observedOnly: true,
        generatedAt: new Date().toISOString(),
        observations: rows,
      },
      null,
      2,
    ),
  );
} catch {
  console.log(
    JSON.stringify(
      {
        source: file,
        observedOnly: true,
        observations: [],
        note: 'No interaction evidence has been recorded.',
      },
      null,
      2,
    ),
  );
} finally {
  db.close();
}
