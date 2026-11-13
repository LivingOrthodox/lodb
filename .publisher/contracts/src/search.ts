/** search-v1. Swift and Kotlin ports are checked against contracts/fixtures/behavior/search.json. */
export const SEARCH_ALGORITHM = "search-v1";

export interface SearchEntry {
  id: string;
  title: string;
  aliases: string[];
  keywords: string[];
  summary: string;
}

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ς/gu, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const words = (value: string) => normalizeForSearch(value).split(" ").filter(Boolean);

function score(entry: SearchEntry, query: string, queryWords: string[]): number {
  const title = normalizeForSearch(entry.title);
  const aliases = entry.aliases.map(normalizeForSearch);
  if (title === query) return 4;
  if (aliases.includes(query)) return 3;
  if (title.startsWith(query) || aliases.some((a) => a.startsWith(query))) return 2;
  const terms = [entry.title, ...entry.aliases, ...entry.keywords, entry.summary].flatMap(words);
  return queryWords.every((w) => terms.some((t) => t.startsWith(w))) ? 1 : 0;
}

/** Matching entry ids, best first; ties by id. */
export function search(entries: SearchEntry[], rawQuery: string): string[] {
  const query = normalizeForSearch(rawQuery);
  if (!query) return [];
  const queryWords = query.split(" ");
  return entries
    .map((entry) => ({ id: entry.id, score: score(entry, query, queryWords) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => r.id);
}
