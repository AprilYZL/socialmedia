import { Router } from 'express';
import fs from 'node:fs';
import { db } from '../db/index.js';
import { probe, checkConstraints } from '../services/media.js';
import { composeText } from '../services/compose.js';
import { getStagingStatus } from '../uploaders/index.js';

export const contentRouter = Router();

const CONTENT_TYPES = ['short_video', 'long_video', 'article', 'poster'];

contentRouter.get('/library', (req, res) => {
  const pieces = db
    .prepare(
      `SELECT cp.*,
              (SELECT COUNT(*) FROM media_assets ma WHERE ma.content_piece_id = cp.id) AS media_count,
              (SELECT COUNT(*) FROM platform_variants v WHERE v.content_piece_id = cp.id) AS variant_count
       FROM content_pieces cp WHERE cp.archived = 0 ORDER BY cp.created_at DESC`
    )
    .all();
  res.render('library.njk', { pieces, contentTypes: CONTENT_TYPES, msg: req.query.msg, err: req.query.err });
});

contentRouter.post('/library', (req, res) => {
  const { title, content_type, master_description } = req.body;
  if (!title?.trim()) return res.redirect('/library?err=' + encodeURIComponent('Title is required'));
  const type = CONTENT_TYPES.includes(content_type) ? content_type : 'short_video';
  const info = db
    .prepare('INSERT INTO content_pieces (title, content_type, master_description) VALUES (?, ?, ?)')
    .run(title.trim(), type, master_description || '');
  res.redirect(`/piece/${info.lastInsertRowid}`);
});

contentRouter.get('/piece/:id', (req, res) => {
  const piece = db.prepare('SELECT * FROM content_pieces WHERE id = ?').get(req.params.id);
  if (!piece) return res.status(404).send('Not found');

  const assets = db.prepare('SELECT * FROM media_assets WHERE content_piece_id = ? ORDER BY id').all(piece.id);
  const platforms = db.prepare('SELECT * FROM platforms WHERE enabled = 1 ORDER BY sort_order').all();
  const variants = db.prepare('SELECT * FROM platform_variants WHERE content_piece_id = ?').all(piece.id);
  const variantsByPlatform = Object.fromEntries(variants.map((v) => [v.platform_id, v]));

  const allGroups = db.prepare('SELECT * FROM hashtag_groups ORDER BY sort_order, id').all();
  const defaultTagsByPlatform = Object.fromEntries(
    allGroups.filter((g) => g.platform_id).map((g) => [g.platform_id, JSON.parse(g.tags)])
  );
  const namedGroups = allGroups
    .filter((g) => !g.platform_id)
    .map((g) => ({ name: g.name, tags: JSON.parse(g.tags) }));

  const cards = platforms.map((p) => {
    const constraints = p.constraints ? JSON.parse(p.constraints) : null;
    const v = variantsByPlatform[p.id] || null;
    const mediaWarnings = assets.flatMap((a) =>
      a.kind === 'video' ? checkConstraints(a, constraints).map((w) => `${w}`) : []
    );
    return {
      platform: p,
      constraints,
      variant: v,
      flags: v?.sensitive_flags ? JSON.parse(v.sensitive_flags) : [],
      hashtagsText: v ? (JSON.parse(v.hashtags || '[]') || []).join(' ') : '',
      composed: v ? composeText(v) : '',
      mediaWarnings,
      staging: v ? getStagingStatus(v.id) : null,
      defaultTags: defaultTagsByPlatform[p.id] || [],
    };
  });

  res.render('piece.njk', {
    piece,
    assets,
    cards,
    namedGroups,
    contentTypes: CONTENT_TYPES,
    msg: req.query.msg,
    err: req.query.err,
  });
});

contentRouter.post('/piece/:id', (req, res) => {
  const { title, content_type, master_description } = req.body;
  db.prepare('UPDATE content_pieces SET title = ?, content_type = ?, master_description = ? WHERE id = ?').run(
    title?.trim() || 'Untitled',
    CONTENT_TYPES.includes(content_type) ? content_type : 'short_video',
    master_description || '',
    req.params.id
  );
  res.redirect(`/piece/${req.params.id}?msg=` + encodeURIComponent('Saved'));
});

contentRouter.post('/piece/:id/archive', (req, res) => {
  db.prepare('UPDATE content_pieces SET archived = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/library?msg=' + encodeURIComponent('Archived'));
});

contentRouter.post('/piece/:id/media', async (req, res) => {
  const filePath = (req.body.file_path || '').trim().replace(/\\ /g, ' ');
  const pieceId = req.params.id;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.redirect(`/piece/${pieceId}?err=` + encodeURIComponent(`File not found: ${filePath}`));
  }
  const meta = await probe(filePath);
  db.prepare(
    `INSERT INTO media_assets (content_piece_id, file_path, kind, width, height, duration_sec, size_bytes, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pieceId, filePath, meta.kind, meta.width, meta.height, meta.duration_sec, meta.size_bytes, req.body.role || 'primary');
  res.redirect(`/piece/${pieceId}?msg=` + encodeURIComponent('Media added'));
});

contentRouter.post('/media/:id/delete', (req, res) => {
  const asset = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(req.params.id);
  if (asset) db.prepare('DELETE FROM media_assets WHERE id = ?').run(asset.id);
  res.redirect(asset ? `/piece/${asset.content_piece_id}` : '/library');
});
