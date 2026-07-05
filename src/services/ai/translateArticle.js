import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../../db/index.js';
import { config } from '../../config.js';
import { TRANSLATE_SYSTEM_PROMPT, buildTranslatePrompt } from './prompts.js';
import { getApiKey } from './generateVariants.js';

// One Claude call translates the saved original article text into Chinese.
// Plain-text output (no JSON schema): long CJK bodies survive better without
// JSON escaping, and a truncation is detectable via stop_reason instead of
// failing as unparseable JSON.
export async function translateArticle({ piece, glossary }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Add one on the Settings page.');
  }

  const client = new Anthropic({ apiKey });
  const model = getSetting('model') || config.defaultModel;

  const response = await client.messages.create({
    model,
    max_tokens: 16384,
    system: TRANSLATE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildTranslatePrompt(piece, glossary) }],
    output_config: { effort: 'medium' },
  });

  if (response.stop_reason === 'max_tokens') {
    throw new Error('The article is too long to translate in one go — split it and translate in two halves.');
  }
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text?.trim()) {
    throw new Error(`AI returned no text (stop_reason: ${response.stop_reason})`);
  }
  return text.trim();
}
