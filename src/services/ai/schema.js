export const PLATFORM_IDS = ['bilibili', 'xiaohongshu', 'douyin', 'instagram', 'tiktok', 'youtube'];

// JSON schema for structured output: one draft per requested platform.
export const VARIANTS_SCHEMA = {
  type: 'object',
  properties: {
    variants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: PLATFORM_IDS },
          title: { type: 'string' },
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          language: { type: 'string', enum: ['zh', 'en'] },
          sensitive_words: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                word: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['word', 'reason'],
              additionalProperties: false,
            },
          },
        },
        required: ['platform', 'title', 'caption', 'hashtags', 'language', 'sensitive_words'],
        additionalProperties: false,
      },
    },
  },
  required: ['variants'],
  additionalProperties: false,
};
