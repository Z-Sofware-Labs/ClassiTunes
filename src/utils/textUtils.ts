/**
 * String normalization utilities for search and filtering.
 * Decomposes unicode characters (such as macrons, tildes, accents, umlauts)
 * and strips diacritical marks so that queries with or without diacritics
 * match regardless of accent/macron usage (e.g. "Tokyo" matches "Tōkyō",
 * "sao" matches "são", "cafe" matches "café").
 */
export function normalizeSearchText(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
