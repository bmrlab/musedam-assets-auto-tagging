/** 版本变化时替换树对象，使按对象缓存的候选索引同时失效；TTL 保留为旧写入路径的兜底。 */
export function createVersionedTagTreeCache<T>(
  load: (teamId: number) => Promise<T>,
  versionOf: (teamId: number) => Promise<string>,
  ttlMs = 30_000,
) {
  const entries = new Map<number, { version: string; promise: Promise<T>; expiresAt: number }>();
  return async (teamId: number): Promise<T> => {
    const version = await versionOf(teamId);
    const cached = entries.get(teamId);
    if (cached?.version === version && cached.expiresAt > Date.now()) return cached.promise;
    const promise = load(teamId)
      .then((tree) => {
        const entry = entries.get(teamId);
        if (entry?.promise === promise) entry.expiresAt = Date.now() + ttlMs;
        return tree;
      })
      .catch((error) => {
        if (entries.get(teamId)?.promise === promise) entries.delete(teamId);
        throw error;
      });
    entries.set(teamId, { version, promise, expiresAt: Number.POSITIVE_INFINITY });
    return promise;
  };
}
