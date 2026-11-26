import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noBareSystemCheck } from '../../eslint-rules/noBareSystemCheck.js';

// Model rule M2: a bare check for the type 'system' needs isSystemLike() or a 'system-only:' reason.
const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

describe('atlas/no-bare-system-check', () => {
  it('flags a bare check and accepts justified or module-aware code', () => {
    // RuleTester registers its own describe/it through the globals vitest provides.
    tester.run('no-bare-system-check', noBareSystemCheck, {
      valid: [
        "const a = isSystemLike(row);",
        "const a = row.element_type === 'container';",
        "// system-only: AI autonomy is a setting of a whole system\nconst a = row.element_type === 'system';",
        "const a = row.element_type === 'system'; // system-only: whole systems only",
        "const a = row.name === 'system';",
      ],
      invalid: [
        { code: "const a = row.element_type === 'system';", errors: [{ messageId: 'bare' }] },
        { code: "const a = row.elementType !== 'system';", errors: [{ messageId: 'bare' }] },
        { code: "const a = rows.filter((e) => e.element_type === 'system');", errors: [{ messageId: 'bare' }] },
        { code: "// a comment that gives no reason\nconst a = row.element_type === 'system';", errors: [{ messageId: 'bare' }] },
      ],
    });
  });
});
