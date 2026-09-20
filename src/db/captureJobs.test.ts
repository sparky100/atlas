import { describe, expect, it } from 'vitest';
import { captureInputObjectPath, computeInputSha256Hex } from './captureJobs';

describe('computeInputSha256Hex', () => {
  it('matches the standard SHA-256 test vectors (FIPS 180-4)', () => {
    expect(computeInputSha256Hex(new TextEncoder().encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(computeInputSha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is deterministic (CLAUDE.md rule 6) — same bytes, same hash, every time', () => {
    const bytes = new TextEncoder().encode('a capture input document');
    expect(computeInputSha256Hex(bytes)).toBe(computeInputSha256Hex(bytes));
  });
});

describe('captureInputObjectPath', () => {
  it('§3.4: {org_id}/{model_id}/{job_id}/{filename} — no bucket prefix (that\'s input_ref\'s own concern, not the object path)', () => {
    expect(captureInputObjectPath('org-1', 'model-1', 'job-1', 'Applications.xlsx')).toBe('org-1/model-1/job-1/Applications.xlsx');
  });
});
