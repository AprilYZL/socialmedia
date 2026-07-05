import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting } from '../db/index.js';
import { config } from '../config.js';
import { openLoginWindow } from '../uploaders/index.js';
import { parseHashtags } from '../services/compose.js';
import { isAccountId } from '../services/accounts.js';

export const settingsRouter = Router();

settingsRouter.get('/settings', (req, res) => {
  const platforms = db.prepare('SELECT * FROM platforms ORDER BY sort_order').all();
  // { accountId: { platformId: { enabled, hasProfile } } } for the login matrix
  const accountRows = {};
  for (const ap of db.prepare('SELECT * FROM account_platforms').all()) {
    (accountRows[ap.account_id] ??= {})[ap.platform_id] = {
      enabled: ap.enabled,
      hasProfile: fs.existsSync(path.join(config.profilesDir, ap.account_id, ap.platform_id, 'Default')),
    };
  }
  const apiKey = getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';

  const templates = Object.fromEntries(
    db.prepare('SELECT * FROM platform_templates').all().map((t) => [t.platform_id, t])
  );
  const groups = db.prepare('SELECT * FROM hashtag_groups ORDER BY sort_order, id').all();
  const defaultSets = Object.fromEntries(
    groups.filter((g) => g.platform_id).map((g) => [g.platform_id, JSON.parse(g.tags).join(' ')])
  );
  const namedGroups = groups
    .filter((g) => !g.platform_id)
    .map((g) => ({ ...g, tagsText: JSON.parse(g.tags).join(' ') }));

  res.render('settings.njk', {
    platforms,
    accountRows,
    maskedKey: apiKey ? `${apiKey.slice(0, 10)}…${apiKey.slice(-4)}` : '',
    model: getSetting('model') || config.defaultModel,
    throttle: getSetting('throttle_seconds') || config.defaultThrottleSeconds,
    templates,
    defaultSets,
    namedGroups,
    glossary: getSetting('translation_glossary', ''),
    msg: req.query.msg,
    err: req.query.err,
  });
});

// Unconditional set (unlike POST /settings, which skips empty fields) so the
// glossary can be cleared.
settingsRouter.post('/settings/glossary', (req, res) => {
  setSetting('translation_glossary', (req.body.glossary || '').trim());
  res.redirect('/settings?msg=' + encodeURIComponent('Glossary saved'));
});

// Save per-platform title/caption templates ({title}/{description} placeholders).
settingsRouter.post('/settings/templates', (req, res) => {
  const platforms = db.prepare('SELECT id FROM platforms').all();
  const upsert = db.prepare(`
    INSERT INTO platform_templates (platform_id, title_template, caption_template)
    VALUES (?, ?, ?)
    ON CONFLICT(platform_id) DO UPDATE SET
      title_template = excluded.title_template,
      caption_template = excluded.caption_template
  `);
  for (const p of platforms) {
    upsert.run(p.id, (req.body[`title_${p.id}`] || '').trim() || null, (req.body[`caption_${p.id}`] || '').trim() || null);
  }
  res.redirect('/settings?msg=' + encodeURIComponent('Templates saved'));
});

// Save the per-platform default hashtag sets.
settingsRouter.post('/settings/hashtag-defaults', (req, res) => {
  const platforms = db.prepare('SELECT id, display_name FROM platforms').all();
  const del = db.prepare('DELETE FROM hashtag_groups WHERE platform_id = ?');
  const ins = db.prepare(
    'INSERT INTO hashtag_groups (name, platform_id, tags, sort_order) VALUES (?, ?, ?, 0)'
  );
  for (const p of platforms) {
    const tags = parseHashtags(req.body[`defaults_${p.id}`] || '');
    del.run(p.id);
    if (tags.length) ins.run(`${p.display_name} defaults`, p.id, JSON.stringify(tags));
  }
  res.redirect('/settings?msg=' + encodeURIComponent('Default hashtags saved'));
});

// Create or update a named hashtag group.
settingsRouter.post('/settings/hashtag-group', (req, res) => {
  const name = (req.body.name || '').trim();
  const tags = parseHashtags(req.body.tags || '');
  if (!name || !tags.length) {
    return res.redirect('/settings?err=' + encodeURIComponent('A group needs a name and at least one tag.'));
  }
  if (req.body.id) {
    db.prepare('UPDATE hashtag_groups SET name = ?, tags = ? WHERE id = ? AND platform_id IS NULL').run(
      name, JSON.stringify(tags), req.body.id
    );
  } else {
    db.prepare('INSERT INTO hashtag_groups (name, platform_id, tags, sort_order) VALUES (?, NULL, ?, 99)').run(
      name, JSON.stringify(tags)
    );
  }
  res.redirect('/settings?msg=' + encodeURIComponent('Hashtag group saved'));
});

settingsRouter.post('/settings/hashtag-group/:id/delete', (req, res) => {
  db.prepare('DELETE FROM hashtag_groups WHERE id = ? AND platform_id IS NULL').run(req.params.id);
  res.redirect('/settings?msg=' + encodeURIComponent('Group deleted'));
});

settingsRouter.post('/settings', (req, res) => {
  if (req.body.anthropic_api_key?.trim()) setSetting('anthropic_api_key', req.body.anthropic_api_key.trim());
  if (req.body.model?.trim()) setSetting('model', req.body.model.trim());
  const throttle = parseInt(req.body.throttle_seconds, 10);
  if (!Number.isNaN(throttle) && throttle >= 0) setSetting('throttle_seconds', String(throttle));
  res.redirect('/settings?msg=' + encodeURIComponent('Settings saved'));
});

settingsRouter.post('/settings/platform/:id/toggle', (req, res) => {
  db.prepare('UPDATE platforms SET enabled = 1 - enabled WHERE id = ?').run(req.params.id);
  res.redirect('/settings');
});

// Whether an account exists on a platform (e.g. JusticeCN might have no YouTube).
settingsRouter.post('/settings/account-platform/:accountId/:platformId/toggle', (req, res) => {
  db.prepare('UPDATE account_platforms SET enabled = 1 - enabled WHERE account_id = ? AND platform_id = ?').run(
    req.params.accountId,
    req.params.platformId
  );
  res.redirect('/settings');
});

settingsRouter.post('/settings/login/:platformId/:accountId', async (req, res) => {
  if (!isAccountId(req.params.accountId)) {
    return res.redirect('/settings?err=' + encodeURIComponent('Unknown account.'));
  }
  try {
    await openLoginWindow(req.params.platformId, req.params.accountId);
    res.redirect('/settings?msg=' + encodeURIComponent('Login window opened — scan the QR code or sign in, then just close the window.'));
  } catch (err) {
    res.redirect('/settings?err=' + encodeURIComponent(err.message));
  }
});
