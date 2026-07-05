CREATE TABLE IF NOT EXISTS platforms (
  id TEXT PRIMARY KEY,              -- 'bilibili' | 'xiaohongshu' | 'douyin' | 'instagram' | 'tiktok' | 'youtube'
  display_name TEXT NOT NULL,
  upload_url TEXT NOT NULL,
  home_url TEXT NOT NULL,
  constraints TEXT,                 -- JSON: {ratio, max_mb, max_duration_s, title_limit}
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS content_pieces (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL,       -- 'short_video' | 'long_video' | 'article' | 'poster'
  master_description TEXT,
  language TEXT DEFAULT 'zh',
  tags TEXT,                        -- JSON array, internal organization
  source_url TEXT,                  -- normalized origin URL for imported pieces; NULL if created manually
  created_at TEXT DEFAULT (datetime('now')),
  archived INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_pieces_source_url
  ON content_pieces(source_url) WHERE source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY,
  content_piece_id INTEGER NOT NULL REFERENCES content_pieces(id),
  file_path TEXT NOT NULL,
  kind TEXT NOT NULL,               -- 'video' | 'image'
  width INTEGER,
  height INTEGER,
  duration_sec REAL,
  size_bytes INTEGER,
  role TEXT DEFAULT 'primary'       -- 'primary' | 'cover' | 'extra_image'
);

CREATE TABLE IF NOT EXISTS platform_variants (
  id INTEGER PRIMARY KEY,
  content_piece_id INTEGER NOT NULL REFERENCES content_pieces(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  title TEXT,
  caption TEXT,
  hashtags TEXT,                    -- JSON array of strings without '#'
  language TEXT,                    -- 'zh' | 'en'
  sensitive_flags TEXT,             -- JSON: [{word, reason, source}]
  status TEXT NOT NULL DEFAULT 'draft',
  -- 'draft' -> 'ready' -> 'staged' -> 'posted' | 'failed' | 'skipped'
  live_url TEXT,
  posted_at TEXT,
  ai_generated INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (content_piece_id, platform_id)
);

CREATE TABLE IF NOT EXISTS schedule_slots (
  id INTEGER PRIMARY KEY,
  platform_variant_id INTEGER NOT NULL REFERENCES platform_variants(id),
  scheduled_date TEXT NOT NULL,     -- 'YYYY-MM-DD'
  scheduled_time TEXT,              -- optional 'HH:MM'
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS platform_templates (
  platform_id TEXT PRIMARY KEY REFERENCES platforms(id),
  title_template TEXT,              -- '{title}' / '{description}' placeholders; NULL/empty = plain copy
  caption_template TEXT
);

CREATE TABLE IF NOT EXISTS hashtag_groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  platform_id TEXT REFERENCES platforms(id),  -- non-NULL = that platform's default set; NULL = named group
  tags TEXT NOT NULL DEFAULT '[]',            -- JSON array of strings without '#'
  sort_order INTEGER DEFAULT 0
);
