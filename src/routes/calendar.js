import { Router } from 'express';
import { db } from '../db/index.js';

export const calendarRouter = Router();

function monthGrid(year, month /* 1-12 */) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startWeekday = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Posted-history view: what got published where and when. Driven entirely by
// platform_variants (status='posted', posted_at) — marking a variant posted on
// the piece page shows up here too, and vice versa.
calendarRouter.get('/calendar', (req, res) => {
  const now = new Date();
  const [year, month] = (req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    .split('-')
    .map(Number);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  // Archived pieces included: this is history, not a work queue
  const posts = db
    .prepare(
      `SELECT v.id AS variant_id, substr(v.posted_at, 1, 10) AS posted_date, v.live_url,
              cp.id AS piece_id, cp.title AS piece_title, p.display_name AS platform_name
       FROM platform_variants v
       JOIN content_pieces cp ON cp.id = v.content_piece_id
       JOIN platforms p ON p.id = v.platform_id
       WHERE v.status = 'posted' AND v.posted_at LIKE ?
       ORDER BY v.posted_at`
    )
    .all(`${monthPrefix}-%`);

  const postsByDate = {};
  for (const p of posts) (postsByDate[p.posted_date] ??= []).push(p);

  // Every not-yet-posted piece × platform combo is markable — a draft variant
  // doesn't need to exist yet.
  const platforms = db.prepare('SELECT * FROM platforms WHERE enabled = 1 ORDER BY sort_order').all();
  const pieces = db.prepare('SELECT * FROM content_pieces WHERE archived = 0 ORDER BY created_at DESC').all();
  const variants = db.prepare('SELECT * FROM platform_variants').all();
  const byPiece = {};
  for (const v of variants) {
    (byPiece[v.content_piece_id] ??= {})[v.platform_id] = v;
  }
  // Two-step picker: pieces with at least one unposted platform, and the
  // platform choices per piece (filled into the second select client-side).
  const markPieces = [];
  const platformsByPiece = {};
  for (const piece of pieces) {
    const options = platforms
      .filter((p) => byPiece[piece.id]?.[p.id]?.status !== 'posted')
      .map((p) => {
        const v = byPiece[piece.id]?.[p.id];
        return { id: p.id, label: `${p.display_name} (${v ? v.status : 'no draft'})` };
      });
    if (options.length) {
      markPieces.push(piece);
      platformsByPiece[piece.id] = options;
    }
  }

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const today = new Date().toISOString().slice(0, 10);

  res.render('calendar.njk', {
    weeks: monthGrid(year, month),
    postsByDate,
    markPieces,
    platformsByPiece,
    monthLabel: monthPrefix,
    prev,
    next,
    today,
    prefillDate: req.query.date || today,
    msg: req.query.msg,
    err: req.query.err,
  });
});

// Manually record "this piece was published on this platform on this date".
calendarRouter.post('/calendar/mark', (req, res) => {
  const { piece_id: pieceId, platform_id: platformId, posted_date, live_url } = req.body;
  if (!pieceId || !platformId || !/^\d{4}-\d{2}-\d{2}$/.test(posted_date || '')) {
    return res.redirect('/calendar?err=' + encodeURIComponent('Pick a content, a platform and a date.'));
  }
  db.prepare(
    `INSERT OR IGNORE INTO platform_variants (content_piece_id, platform_id, hashtags, status)
     VALUES (?, ?, '[]', 'draft')`
  ).run(pieceId, platformId);
  db.prepare(
    `UPDATE platform_variants SET status = 'posted', posted_at = ?,
       live_url = COALESCE(NULLIF(?, ''), live_url), updated_at = datetime('now')
     WHERE content_piece_id = ? AND platform_id = ?`
  ).run(posted_date, (live_url || '').trim(), pieceId, platformId);
  res.redirect(`/calendar?month=${posted_date.slice(0, 7)}&msg=` + encodeURIComponent('Marked as posted'));
});

calendarRouter.post('/calendar/unmark/:variantId', (req, res) => {
  db.prepare(
    "UPDATE platform_variants SET status = 'ready', posted_at = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(req.params.variantId);
  res.redirect(req.get('referer') || '/calendar');
});
