import { describe, expect, it } from 'vitest';
import type { ConvertedRelationship } from '../../../engine/convertSystemToModule';
import { convertedRelationshipSentence } from './convertToModuleEffectSentences';

function rel(overrides: Partial<ConvertedRelationship>): ConvertedRelationship {
  return { relationshipId: 'r1', relationshipType: 'uses', otherElementId: 'e1', side: 'from', ...overrides };
}

describe('convertedRelationshipSentence', () => {
  it('reads "will still {verb}" for the outbound (from) side', () => {
    expect(convertedRelationshipSentence(rel({ relationshipType: 'uses', side: 'from' }), 'SAP ERP')).toBe('The new module will still use SAP ERP.');
  });

  it('reads "will still be {verb-ed} by" for the inbound (to) side', () => {
    expect(convertedRelationshipSentence(rel({ relationshipType: 'uses', side: 'to' }), 'CRM')).toBe('The new module will still be used by CRM.');
  });

  it('covers every relationship type on both sides', () => {
    expect(convertedRelationshipSentence(rel({ relationshipType: 'supports', side: 'from' }), 'Asset Maintenance')).toBe('The new module will still support Asset Maintenance.');
    expect(convertedRelationshipSentence(rel({ relationshipType: 'owns', side: 'to' }), 'Jane Doe')).toBe('The new module will still be owned by Jane Doe.');
    expect(convertedRelationshipSentence(rel({ relationshipType: 'flows_to', side: 'from' }), 'Data Warehouse')).toBe('The new module will still flow to Data Warehouse.');
    expect(convertedRelationshipSentence(rel({ relationshipType: 'flows_to', side: 'to' }), 'Order System')).toBe('The new module will still receive from Order System.');
  });
});
