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

calendarRouter.get('/calendar', (req, res) => {
  const now = new Date();
  const [year, month] = (req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    .split('-')
    .map(Number);

  const slots = db
    .prepare(
      `SELECT s.*, v.platform_id, cp.title AS piece_title, cp.id AS piece_id, p.display_name AS platform_name
       FROM schedule_slots s
       JOIN platform_variants v ON v.id = s.platform_variant_id
       JOIN content_pieces cp ON cp.id = v.content_piece_id
       JOIN platforms p ON p.id = v.platform_id
       WHERE s.scheduled_date LIKE ?
       ORDER BY s.scheduled_date, s.scheduled_time`
    )
    .all(`${year}-${String(month).padStart(2, '0')}-%`);

  const slotsByDate = {};
  for (const s of slots) (slotsByDate[s.scheduled_date] ??= []).push(s);

  // All variants selectable for scheduling
  const variantOptions = db
    .prepare(
      `SELECT v.id, cp.title AS piece_title, p.display_name AS platform_name, v.status
       FROM platform_variants v
       JOIN content_pieces cp ON cp.id = v.content_piece_id
       JOIN platforms p ON p.id = v.platform_id
       WHERE cp.archived = 0 AND v.status NOT IN ('posted', 'skipped')
       ORDER BY cp.created_at DESC, p.sort_order`
    )
    .all();

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const today = new Date().toISOString().slice(0, 10);

  res.render('calendar.njk', {
    weeks: monthGrid(year, month),
    slotsByDate,
    variantOptions,
    monthLabel: `${year}-${String(month).padStart(2, '0')}`,
    prev,
    next,
    today,
    msg: req.query.msg,
    err: req.query.err,
  });
});

calendarRouter.post('/calendar', (req, res) => {
  const { variant_id, scheduled_date, scheduled_time, note } = req.body;
  if (!variant_id || !scheduled_date) {
    return res.redirect('/calendar?err=' + encodeURIComponent('Pick a variant and a date.'));
  }
  db.prepare(
    'INSERT INTO schedule_slots (platform_variant_id, scheduled_date, scheduled_time, note) VALUES (?, ?, ?, ?)'
  ).run(variant_id, scheduled_date, scheduled_time || null, note || null);
  res.redirect(`/calendar?month=${scheduled_date.slice(0, 7)}&msg=` + encodeURIComponent('Scheduled'));
});

calendarRouter.post('/slot/:id/done', (req, res) => {
  db.prepare('UPDATE schedule_slots SET done = 1 WHERE id = ?').run(req.params.id);
  res.redirect(req.get('referer') || '/calendar');
});

calendarRouter.post('/slot/:id/delete', (req, res) => {
  db.prepare('DELETE FROM schedule_slots WHERE id = ?').run(req.params.id);
  res.redirect(req.get('referer') || '/calendar');
});
