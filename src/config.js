import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  root: ROOT,
  port: 4321,
  dataDir: path.join(ROOT, 'data'),
  dbPath: path.join(ROOT, 'data', 'app.db'),
  profilesDir: path.join(ROOT, 'data', 'profiles'),
  assetsDir: path.join(ROOT, 'assets'),
  viewsDir: path.join(ROOT, 'src', 'views'),
  publicDir: path.join(ROOT, 'src', 'public'),
  defaultModel: 'claude-sonnet-5',
  defaultThrottleSeconds: 60,
};
