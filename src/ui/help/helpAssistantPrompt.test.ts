import { describe, expect, it } from 'vitest';
import { buildHelpAssistantSystemPrompt, buildHelpUserMessage } from './helpAssistantPrompt';

describe('buildHelpAssistantSystemPrompt', () => {
  it('embeds the user guide content wholesale', () => {
    const prompt = buildHelpAssistantSystemPrompt();
    expect(prompt).toContain('Capability map');
    expect(prompt).toContain('=== KNOWLEDGE BASE ===');
    expect(prompt).toContain('=== END OF KNOWLEDGE BASE ===');
  });

  it('instructs the model never to invent features or claim to see model data', () => {
    const prompt = buildHelpAssistantSystemPrompt();
    expect(prompt).toMatch(/never invent/i);
    expect(prompt).toMatch(/never claim to (know|see)/i);
  });
});

describe('buildHelpUserMessage', () => {
  it('returns the bare question when no context is given', () => {
    expect(buildHelpUserMessage('How do I start a change?')).toBe('How do I start a change?');
  });

  it('appends the page name when given', () => {
    const message = buildHelpUserMessage('What does this show me?', { pageName: 'Capability map' });
    expect(message).toBe('What does this show me?\n\nContext:\nCurrent page: Capability map');
  });

  it('appends a model summary line without any element names/content', () => {
    const message = buildHelpUserMessage('How healthy is my model?', {
      modelSummary: { capabilityCount: 12, systemCount: 30, openChangeCount: 2 },
    });
    expect(message).toContain('Model: 12 capability(ies), 30 system(s), 2 open change(s).');
  });

  it('combines page name and model summary', () => {
    const message = buildHelpUserMessage('q', { pageName: 'Landscape', modelSummary: { capabilityCount: 1, systemCount: 2, openChangeCount: 0 } });
    expect(message).toBe('q\n\nContext:\nCurrent page: Landscape\nModel: 1 capability(ies), 2 system(s), 0 open change(s).');
  });
});
