// Substitute {title} and {description} placeholders with the piece's master fields.
export function applyTemplate(template, piece) {
  return template
    .replaceAll('{title}', piece.title || '')
    .replaceAll('{description}', piece.master_description || '');
}

// Compute a variant's title/caption from the master content, shaped by the
// platform's optional templates. Blank/missing template = plain copy.
export function fillFromMaster(piece, template) {
  const titleTemplate = template?.title_template?.trim();
  const captionTemplate = template?.caption_template?.trim();
  return {
    title: titleTemplate ? applyTemplate(titleTemplate, piece) : piece.title || '',
    caption: captionTemplate ? applyTemplate(captionTemplate, piece) : piece.master_description || '',
  };
}
