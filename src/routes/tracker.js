import { Router } from 'express';
import { db } from '../db/index.js';

export const trackerRouter = Router();

// Dashboard: one row per content piece, one status cell per platform.
trackerRouter.get('/', (req, res) => {
  const platforms = db.prepare('SELECT * FROM platforms WHERE enabled = 1 ORDER BY sort_order').all();
  const pieces = db
    .prepare('SELECT * FROM content_pieces WHERE archived = 0 ORDER BY created_at DESC')
    .all();
  const variants = db.prepare('SELECT * FROM platform_variants').all();
  const byPiece = {};
  for (const v of variants) {
    (byPiece[v.content_piece_id] ??= {})[v.platform_id] = v;
  }

  res.render('tracker.njk', { platforms, pieces, byPiece, msg: req.query.msg, err: req.query.err });
});
