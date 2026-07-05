import { db, getSetting } from '../db/index.js';

export function getAccounts() {
  return db.prepare('SELECT * FROM accounts ORDER BY sort_order').all();
}

export function isAccountId(id) {
  return Boolean(db.prepare('SELECT 1 FROM accounts WHERE id = ?').get(id));
}

// The nav switcher state: an account id, or 'all' for the combined view.
export function getActiveAccount() {
  const value = getSetting('active_account', 'all');
  return value === 'all' || isAccountId(value) ? value : 'all';
}

// Platforms this account actually exists on (and that aren't globally
// disabled), for building variant cards / tracker columns / pickers.
export function getEnabledPlatforms(accountId) {
  return db
    .prepare(
      `SELECT p.* FROM platforms p
       JOIN account_platforms ap ON ap.platform_id = p.id
       WHERE ap.account_id = ? AND ap.enabled = 1 AND p.enabled = 1
       ORDER BY p.sort_order`
    )
    .all(accountId);
}

// { accountId: { platformId: true } } for globally-enabled platforms.
export function getEnabledMap() {
  const map = {};
  const rows = db
    .prepare(
      `SELECT ap.account_id, ap.platform_id FROM account_platforms ap
       JOIN platforms p ON p.id = ap.platform_id
       WHERE ap.enabled = 1 AND p.enabled = 1`
    )
    .all();
  for (const row of rows) {
    (map[row.account_id] ??= {})[row.platform_id] = true;
  }
  return map;
}
