// Platform registry. Constraint values are approximate platform rules used for
// pre-upload warnings only — verify against each platform's current docs.
const PLATFORMS = [
  {
    id: 'bilibili',
    display_name: 'Bilibili',
    upload_url: 'https://member.bilibili.com/platform/upload/video/frame',
    home_url: 'https://www.bilibili.com',
    constraints: { ratio: '16:9', max_mb: 8192, max_duration_s: null, title_limit: 80 },
    sort_order: 1,
  },
  {
    id: 'xiaohongshu',
    display_name: '小红书 Red Note',
    upload_url: 'https://creator.xiaohongshu.com/publish/publish',
    home_url: 'https://www.xiaohongshu.com',
    constraints: { ratio: '3:4 / 9:16', max_mb: 2048, max_duration_s: 900, title_limit: 20 },
    sort_order: 2,
  },
  {
    id: 'douyin',
    display_name: '抖音 Douyin',
    upload_url: 'https://creator.douyin.com/creator-micro/content/upload',
    home_url: 'https://www.douyin.com',
    constraints: { ratio: '9:16', max_mb: 4096, max_duration_s: 900, title_limit: 30 },
    sort_order: 3,
  },
  {
    id: 'instagram',
    display_name: 'Instagram',
    upload_url: 'https://www.instagram.com/',
    home_url: 'https://www.instagram.com/',
    constraints: { ratio: '9:16', max_mb: 4096, max_duration_s: 180, title_limit: null },
    sort_order: 4,
  },
  {
    id: 'tiktok',
    display_name: 'TikTok',
    upload_url: 'https://www.tiktok.com/tiktokstudio/upload',
    home_url: 'https://www.tiktok.com/',
    constraints: { ratio: '9:16', max_mb: 4096, max_duration_s: 600, title_limit: null },
    sort_order: 5,
  },
  {
    id: 'youtube',
    display_name: 'YouTube',
    upload_url: 'https://www.youtube.com/upload',
    home_url: 'https://www.youtube.com/',
    constraints: { ratio: '16:9 (Shorts 9:16)', max_mb: null, max_duration_s: null, title_limit: 100 },
    sort_order: 6,
  },
];

export function seed(db) {
  const insert = db.prepare(`
    INSERT INTO platforms (id, display_name, upload_url, home_url, constraints, enabled, sort_order)
    VALUES (@id, @display_name, @upload_url, @home_url, @constraints, 1, @sort_order)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      upload_url = excluded.upload_url,
      home_url = excluded.home_url,
      constraints = excluded.constraints,
      sort_order = excluded.sort_order
  `);
  for (const p of PLATFORMS) {
    insert.run({ ...p, constraints: JSON.stringify(p.constraints) });
  }

  // Starter hashtag groups so the chips UI isn't empty on first run
  const groupCount = db.prepare('SELECT COUNT(*) AS n FROM hashtag_groups').get().n;
  if (groupCount === 0) {
    const insertGroup = db.prepare(
      'INSERT INTO hashtag_groups (name, platform_id, tags, sort_order) VALUES (?, NULL, ?, ?)'
    );
    insertGroup.run('法式电音 zh', JSON.stringify(['法式电音', '电子音乐', '法国音乐', 'DJ']), 1);
    insertGroup.run('French touch en', JSON.stringify(['frenchtouch', 'frenchhouse', 'electronicmusic', 'edbanger']), 2);
  }
}
