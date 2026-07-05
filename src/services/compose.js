// Compose the full post text for a variant: title, caption, hashtags.
// Used by the copy-to-clipboard button and the uploader fallback path.
export function composeText(variant) {
  const parts = [];
  if (variant.title) parts.push(variant.title);
  if (variant.caption) parts.push(variant.caption);
  const tags = parseHashtags(variant.hashtags);
  if (tags.length) parts.push(tags.map((t) => `#${t}`).join(' '));
  return parts.join('\n\n');
}

// Full publishable text for a translated article: the Chinese body plus a
// source-attribution line. Used by the article copy button.
export function composeArticleText(piece) {
  const parts = [];
  if (piece.master_description) parts.push(piece.master_description.trim());
  if (piece.source_url) parts.push(`——\n原文链接：${piece.source_url}`);
  return parts.join('\n\n');
}

export function parseHashtags(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // free-text input: split on whitespace/commas, strip leading '#'
    return value
      .split(/[\s,，#]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }
}
