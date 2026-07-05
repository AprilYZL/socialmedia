import { spawn } from 'node:child_process';

// macOS clipboard. Used as the graceful-degradation path when a Playwright
// upload driver fails: the composed caption lands on the clipboard so the
// user can paste it manually.
export function pbcopy(text) {
  return new Promise((resolve, reject) => {
    const proc = spawn('pbcopy');
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pbcopy exited ${code}`))));
    proc.stdin.end(text);
  });
}
