export const RECENT_SEARCHES_KEY = "recent-searches";
const MAX_RECENT_SEARCHES = 5;

export function getRecentSearches(): string[] {
  if (typeof localStorage === "undefined") return [];
  const searches = localStorage.getItem(RECENT_SEARCHES_KEY);
  return searches ? JSON.parse(searches) : [];
}

export function addRecentSearch(query: string) {
  if (typeof localStorage === "undefined") return;
  const searches = getRecentSearches();
  const newSearches = [query, ...searches.filter((s) => s !== query)].slice(
    0,
    MAX_RECENT_SEARCHES
  );
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newSearches));
}

export function clearRecentSearches() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(RECENT_SEARCHES_KEY);
}
