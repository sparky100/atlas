import { describe, expect, it } from 'vitest';
import type { ElementsHeadRow } from '../../contracts/rows';
import { validateAttributeValue } from '../../contracts/attributeSchema';
import { dispositionLabel, dispositionOf, isOutgoingDisposition, worstDisposition } from './disposition';

function row(type: 'system' | 'container', attributes: Record<string, unknown>): ElementsHeadRow {
  return { element_id: 'e', element_type: type, name: 'E', parent_id: null, attributes: attributes as ElementsHeadRow['attributes'], exists_delta_id: 'd' };
}

describe('disposition attribute (F11)', () => {
  it('is a valid enum on systems and containers, and rejected on other types', () => {
    for (const value of ['tolerate', 'invest', 'migrate', 'eliminate']) {
      expect(validateAttributeValue('system', 'disposition', value).ok).toBe(true);
      expect(validateAttributeValue('container', 'disposition', value).ok).toBe(true);
    }
    expect(validateAttributeValue('system', 'disposition', 'retain').ok).toBe(false);
    expect(validateAttributeValue('capability', 'disposition', 'invest').ok).toBe(false);
    expect(validateAttributeValue('actor', 'disposition', 'invest').ok).toBe(false);
  });

  it('reads only the element\'s own value — unset or unknown is null, shown as "Not assessed"', () => {
    expect(dispositionOf(row('system', { disposition: 'migrate' }))).toBe('migrate');
    expect(dispositionOf(row('container', {}))).toBeNull();
    expect(dispositionOf(row('system', { disposition: 'keep' }))).toBeNull();
    expect(dispositionLabel(null)).toBe('Not assessed');
    expect(dispositionLabel('eliminate')).toBe('Eliminate');
  });

  it('worst-of is eliminate > migrate > tolerate > invest, skipping unset', () => {
    expect(worstDisposition(['invest', 'tolerate', null])).toBe('tolerate');
    expect(worstDisposition(['migrate', 'eliminate', 'invest'])).toBe('eliminate');
    expect(worstDisposition([null, null])).toBeNull();
    expect(worstDisposition([])).toBeNull();
  });

  it('migrate and eliminate are outgoing; tolerate, invest and unset are not', () => {
    expect(isOutgoingDisposition('migrate')).toBe(true);
    expect(isOutgoingDisposition('eliminate')).toBe(true);
    expect(isOutgoingDisposition('tolerate')).toBe(false);
    expect(isOutgoingDisposition(null)).toBe(false);
  });
});
