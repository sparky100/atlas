/**
 * Which element types count as "a system" for the person asking (Model rule
 * M2, CLAUDE.md). A module is a `container` inside a platform, and it is an
 * element in its own right: it can be supported, owned, retired, replaced,
 * rated and linked like a system. So code that looks for a system looks at
 * both. Code that really means only whole systems (for example an AI-agent
 * setting that exists only on a system) says so with a `system-only:` comment
 * next to the check.
 */
import type { ElementType } from './delta';

export const SYSTEM_LIKE_TYPES: readonly ElementType[] = ['system', 'container'];

/** True for a system or a module. */
export function isSystemLikeType(type: string): boolean {
  return SYSTEM_LIKE_TYPES.includes(type as ElementType);
}

/** True for a system or a module, from a head row or anything shaped like one. */
export function isSystemLike(element: { element_type: string }): boolean {
  return isSystemLikeType(element.element_type);
}
