/** Metadata recall proposes identities; it never establishes a product match. */
export type ProductMetadataEvidence = { source: "filename" | "path"; terms: string[] };
type CatalogProduct = {
  id: string;
  name: string;
  notes?: string;
  tags?: Array<{ tagPath: unknown }>;
};
const GENERIC = new Set([
  "系列",
  "产品",
  "商品",
  "素材",
  "图片",
  "测试",
  "文件",
  "文件夹",
  "护肤",
  "乳液",
  "套装",
  "成分",
  "质地",
  "美图",
  "model",
  "image",
  "photo",
  "jpg",
  "png",
  "ex",
]);
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

function termsIn(source: string, catalog: string): string[] {
  const hits = new Set<string>();
  for (const chunk of normalize(source)
    .replace(/系列|产品|素材|文件夹/g, " / ")
    .match(/[\p{Script=Han}]+|[a-z][a-z0-9]*/gu) ?? []) {
    if (/^[a-z]/.test(chunk)) {
      if (
        chunk.length >= 3 &&
        !GENERIC.has(chunk) &&
        new RegExp(`(?<![a-z0-9])${chunk}(?![a-z0-9])`).test(catalog)
      )
        hits.add(chunk);
      continue;
    }
    for (let size = Math.min(12, chunk.length); size >= 2; size--) {
      for (let start = 0; start + size <= chunk.length; start++) {
        const term = chunk.slice(start, start + size);
        if (!GENERIC.has(term) && catalog.includes(term)) hits.add(term);
      }
    }
  }
  return [...hits].filter(
    (term) => ![...hits].some((other) => other !== term && other.includes(term)),
  );
}

export function recallProductsByMetadata<T extends CatalogProduct>(
  products: T[],
  input: { fileName?: string; folderPath?: string },
  limit = 12,
): Array<{ product: T; evidence: ProductMetadataEvidence[] }> {
  const sources = [
    {
      source: "filename" as const,
      text: (input.fileName?.slice(0, 1000) ?? "").replace(
        /\.(?:jpe?g|png|gif|webp|avif|bmp|tiff?|heic|heif|svg|psd|ai|pdf|mp4|mov|webm)$/i,
        "",
      ),
    },
    { source: "path" as const, text: input.folderPath?.slice(0, 3000) ?? "" },
  ];
  const ranked = products
    .map((product) => {
      const catalog = normalize(
        [
          product.name,
          product.notes ?? "",
          ...(product.tags ?? []).flatMap((tag) =>
            Array.isArray(tag.tagPath) ? tag.tagPath.map(String) : [],
          ),
        ].join(" / "),
      );
      const evidence = sources
        .map(({ source, text }) => ({ source, terms: termsIn(text, catalog) }))
        .filter((hit) => hit.terms.length);
      // Distinctive series/product phrases outrank a shared brand alone. Repeated
      // filename/path words are one retrieval hint, not independent corroboration.
      const unique = new Set(evidence.flatMap((hit) => hit.terms));
      const score = [...unique].reduce((sum, term) => sum + term.length ** 2, 0);
      return { product, evidence, score };
    })
    .filter((hit) => hit.score > 0);
  // Do not expand a specific series/product hint into every product sharing only
  // its brand. Keep incomparable hints (including separate products in an asset)
  // and equally supported alternatives; vector-retrieved candidates are untouched.
  const terms = (hit: (typeof ranked)[number]) => new Set(hit.evidence.flatMap((e) => e.terms));
  return ranked
    .filter((hit) => {
      const own = terms(hit);
      return !ranked.some((other) => {
        if (other === hit) return false;
        const stronger = terms(other);
        const covered = (left: Set<string>, right: Set<string>) =>
          [...left].every((term) => [...right].some((phrase) => phrase.includes(term)));
        return covered(own, stronger) && !covered(stronger, own);
      });
    })
    .sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id))
    .slice(0, limit)
    .map(({ product, evidence }) => ({ product, evidence }));
}
