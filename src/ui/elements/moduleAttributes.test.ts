import { describe, expect, it } from 'vitest';
import { effectiveModuleAttributes } from './moduleAttributes';
import { attributesRecord } from './attributesRecord';
import type { ElementsHeadRow, Json } from '../../contracts/rows';

function element(id: string, type: ElementsHeadRow['element_type'], attributes: Record<string, Json> = {}, parentId: string | null = null): ElementsHeadRow {
  return { element_id: id, element_type: type, name: id, parent_id: parentId, attributes, exists_delta_id: `delta-${id}` };
}

describe('effectiveModuleAttributes ("platforms and modules")', () => {
  it("a module with no override reads the platform's own value for each inheritable field", () => {
    const platform = element('sap', 'system', { kind: 'platform', lifecycleStatus: 'active', criticality: 'high', hostingModel: 'saas', hostingProvider: 'SAP Cloud', domain: 'it' });
    const module = element('fi', 'container', {}, 'sap');
    const effective = effectiveModuleAttributes(module, platform);
    expect(attributesRecord(effective.attributes)).toMatchObject({ lifecycleStatus: 'active', criticality: 'high', hostingModel: 'saas', hostingProvider: 'SAP Cloud', domain: 'it' });
  });

  it("a module's own value wins over the platform's for every inheritable field", () => {
    const platform = element('sap', 'system', { kind: 'platform', criticality: 'high', domain: 'it' });
    const module = element('fi', 'container', { criticality: 'critical', domain: 'ot' }, 'sap');
    const effective = effectiveModuleAttributes(module, platform);
    expect(attributesRecord(effective.attributes)).toMatchObject({ criticality: 'critical', domain: 'ot' });
  });

  it("never leaks kind onto the module's own effective attributes — a module must never itself read as a platform", () => {
    const platform = element('sap', 'system', { kind: 'platform' });
    const module = element('fi', 'container', {}, 'sap');
    const effective = effectiveModuleAttributes(module, platform);
    expect(attributesRecord(effective.attributes).kind).toBeUndefined();
  });

  it("leaves every non-inheritable attribute (isExternal, description, technology) as the module's own, untouched", () => {
    const platform = element('sap', 'system', { kind: 'platform', isExternal: true, description: 'Platform description' });
    const module = element('fi', 'container', { isExternal: false, technology: 'ABAP' }, 'sap');
    const effective = effectiveModuleAttributes(module, platform);
    expect(attributesRecord(effective.attributes)).toMatchObject({ isExternal: false, technology: 'ABAP' });
    expect(attributesRecord(effective.attributes).description).toBeUndefined();
  });

  it("returns a new object — never mutates the module row it was given", () => {
    const platform = element('sap', 'system', { kind: 'platform', criticality: 'high' });
    const module = element('fi', 'container', {}, 'sap');
    effectiveModuleAttributes(module, platform);
    expect(module.attributes).toEqual({});
  });

  it('a platform value the module has no field for at all is simply not added', () => {
    const platform = element('sap', 'system', { kind: 'platform' });
    const module = element('fi', 'container', {}, 'sap');
    const effective = effectiveModuleAttributes(module, platform);
    expect(attributesRecord(effective.attributes).criticality).toBeUndefined();
  });
});
