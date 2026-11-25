import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, selectContentFiles } from './reviewCatalogue';

const root = path.resolve('catalogue-root');
const electricity1 = path.join(root, 'electricity_network', '1.json');
const electricity2 = path.join(root, 'electricity_network', '2.json');
const any1 = path.join(root, 'any_organisation', '1.json');
const files = [electricity1, electricity2, any1];

describe('parseArgs', () => {
  it('reviews everything with no options', () => {
    expect(parseArgs([])).toEqual({});
  });
  it('reads a sector', () => {
    expect(parseArgs(['--sector', 'electricity_network'])).toEqual({ sector: 'electricity_network' });
  });
  it('reads a file', () => {
    expect(parseArgs(['--file', 'content/catalogue/electricity_network/2.json'])).toEqual({ file: 'content/catalogue/electricity_network/2.json' });
  });
  it('refuses both, unknown options, missing values and a path in --sector', () => {
    expect(() => parseArgs(['--sector', 'electricity_network', '--file', 'x.json'])).toThrow(/either --sector or --file/);
    expect(() => parseArgs(['--wat'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--sector'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--sector', 'a/b'])).toThrow(/sector folder name/);
  });
});

describe('selectContentFiles', () => {
  it('keeps every file by default', () => {
    expect(selectContentFiles(files, {}, root)).toEqual(files);
  });
  it('keeps one sector', () => {
    expect(selectContentFiles(files, { sector: 'electricity_network' }, root)).toEqual([electricity1, electricity2]);
  });
  it('keeps one absolute file', () => {
    expect(selectContentFiles(files, { file: electricity2 }, root)).toEqual([electricity2]);
  });
  it('accepts a path relative to the catalogue root', () => {
    expect(selectContentFiles(files, { file: 'electricity_network/2.json' }, root)).toEqual([electricity2]);
  });
  it('refuses a file outside the root or not JSON', () => {
    expect(() => selectContentFiles(files, { file: path.join(root, '..', 'outside.json') }, root)).toThrow(/under/);
    expect(() => selectContentFiles(files, { file: path.join(root, 'electricity_network', '2.txt') }, root)).toThrow(/under/);
  });
  it('returns nothing when the sector or file does not match', () => {
    expect(selectContentFiles(files, { sector: 'missing' }, root)).toEqual([]);
    expect(selectContentFiles(files, { file: path.join(root, 'electricity_network', '3.json') }, root)).toEqual([]);
  });
});
