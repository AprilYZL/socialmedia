import { Router } from 'express';
import { db } from '../db/index.js';
import { getActiveAccount, getEnabledPlatforms, getEnabledMap } from '../services/accounts.js';

export const trackerRouter = Router();

// Dashboard: one row per content piece, one status cell per platform.
trackerRouter.get('/', (req, res) => {
  const active = getActiveAccount();
  const platforms =
    active === 'all'
      ? db.prepare('SELECT * FROM platforms WHERE enabled = 1 ORDER BY sort_order').all()
      : getEnabledPlatforms(active);
  const pieces =
    active === 'all'
      ? db.prepare('SELECT * FROM content_pieces WHERE archived = 0 ORDER BY created_at DESC').all()
      : db
          .prepare('SELECT * FROM content_pieces WHERE archived = 0 AND account_id = ? ORDER BY created_at DESC')
          .all(active);
  const variants = db.prepare('SELECT * FROM platform_variants').all();
  const byPiece = {};
  for (const v of variants) {
    (byPiece[v.content_piece_id] ??= {})[v.platform_id] = v;
  }

  res.render('tracker.njk', {
    platforms,
    pieces,
    byPiece,
    enabledMap: getEnabledMap(),
    msg: req.query.msg,
    err: req.query.err,
  });
});
