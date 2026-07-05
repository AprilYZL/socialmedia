import { Router } from 'express';
import { db } from '../db/index.js';
import { stageVariant, getStagingStatus } from '../uploaders/index.js';

export const uploadRouter = Router();

uploadRouter.post('/variant/:id/stage', (req, res) => {
  const variant = db.prepare('SELECT * FROM platform_variants WHERE id = ?').get(req.params.id);
  if (!variant) return res.status(404).send('Not found');
  try {
    stageVariant(variant.id);
    res.redirect(`/piece/${variant.content_piece_id}?msg=` + encodeURIComponent('Staging started — watch the browser window.'));
  } catch (err) {
    res.redirect(`/piece/${variant.content_piece_id}?err=` + encodeURIComponent(err.message));
  }
});

// Polled by the piece page while staging runs.
uploadRouter.get('/variant/:id/staging-status', (req, res) => {
  const status = getStagingStatus(req.params.id);
  const variant = db.prepare('SELECT status FROM platform_variants WHERE id = ?').get(req.params.id);
  res.json({ staging: status, variantStatus: variant?.status || null });
});
