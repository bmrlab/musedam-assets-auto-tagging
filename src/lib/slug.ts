import { MuseDAMID } from "@/musedam/types";

/**
 * 将 MuseDAM 的资源 id 转换为 slug
 */
export function idToSlug(
  type: "team" | "user" | "assetFolder" | "assetObject" | "assetTag",
  id: MuseDAMID,
) {
  switch (type) {
    case "team":
      return `t/${id}`;
    case "user":
      return `u/${id}`;
    case "assetFolder":
      return `f/${id}`;
    case "assetObject":
      return `a/${id}`;
    case "assetTag":
      return `g/${id}`;
  }
}

/**
 * 返回 MuseDAM 的资源 id，类型是 string
 */
export function slugToId(
  type: "team" | "user" | "assetFolder" | "assetObject" | "assetTag",
  slug: string,
): MuseDAMID {
  const match = slug.match(/^([a-z])\/(\d+)$/);
  if (!match) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  const [, t, id] = match;
  const typeMap = { team: "t", user: "u", assetFolder: "f", assetObject: "a", assetTag: "g" };
  if (t !== typeMap[type]) {
    throw new Error(`Type mismatch: expected ${typeMap[type]}, got ${t}`);
  }
  return new MuseDAMID(id);
}
