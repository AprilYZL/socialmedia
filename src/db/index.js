import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { seed } from './seed.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.profilesDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Idempotent micro-migrations for databases created before a column existed
// (CREATE TABLE IF NOT EXISTS won't alter an existing table). Must run before
// the schema exec: schema.sql indexes may reference the added columns.
const pieceCols = db.prepare('PRAGMA table_info(content_pieces)').all().map((c) => c.name);
if (pieceCols.length && !pieceCols.includes('source_url')) {
  db.exec('ALTER TABLE content_pieces ADD COLUMN source_url TEXT');
}
if (pieceCols.length && !pieceCols.includes('account_id')) {
  // No REFERENCES clause here: SQLite rejects ADD COLUMN with both a foreign
  // key and a non-NULL default while foreign_keys is ON. Fresh databases get
  // the FK from schema.sql instead.
  db.exec("ALTER TABLE content_pieces ADD COLUMN account_id TEXT NOT NULL DEFAULT 'frenchtouch'");
  // Pre-account pieces were all Justice videos; must stay inside this
  // column-missing branch so it never reruns on later boots.
  db.exec("UPDATE content_pieces SET account_id = 'justicecn'");
}
if (pieceCols.length && !pieceCols.includes('original_text')) {
  db.exec('ALTER TABLE content_pieces ADD COLUMN original_text TEXT');
}

const schema = fs.readFileSync(path.join(config.root, 'src', 'db', 'schema.sql'), 'utf8');
db.exec(schema);
seed(db);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
