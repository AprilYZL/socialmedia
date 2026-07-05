// Copy-post-text buttons
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy || '');
    const old = btn.textContent;
    btn.textContent = '✅ Copied';
    setTimeout(() => (btn.textContent = old), 1500);
  } catch {
    btn.textContent = '❌ Copy failed';
  }
});

// Hashtag chips: click to append a group's tags to the card's hashtags input, deduped
document.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip[data-tags]');
  if (!chip) return;
  const form = chip.closest('form');
  const input = form?.querySelector('input[name="hashtags"]');
  if (!input) return;
  let tags;
  try {
    tags = JSON.parse(chip.dataset.tags);
  } catch {
    return;
  }
  const current = input.value.split(/[\s,，#]+/).filter(Boolean);
  const seen = new Set(current);
  for (const t of tags) {
    if (!seen.has(t)) {
      current.push(t);
      seen.add(t);
    }
  }
  input.value = current.join(' ');
  input.dispatchEvent(new Event('input'));
});

// Title length counter against platform limits
document.querySelectorAll('input[data-limit]').forEach((input) => {
  const limit = parseInt(input.dataset.limit, 10);
  const hint = document.createElement('span');
  hint.className = 'small';
  input.after(hint);
  const update = () => {
    const n = input.value.length;
    hint.textContent = `${n}/${limit}`;
    hint.style.color = n > limit ? 'var(--err)' : 'var(--muted)';
  };
  input.addEventListener('input', update);
  update();
});

// Poll staging status while an upload is being staged
const stagingEls = document.querySelectorAll('.staging-status[data-variant-id]');
if (stagingEls.length) {
  setInterval(async () => {
    for (const el of stagingEls) {
      try {
        const res = await fetch(`/variant/${el.dataset.variantId}/staging-status`);
        const data = await res.json();
        if (data.staging) {
          el.innerHTML = `<span class="staging-${data.staging.state}">${data.staging.message}</span>`;
        }
      } catch {
        /* server briefly unavailable — keep last message */
      }
    }
  }, 2500);
}
