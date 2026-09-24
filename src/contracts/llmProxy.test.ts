import { describe, expect, it } from 'vitest';
import { buildLlmProxyRequest, isValidLlmProxyRequest, LLM_PROXY_CONTRACT_VERSION } from './llmProxy';

describe('buildLlmProxyRequest', () => {
  it('produces something isValidLlmProxyRequest accepts — the round trip this contract test exists to check', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 'hello' }] });
    expect(isValidLlmProxyRequest(request)).toBe(true);
  });

  it('stamps the current contract version', () => {
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'hi' }] }).version).toBe(LLM_PROXY_CONTRACT_VERSION);
  });

  it('collapses "assistant-confirm" into "assistant", and anything else that is not "system" into "user"', () => {
    const request = buildLlmProxyRequest({
      messages: [
        { role: 'assistant-confirm', content: 'ok' },
        { role: 'weird', content: 'also ok' },
        { role: 'system', content: 'be concise' },
      ],
    });
    expect(request.messages).toEqual([
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'also ok' },
      { role: 'system', content: 'be concise' },
    ]);
  });

  it('drops a message whose content is blank or whitespace-only', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: '   ' }, { role: 'user', content: 'real' }] });
    expect(request.messages).toEqual([{ role: 'user', content: 'real' }]);
  });

  it('drops a message whose content is not a string at all, rather than stringifying it', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 42 }, { role: 'user', content: 'real' }] });
    expect(request.messages).toEqual([{ role: 'user', content: 'real' }]);
  });

  it('defaults maxTokens to 1024 and clamps to [1, 16000]', () => {
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }] }).maxTokens).toBe(1024);
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], maxTokens: 0 }).maxTokens).toBe(1);
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], maxTokens: -5 }).maxTokens).toBe(1);
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], maxTokens: 999999 }).maxTokens).toBe(16000);
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], maxTokens: 500.9 }).maxTokens).toBe(500);
  });

  it('defaults responseFormat to text, and only "json" switches it', () => {
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }] }).responseFormat).toBe('text');
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], responseFormat: 'json' }).responseFormat).toBe('json');
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], responseFormat: 'nonsense' as never }).responseFormat).toBe('text');
  });
});

describe('buildLlmProxyRequest — F2 (full K1) additions', () => {
  const outputConfig = { effort: 'high' as const, format: { type: 'json_schema' as const, schema: { type: 'object' } } };

  it('omits outputConfig/cacheControl/stream when not given, leaving every pre-existing caller unaffected', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }] });
    expect(request).not.toHaveProperty('outputConfig');
    expect(request).not.toHaveProperty('cacheControl');
    expect(request).not.toHaveProperty('stream');
  });

  it('carries outputConfig through unchanged when given', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], outputConfig });
    expect(request.outputConfig).toEqual(outputConfig);
  });

  it('sets cacheControl/stream only when explicitly true', () => {
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], cacheControl: true }).cacheControl).toBe(true);
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], cacheControl: false })).not.toHaveProperty('cacheControl');
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], stream: true }).stream).toBe(true);
  });

  it('produces something isValidLlmProxyRequest still accepts with every additive field set', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], outputConfig, cacheControl: true, stream: true });
    expect(isValidLlmProxyRequest(request)).toBe(true);
  });
});

describe('buildLlmProxyRequest — streamToClient (in-app help passthrough)', () => {
  it('omits streamToClient when not given', () => {
    expect(buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }] })).not.toHaveProperty('streamToClient');
  });

  it('forces stream: true when streamToClient is set, even if stream was left unset', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], streamToClient: true });
    expect(request.stream).toBe(true);
    expect(request.streamToClient).toBe(true);
  });

  it('produces something isValidLlmProxyRequest accepts', () => {
    const request = buildLlmProxyRequest({ messages: [{ role: 'user', content: 'x' }], streamToClient: true });
    expect(isValidLlmProxyRequest(request)).toBe(true);
  });
});

describe('isValidLlmProxyRequest — streamToClient cross-field rule', () => {
  const base = { version: LLM_PROXY_CONTRACT_VERSION, messages: [{ role: 'user' as const, content: 'x' }], maxTokens: 100, responseFormat: 'text' as const };

  it('rejects streamToClient: true without stream: true', () => {
    expect(isValidLlmProxyRequest({ ...base, streamToClient: true })).toBe(false);
    expect(isValidLlmProxyRequest({ ...base, stream: false, streamToClient: true })).toBe(false);
  });

  it('rejects streamToClient: true with responseFormat: json', () => {
    expect(isValidLlmProxyRequest({ ...base, stream: true, responseFormat: 'json', streamToClient: true })).toBe(false);
  });

  it('rejects streamToClient: true alongside an outputConfig', () => {
    const outputConfig = { effort: 'high' as const, format: { type: 'json_schema' as const, schema: { type: 'object' } } };
    expect(isValidLlmProxyRequest({ ...base, stream: true, outputConfig, streamToClient: true })).toBe(false);
  });

  it('accepts streamToClient: true with stream: true and responseFormat: text', () => {
    expect(isValidLlmProxyRequest({ ...base, stream: true, streamToClient: true })).toBe(true);
  });

  it('rejects a non-boolean streamToClient', () => {
    expect(isValidLlmProxyRequest({ ...base, stream: true, streamToClient: 'yes' })).toBe(false);
  });
});

describe('isValidLlmProxyRequest', () => {
  it('rejects a request with zero messages', () => {
    expect(isValidLlmProxyRequest({ version: LLM_PROXY_CONTRACT_VERSION, messages: [], maxTokens: 100, responseFormat: 'text' })).toBe(false);
  });

  it('rejects a message with an unrecognised role', () => {
    expect(isValidLlmProxyRequest({ version: LLM_PROXY_CONTRACT_VERSION, messages: [{ role: 'narrator', content: 'x' }], maxTokens: 100, responseFormat: 'text' })).toBe(false);
  });

  it('rejects maxTokens outside [1, 16000]', () => {
    const base = { version: LLM_PROXY_CONTRACT_VERSION, messages: [{ role: 'user', content: 'x' }], responseFormat: 'text' as const };
    expect(isValidLlmProxyRequest({ ...base, maxTokens: 0 })).toBe(false);
    expect(isValidLlmProxyRequest({ ...base, maxTokens: 16001 })).toBe(false);
  });

  it('rejects an invalid responseFormat', () => {
    expect(isValidLlmProxyRequest({ version: LLM_PROXY_CONTRACT_VERSION, messages: [{ role: 'user', content: 'x' }], maxTokens: 100, responseFormat: 'xml' })).toBe(false);
  });

  it('rejects a bare non-object value', () => {
    expect(isValidLlmProxyRequest(null)).toBe(false);
    expect(isValidLlmProxyRequest('not a request')).toBe(false);
  });
});
