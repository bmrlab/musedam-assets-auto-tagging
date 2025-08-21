/**
 * 将 MuseDAM 的资源 id 转换为 slug
 */
export function idToSlug(type: "team" | "user" | "assetObject" | "assetTag", id: string) {
  switch (type) {
    case "team":
      return `t/${id}`;
    case "user":
      return `u/${id}`;
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
  type: "team" | "user" | "assetObject" | "assetObject",
  slug: string,
): string {
  const [t, id] = slug.split("/");
  if (!t || !id) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  const typeMap = { team: "t", user: "u", assetObject: "a", assetTag: "g" };
  if (t !== typeMap[type]) {
    throw new Error(`Type mismatch: expected ${typeMap[type]}, got ${t}`);
  }
  return id;
}
