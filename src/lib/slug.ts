export function idToSlug(type: "team" | "user" | "assetObject", id: string) {
  switch (type) {
    case "team":
      return `t/${id}`;
    case "user":
      return `u/${id}`;
    case "assetObject":
      return `a/${id}`;
  }
}

export function slugToId(slug: string): { type: "team" | "user" | "assetObject"; id: string } {
  const [type, id] = slug.split("/");
  switch (type) {
    case "t":
      return { type: "team", id };
    case "u":
      return { type: "user", id };
    case "a":
      return { type: "assetObject", id };
    default:
      throw new Error(`Invalid slug type: ${type}`);
  }
}
