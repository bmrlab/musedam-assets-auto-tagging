import { createVersionedTagTreeCache } from "@/lib/tagging/tag-tree-cache";
import { expect, it, vi } from "vitest";

it("reloads within TTL when a committed configuration version changes", async () => {
  let version = "1";
  const load = vi.fn(async () => ({ version }));
  const cache = createVersionedTagTreeCache(load, async () => version);
  const old = await cache(7);
  expect(await cache(7)).toBe(old);
  version = "2";
  expect(await cache(7)).not.toBe(old);
  expect(load).toHaveBeenCalledTimes(2);
});
it("shares a pending load and retries failures without caching them", async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ tags: [] });
  const cache = createVersionedTagTreeCache(load, async () => "0");
  await expect(cache(7)).rejects.toThrow("db down");
  const [a, b] = await Promise.all([cache(7), cache(7)]);
  expect(a).toBe(b);
  expect(load).toHaveBeenCalledTimes(2);
});
