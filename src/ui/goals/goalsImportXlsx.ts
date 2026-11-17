/**
 * The two places the goals import touches SheetJS: reading the first sheet of
 * an uploaded `.xlsx` / `.csv` as plain text cells, and writing the blank goals
 * sheet. The logic is in `goalsImport.ts` (pure).
 */
import * as XLSX from 'xlsx';
import { GOALS_SHEET_HEADINGS } from './goalsImport';

/** The "Goals" sheet if the workbook has one, otherwise its first sheet; every cell as text. */
export async function readGoalsSheet(file: File): Promise<string[][]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const name = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'goals') ?? wb.SheetNames[0];
  const sheet = name === undefined ? undefined : wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' }).map((row) => row.map((cell) => String(cell)));
}

const READ_ME = [
  ['Importing goals'],
  ['One goal per row on the "Goals" sheet. Only Title and What success looks like are needed.'],
  ['Capabilities: the names of the capabilities that serve the goal, separated by semicolons. Names must match a capability already in the model.'],
  ['Atlas shows what it will add before anything is saved. A title that already exists is skipped, never changed.'],
];

export function downloadGoalsTemplate(): void {
  const wb = XLSX.utils.book_new();
  const goals = XLSX.utils.aoa_to_sheet([[...GOALS_SHEET_HEADINGS]]);
  goals['!cols'] = [{ wch: 40 }, { wch: 60 }, { wch: 40 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, goals, 'Goals');
  const readMe = XLSX.utils.aoa_to_sheet(READ_ME);
  readMe['!cols'] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, readMe, 'Read me first');
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'atlas-goals-template.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
