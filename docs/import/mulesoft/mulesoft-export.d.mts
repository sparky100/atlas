export const EXPORT_FORMAT: 'atlas-mulesoft-export';
export const EXPORT_VERSION: 1;
export const API_FIELDS: readonly string[];
export const CONTRACT_FIELDS: readonly string[];
export function parseCliJson(text: string, what: string): unknown;
export function sanitiseApi(api: Record<string, unknown>): Record<string, unknown>;
export function sanitiseContract(contract: Record<string, unknown>): Record<string, unknown>;
export function parseArgs(argv: readonly string[]): { envs: string[]; out: string };
export interface MulesoftExportEnvironment {
  name: string;
  apis: Record<string, unknown>[];
  contracts: Record<string, Record<string, unknown>[]>;
}
export interface MulesoftExport {
  format: 'atlas-mulesoft-export';
  version: 1;
  exportedAt: string;
  organizationId: string | null;
  environments: MulesoftExportEnvironment[];
  warnings: string[];
}
export function exportEnvironments(options: { envs: readonly string[]; run: (args: string[], environmentName: string) => Promise<string>; now: string }): Promise<MulesoftExport>;
