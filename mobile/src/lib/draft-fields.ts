import type { StagedAttachment } from './uploads';
export const draftFormatError = () => new Error('Your saved draft could not be read safely. Its saved copy has been kept. Try restoring it again.');
export function draftRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw draftFormatError();
  return value as Record<string, unknown>;
}
export function draftString(row: Record<string, unknown>, key: string, fallback = '', maximum = 20000): string {
  const value = row[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > maximum) throw draftFormatError();
  return value;
}
export function draftIdentifier(row: Record<string, unknown>, key: string): string | undefined {
  const value = draftString(row, key, '', 36);
  if (!value) return undefined;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw draftFormatError();
  return value;
}
export function draftRows<T>(row: Record<string, unknown>, key: string, maximum: number, parse: (value: unknown) => T): T[] {
  const value = row[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) throw draftFormatError();
  return value.map(parse);
}
export function draftAttachment(value: unknown): StagedAttachment | undefined {
  if (value === undefined || value === null) return undefined;
  const row = draftRecord(value), name = draftString(row, 'name', '', 255), type = draftString(row, 'type', '', 100);
  if (!name || !type) throw draftFormatError();
  const uri = draftString(row, 'uri', '', 4096), sourceText = draftString(row, 'sourceText', '', 200000), mediaId = draftIdentifier(row, 'mediaId');
  if (row.size !== undefined && (typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 0)) throw draftFormatError();
  return { name, type, ...(uri ? { uri } : {}), ...(sourceText ? { sourceText } : {}), ...(mediaId ? { mediaId } : {}), ...(typeof row.size === 'number' ? { size: row.size } : {}) };
}
