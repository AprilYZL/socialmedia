import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';

const LIST_PATH = path.join(config.assetsDir, 'sensitive-words.zh.json');

function loadList() {
  try {
    return JSON.parse(fs.readFileSync(LIST_PATH, 'utf8'));
  } catch {
    return [];
  }
}

// Deterministic first-pass check against the user-editable static list.
// Returns [{word, reason, source: 'static'}].
export function checkSensitiveWords(text) {
  if (!text) return [];
  const hits = [];
  for (const entry of loadList()) {
    if (text.includes(entry.word)) {
      hits.push({ word: entry.word, reason: entry.reason, source: 'static' });
    }
  }
  return hits;
}

export function mergeFlags(staticFlags, aiFlags) {
  const seen = new Set(staticFlags.map((f) => f.word));
  const merged = [...staticFlags];
  for (const f of aiFlags || []) {
    if (!seen.has(f.word)) {
      merged.push({ word: f.word, reason: f.reason, source: 'ai' });
      seen.add(f.word);
    }
  }
  return merged;
}
