import { describe, expect, it } from 'vitest';

import { OpenAI2GeminiConverter } from '@/common/api/OpenAI2GeminiConverter';

describe('OpenAI2GeminiConverter', () => {
  it('maps bounded JSON generation controls for background structured tasks', () => {
    const converter = new OpenAI2GeminiConverter();

    const request = converter.convertRequest({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      max_tokens: 2_000,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });

    expect(request.generationConfig).toEqual({
      maxOutputTokens: 2_000,
      temperature: 0.1,
      responseMimeType: 'application/json',
    });
  });

  it('requests image and text modalities for image generation prompts', () => {
    const converter = new OpenAI2GeminiConverter();

    const request = converter.convertRequest({
      model: 'gemini-3-pro-image-preview',
      messages: [{ role: 'user', content: 'Generate image: a glass cup' }],
    });

    expect(request.generationConfig?.responseModalities).toEqual(['IMAGE', 'TEXT']);
  });

  it('converts Gemini inline image data to OpenAI-compatible message images', () => {
    const converter = new OpenAI2GeminiConverter();

    const response = converter.convertResponse(
      {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                { text: 'done' },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'ZmFrZS1pbWFnZQ==',
                  },
                },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 1,
          candidatesTokenCount: 2,
          totalTokenCount: 3,
        },
      },
      'gemini-3-pro-image-preview'
    );

    expect(response.choices[0].message.images).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,ZmFrZS1pbWFnZQ==' },
      },
    ]);
  });
});
