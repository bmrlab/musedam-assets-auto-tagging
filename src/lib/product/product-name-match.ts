function normalize(value: string) {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      // Cosmetic spacing around Chinese names/model numbers is not identity evidence.
      .replace(/(?<=[\p{Script=Han}])\s+(?=[\p{Script=Han}0-9#])/gu, "")
      .replace(/(?<=[0-9#])\s+(?=[\p{Script=Han}])/gu, "")
  );
}

/** Match complete library names, keeping boundaries for Latin SKU/model names. */
export function matchProductsByAssetName<T extends { id: string; name: string }>(
  assetName: string,
  products: T[],
): T[] {
  // A file extension must not become product evidence (e.g. a product named JPG).
  const text = normalize(assetName).replace(
    /\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|svg|psd|ai|pdf|mp4|mov|webm)$/i,
    "",
  );
  const names = new Map<string, T[]>();
  for (const product of products) {
    const name = normalize(product.name);
    if (name.length < 2) continue;
    names.set(name, [...(names.get(name) ?? []), product]);
  }
  const candidates = [...names].flatMap(([name, entries]) => {
    // Duplicate names cannot identify a specific library product.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = /^[a-z0-9]/.test(name) ? "(?<![a-z0-9])" : "";
    const after = /[a-z0-9]$/.test(name) ? "(?![a-z0-9])" : "";
    const pattern = new RegExp(`${before}${escaped}${after}`, "g");
    return [...text.matchAll(pattern)].map((match) => ({
      entries,
      start: match.index,
      end: match.index + name.length,
    }));
  });
  // A longer name owns its span: “精华” must not also match “双萃精华”.
  const accepted = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.start <= candidate.start &&
          other.end >= candidate.end &&
          other.end - other.start > candidate.end - candidate.start,
      ),
  );
  return [
    ...new Map(
      accepted
        .filter(({ entries }) => entries.length === 1)
        .map(({ entries: [product] }) => [product.id, product]),
    ).values(),
  ];
}
