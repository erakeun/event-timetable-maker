/** Shared by direct entry and file import; does not rewrite existing backups. */
export function normalizeTags(value: unknown): string[] {
  return [...new Set(String(value ?? '').split(/[,;|\r\n]+/).map(tag => tag.trim()).filter(Boolean))];
}
