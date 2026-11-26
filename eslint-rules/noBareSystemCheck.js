// @ts-check
/**
 * Model rule M2 (CLAUDE.md): a module is an element in its own right, so code
 * that looks for "a system" must also look at modules. A comparison of an
 * element's type to the literal 'system' therefore has to either use
 * `isSystemLike` / `SYSTEM_LIKE_TYPES` (src/contracts/elementKinds.ts), or say
 * why only systems apply, in a comment on the same line or the line before:
 *
 *     // system-only: AI autonomy is a setting of a whole system
 *
 * Existing sites are recorded in eslint-suppressions.json (ESLint bulk
 * suppressions), so only new ones fail. Cleaning one up removes its entry.
 */

/** @type {Set<string>} */
const TYPE_PROPERTIES = new Set(['element_type', 'elementType']);

/** @param {any} node */
function isTypeAccess(node) {
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') return TYPE_PROPERTIES.has(String(node.property.name));
  if (node.type === 'ChainExpression') return isTypeAccess(node.expression);
  if (node.type === 'Identifier') return TYPE_PROPERTIES.has(String(node.name));
  return false;
}

/** @param {any} node */
function isSystemLiteral(node) {
  return node.type === 'Literal' && node.value === 'system';
}

/** @type {import('eslint').Rule.RuleModule} */
export const noBareSystemCheck = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      bare:
        "Model rule M2: a module is an element too. Use isSystemLike() / SYSTEM_LIKE_TYPES from src/contracts/elementKinds.ts, or add a comment on this line or the line above starting 'system-only:' that says why only systems apply.",
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      /** @param {any} node */
      BinaryExpression(node) {
        if (!['===', '!==', '==', '!='].includes(String(node.operator))) return;
        const sides = [node.left, node.right];
        if (!(sides.some(isTypeAccess) && sides.some(isSystemLiteral))) return;
        const line = node.loc.start.line;
        const justified = source.getAllComments().some((comment) => {
          if (!comment.value.includes('system-only:')) return false;
          const end = comment.loc?.end.line ?? -1;
          return end === line || end === line - 1;
        });
        if (!justified) context.report({ node, messageId: 'bare' });
      },
    };
  },
};

export default { rules: { 'no-bare-system-check': noBareSystemCheck } };
