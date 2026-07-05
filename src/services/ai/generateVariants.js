import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../../db/index.js';
import { config } from '../../config.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import { VARIANTS_SCHEMA } from './schema.js';
import { checkSensitiveWords, mergeFlags } from './sensitiveWords.js';

const CN_PLATFORMS = new Set(['bilibili', 'xiaohongshu', 'douyin']);

export function getApiKey() {
  return getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || null;
}

// One Claude call drafts all requested platform variants from the master
// description. Returns [{platform, title, caption, hashtags, language, flags}].
export async function generateVariants({ piece, assets, platformIds }) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Add one on the Settings page.');
  }

  const client = new Anthropic({ apiKey });
  const model = getSetting('model') || config.defaultModel;

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(piece, assets, platformIds) }],
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: VARIANTS_SCHEMA },
    },
  });

  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) {
    throw new Error(`AI returned no text (stop_reason: ${response.stop_reason})`);
  }
  const { variants } = JSON.parse(text);

  return variants
    .filter((v) => platformIds.includes(v.platform))
    .map((v) => {
      const staticFlags = CN_PLATFORMS.has(v.platform)
        ? checkSensitiveWords(`${v.title}\n${v.caption}\n${(v.hashtags || []).join(' ')}`)
        : [];
      return {
        platform: v.platform,
        title: v.title,
        caption: v.caption,
        hashtags: v.hashtags || [],
        language: v.language,
        flags: mergeFlags(staticFlags, CN_PLATFORMS.has(v.platform) ? v.sensitive_words : []),
      };
    });
}
