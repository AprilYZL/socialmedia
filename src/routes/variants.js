import { Router } from 'express';
import { db } from '../db/index.js';
import { generateVariants } from '../services/ai/generateVariants.js';
import { checkSensitiveWords } from '../services/ai/sensitiveWords.js';
import { parseHashtags } from '../services/compose.js';
import { fillFromMaster } from '../services/templates.js';

export const variantsRouter = Router();

const STATUSES = ['draft', 'ready', 'staged', 'posted', 'failed', 'skipped'];
const CN_PLATFORMS = new Set(['bilibili', 'xiaohongshu', 'douyin']);

const upsertVariant = db.prepare(`
  INSERT INTO platform_variants
    (content_piece_id, platform_id, title, caption, hashtags, language, sensitive_flags, status, ai_generated, updated_at)
  VALUES (@pieceId, @platform, @title, @caption, @hashtags, @language, @flags, 'draft', @ai, datetime('now'))
  ON CONFLICT(content_piece_id, platform_id) DO UPDATE SET
    title = excluded.title,
    caption = excluded.caption,
    hashtags = excluded.hashtags,
    language = excluded.language,
    sensitive_flags = excluded.sensitive_flags,
    status = 'draft',
    ai_generated = excluded.ai_generated,
    updated_at = datetime('now')
`);

// AI-draft variants for the selected platforms.
variantsRouter.post('/piece/:id/generate', async (req, res) => {
  const pieceId = req.params.id;
  const piece = db.prepare('SELECT * FROM content_pieces WHERE id = ?').get(pieceId);
  if (!piece) return res.status(404).send('Not found');

  let platformIds = req.body.platforms || [];
  if (typeof platformIds === 'string') platformIds = [platformIds];
  if (!platformIds.length) {
    return res.redirect(`/piece/${pieceId}?err=` + encodeURIComponent('Select at least one platform to generate.'));
  }

  const assets = db.prepare('SELECT * FROM media_assets WHERE content_piece_id = ?').all(pieceId);

  try {
    const drafts = await generateVariants({ piece, assets, platformIds });
    for (const d of drafts) {
      upsertVariant.run({
        pieceId,
        platform: d.platform,
        title: d.title,
        caption: d.caption,
        hashtags: JSON.stringify(d.hashtags),
        language: d.language,
        flags: JSON.stringify(d.flags),
        ai: 1,
      });
    }
    res.redirect(`/piece/${pieceId}?msg=` + encodeURIComponent(`Drafted ${drafts.length} variant(s) — review and edit below.`));
  } catch (err) {
    res.redirect(`/piece/${pieceId}?err=` + encodeURIComponent(`AI generation failed: ${err.message}`));
  }
});

// Fill a draft directly from the master title/description (no AI), shaped by
// the platform's optional template. Keeps existing hashtags if a draft exists.
variantsRouter.post('/piece/:id/variant/:platform/fill', (req, res) => {
  const { id, platform } = req.params;
  const piece = db.prepare('SELECT * FROM content_pieces WHERE id = ?').get(id);
  if (!piece) return res.status(404).send('Not found');

  const template = db.prepare('SELECT * FROM platform_templates WHERE platform_id = ?').get(platform);
  const { title, caption } = fillFromMaster(piece, template);

  const flags = CN_PLATFORMS.has(platform)
    ? checkSensitiveWords(`${title}\n${caption}`)
    : [];

  const existing = db
    .prepare('SELECT id FROM platform_variants WHERE content_piece_id = ? AND platform_id = ?')
    .get(id, platform);
  if (existing) {
    db.prepare(
      `UPDATE platform_variants SET title = ?, caption = ?, sensitive_flags = ?,
         status = 'draft', ai_generated = 0, updated_at = datetime('now') WHERE id = ?`
    ).run(title, caption, JSON.stringify(flags), existing.id);
  } else {
    db.prepare(
      `INSERT INTO platform_variants
         (content_piece_id, platform_id, title, caption, hashtags, sensitive_flags, status, ai_generated)
       VALUES (?, ?, ?, ?, '[]', ?, 'draft', 0)`
    ).run(id, platform, title, caption, JSON.stringify(flags));
  }
  res.redirect(`/piece/${id}?msg=` + encodeURIComponent('Filled from master — review below.'));
});

// Create an empty draft for manual writing.
variantsRouter.post('/piece/:id/variant/:platform/create', (req, res) => {
  const { id, platform } = req.params;
  db.prepare(
    `INSERT OR IGNORE INTO platform_variants (content_piece_id, platform_id, hashtags, status)
     VALUES (?, ?, '[]', 'draft')`
  ).run(id, platform);
  res.redirect(`/piece/${id}`);
});

// Save edits to a variant (re-runs the static sensitive-word check for CN platforms).
variantsRouter.post('/variant/:id', (req, res) => {
  const variant = db.prepare('SELECT * FROM platform_variants WHERE id = ?').get(req.params.id);
  if (!variant) return res.status(404).send('Not found');

  const title = req.body.title || '';
  const caption = req.body.caption || '';
  const hashtags = parseHashtags(req.body.hashtags || '');
  const status = STATUSES.includes(req.body.status) ? req.body.status : variant.status;
  const liveUrl = (req.body.live_url || '').trim() || null;

  let flags = [];
  if (CN_PLATFORMS.has(variant.platform_id)) {
    const aiFlags = (JSON.parse(variant.sensitive_flags || '[]') || []).filter((f) => f.source === 'ai');
    const staticFlags = checkSensitiveWords(`${title}\n${caption}\n${hashtags.join(' ')}`);
    const seen = new Set(staticFlags.map((f) => f.word));
    flags = [...staticFlags, ...aiFlags.filter((f) => `${title}\n${caption}`.includes(f.word) && !seen.has(f.word))];
  }

  db.prepare(
    `UPDATE platform_variants SET
       title = ?, caption = ?, hashtags = ?, sensitive_flags = ?, status = ?,
       live_url = ?, posted_at = CASE WHEN ? = 'posted' AND posted_at IS NULL THEN datetime('now') ELSE posted_at END,
       ai_generated = CASE WHEN title != ? OR caption != ? THEN 0 ELSE ai_generated END,
       updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    title, caption, JSON.stringify(hashtags), JSON.stringify(flags), status,
    liveUrl, status, variant.title || '', variant.caption || '', variant.id
  );

  res.redirect(`/piece/${variant.content_piece_id}?msg=` + encodeURIComponent('Variant saved'));
});
