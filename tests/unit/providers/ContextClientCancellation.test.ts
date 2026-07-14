import { AnthropicRotatingClient } from '@/common/api/AnthropicRotatingClient';
import { GeminiRotatingClient } from '@/common/api/GeminiRotatingClient';
import { AuthType } from '@office-ai/aioncli-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  geminiGenerateContent: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = { create: mocks.anthropicCreate };
  },
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class GoogleGenAIMock {
    models = { generateContent: mocks.geminiGenerateContent };
  },
}));

const completionParams = {
  model: 'model-1',
  messages: [{ role: 'user', content: 'Return JSON.' }],
  max_tokens: 2_000,
  temperature: 0.1,
  response_format: { type: 'json_object' as const },
};

describe('context provider request cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.anthropicCreate.mockResolvedValue({
      id: 'message-1',
      content: [{ type: 'text', text: '{}' }],
      model: 'claude-sonnet-4',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    mocks.geminiGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: '{}' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
    });
  });

  it('forwards the abort signal and deadline to Anthropic', async () => {
    const controller = new AbortController();
    const client = new AnthropicRotatingClient('key', { model: 'claude-sonnet-4' });

    await client.createChatCompletion(completionParams, { signal: controller.signal, timeout: 1_234 });

    expect(mocks.anthropicCreate).toHaveBeenCalledWith(expect.any(Object), {
      signal: controller.signal,
      timeout: 1_234,
    });
  });

  it('forwards the abort signal and deadline to Gemini', async () => {
    const controller = new AbortController();
    const client = new GeminiRotatingClient('key', { model: 'gemini-2.5-pro' }, { maxRetries: 1 }, AuthType.USE_GEMINI);

    await client.createChatCompletion(completionParams, { signal: controller.signal, timeout: 1_234 });

    expect(mocks.geminiGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          abortSignal: controller.signal,
          httpOptions: { timeout: 1_234 },
        }),
      })
    );
  });
});
