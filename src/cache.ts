import { DatabaseSync } from 'node:sqlite';

type Cached<T> = { value: T; fetchedAt: number };

// Plain key-value table: every read is "whole value by key", so columns would buy nothing yet.
export function openDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, data TEXT NOT NULL)');
  return db;
}

// Younger than ttlMs: served from SQLite. Older: refetched or an error is returned.
// Concurrent requests for one key share a single upstream call.
export function createCache(db: DatabaseSync, now = Date.now) {
  const read = db.prepare('SELECT fetched_at, data FROM cache WHERE key = ?');
  const write = db.prepare('INSERT OR REPLACE INTO cache (key, fetched_at, data) VALUES (?, ?, ?)');
  const inflight = new Map<string, Promise<Cached<any>>>();

  return async <T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<Cached<T>> => {
    const row = read.get(key) as { fetched_at: number; data: string } | undefined;
    const cached = row && { value: JSON.parse(row.data), fetchedAt: row.fetched_at };
    if (cached && now() - cached.fetchedAt < ttlMs) return cached;

    if (!inflight.has(key)) {
      const fetching = loader().then((value) => {
        const fetchedAt = now();
        write.run(key, fetchedAt, JSON.stringify(value));
        return { value, fetchedAt };
      });
      inflight.set(
        key,
        fetching.finally(() => inflight.delete(key)),
      );
    }
    return inflight.get(key)!;
  };
}
