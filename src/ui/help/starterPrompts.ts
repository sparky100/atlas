/** Static default starter prompts shown before the first message — mirrors Des-Studio's own `SUGGESTED_QUESTIONS` idea, simplified: Atlas has no per-tab editor granularity to key off, so this is one general-purpose set drawn from `docs/USER-GUIDE.md`'s own sections. */
export const DEFAULT_STARTER_PROMPTS: readonly string[] = [
  "What's the difference between a Capability, System, and Container?",
  'How do I import my systems, and is there a blank spreadsheet to start from?',
  'How do I make a change and get it into the live model?',
  'What are Versions, and how do I create one?',
  'How do I record that a system is an AI agent or uses AI?',
  "What's the difference between uses and flows to?",
  'How do I see what the landscape will look like in two years?',
  'What does "4 of 6 recorded" mean on a system?',
  'How do I add a principle and use it on a decision?',
];
