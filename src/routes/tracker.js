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

  const today = new Date().toISOString().slice(0, 10);
  const dueToday = db
    .prepare(
      `SELECT s.*, v.platform_id, v.status AS variant_status, cp.title AS piece_title, cp.id AS piece_id,
              p.display_name AS platform_name
       FROM schedule_slots s
       JOIN platform_variants v ON v.id = s.platform_variant_id
       JOIN content_pieces cp ON cp.id = v.content_piece_id
       JOIN platforms p ON p.id = v.platform_id
       WHERE s.done = 0 AND s.scheduled_date <= ?
       ORDER BY s.scheduled_date, s.scheduled_time`
    )
    .all(today);

  res.render('tracker.njk', { platforms, pieces, byPiece, dueToday, today, msg: req.query.msg, err: req.query.err });
});
