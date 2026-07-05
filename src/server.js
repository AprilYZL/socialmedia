import { exec } from 'node:child_process';
import express from 'express';
import nunjucks from 'nunjucks';
import { config } from './config.js';
import { closeAllProfiles } from './uploaders/baseUploader.js';
import './db/index.js';
import { trackerRouter } from './routes/tracker.js';
import { contentRouter } from './routes/content.js';
import { variantsRouter } from './routes/variants.js';
import { calendarRouter } from './routes/calendar.js';
import { uploadRouter } from './routes/upload.js';
import { settingsRouter } from './routes/settings.js';

const app = express();

nunjucks.configure(config.viewsDir, { autoescape: true, express: app, noCache: true });
app.set('view engine', 'njk');

app.use(express.urlencoded({ extended: true }));
app.use('/static', express.static(config.publicDir));

app.use(trackerRouter);
app.use(contentRouter);
app.use(variantsRouter);
app.use(calendarRouter);
app.use(uploadRouter);
app.use(settingsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send(`<pre>Something went wrong:\n${err.message}</pre><a href="/">back</a>`);
});

app.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  console.log(`\n🎧 Promoter running at ${url}\n`);
  if (process.platform === 'darwin' && !process.env.NO_OPEN) {
    exec(`open ${url}`);
  }
});

// Close browser windows cleanly on shutdown so Chromium flushes logins to
// the profile dirs; a hard kill would lose any login done this session.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} — closing browser windows so logins are saved…`);
  await Promise.race([
    closeAllProfiles(),
    new Promise((r) => setTimeout(r, 8000)), // don't hang forever on a stuck browser
  ]).catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
