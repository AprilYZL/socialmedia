import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.bmp', '.tiff']);

// Probe a local media file with ffprobe. Returns metadata for media_assets.
export async function probe(filePath) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  let kind = IMAGE_EXTS.has(ext) ? 'image' : 'video';
  let width = null;
  let height = null;
  let duration_sec = null;

  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const info = JSON.parse(stdout);
    const video = (info.streams || []).find((s) => s.codec_type === 'video');
    if (video) {
      width = video.width ?? null;
      height = video.height ?? null;
    }
    const dur = parseFloat(info.format?.duration);
    if (!Number.isNaN(dur)) duration_sec = dur;
    // Stills report a video stream but no meaningful duration
    if (kind === 'video' && (duration_sec === null || duration_sec < 0.5) && IMAGE_EXTS.has(ext)) {
      kind = 'image';
    }
  } catch {
    // ffprobe failed (unsupported format etc.) — keep extension-based kind, no dimensions
  }

  return { kind, width, height, duration_sec, size_bytes: stat.size };
}

// Compare probed metadata against a platform's constraints; returns warning strings.
export function checkConstraints(asset, constraints) {
  const warnings = [];
  if (!constraints) return warnings;
  if (constraints.max_mb && asset.size_bytes > constraints.max_mb * 1024 * 1024) {
    warnings.push(`file is ${(asset.size_bytes / 1048576).toFixed(0)}MB, limit ~${constraints.max_mb}MB`);
  }
  if (constraints.max_duration_s && asset.duration_sec > constraints.max_duration_s) {
    warnings.push(`duration ${Math.round(asset.duration_sec)}s exceeds ~${constraints.max_duration_s}s`);
  }
  if (asset.width && asset.height && constraints.ratio) {
    const isVertical = asset.height > asset.width;
    const wantsVertical = constraints.ratio.includes('9:16') || constraints.ratio.includes('3:4');
    const wantsHorizontal = constraints.ratio.startsWith('16:9');
    if (wantsVertical && !wantsHorizontal && !isVertical) {
      warnings.push(`video is horizontal; platform prefers ${constraints.ratio}`);
    }
    if (wantsHorizontal && !wantsVertical && isVertical && !constraints.ratio.includes('vertical')) {
      // bilibili/youtube accept vertical too; only warn softly
      warnings.push(`video is vertical; platform default is ${constraints.ratio}`);
    }
  }
  return warnings;
}
