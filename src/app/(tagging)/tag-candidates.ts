import "server-only";

import type { AssetTagExtra, TagWithChildren } from "@/prisma/client";
import { flattenTagsTree } from "./evidence-policy";

export const TAG_PROMPT_NODE_LIMIT = 1000;
export const TAG_PROMPT_CHAR_LIMIT = 60_000;
const indexCache = new WeakMap<TagWithChildren[], Map<boolean, ReturnType<typeof buildIndex>>>();

function terms(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const result = new Set(normalized.match(/[a-z0-9]+(?:[._-][a-z0-9]+)*/g) ?? []);
  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    if (run.length === 1) result.add(run);
    for (let i = 0; i < run.length - 1; i++) result.add(run.slice(i, i + 2));
  }
  return [...result].slice(0, 256);
}

function promptExtra(extra: unknown): AssetTagExtra {
  const value = (extra ?? {}) as AssetTagExtra;
  return {
    ...value,
    description: value.description?.slice(0, 240),
    keywords: value.keywords?.slice(0, 20).map((word) => word.slice(0, 64)),
    negativeKeywords: value.negativeKeywords?.slice(0, 20).map((word) => word.slice(0, 64)),
  };
}

function nodeCost(node: { name: string; extra: unknown }): number {
  const extra = promptExtra(node.extra);
  return (
    160 +
    node.name.length +
    (extra.description?.length ?? 0) +
    (extra.keywords?.join(", ").length ?? 0) +
    (extra.negativeKeywords?.join(", ").length ?? 0)
  );
}

function buildIndex(tree: TagWithChildren[], includeKeywords: boolean) {
  const nodes = flattenTagsTree(tree);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const postings = new Map<string, number[]>();
  for (const node of nodes) {
    const extra = (node.extra ?? {}) as AssetTagExtra;
    const document = [
      node.name,
      ...node.tagPath.slice(0, -1),
      extra.description?.slice(0, 500),
      ...(includeKeywords ? (extra.keywords ?? []) : []),
    ]
      .join(" ")
      .slice(0, 4000);
    for (const term of terms(document)) {
      const ids = postings.get(term) ?? [];
      ids.push(node.id);
      postings.set(term, ids);
    }
  }
  return { nodes, byId, postings };
}

export function needsTagCandidateSelection(tree: TagWithChildren[]): boolean {
  const nodes = flattenTagsTree(tree);
  return (
    nodes.length > TAG_PROMPT_NODE_LIMIT ||
    nodes.reduce((sum, node) => {
      const extra = (node.extra ?? {}) as AssetTagExtra;
      return (
        sum +
        160 +
        node.name.length +
        (extra.description?.length ?? 0) +
        (extra.keywords?.join(", ").length ?? 0) +
        (extra.negativeKeywords?.join(", ").length ?? 0)
      );
    }, 0) > TAG_PROMPT_CHAR_LIMIT
  );
}

/** Indexed lexical recall plus model-expanded semantic query; keeps ancestors and
 * enforces both node and character budgets, including when keywords are long. */
export function selectTagCandidates({
  tagsTree,
  eligibleTree = tagsTree,
  evidenceText,
  semanticTerms = [],
  includeKeywords = true,
}: {
  tagsTree: TagWithChildren[];
  eligibleTree?: TagWithChildren[];
  evidenceText: string;
  semanticTerms?: string[];
  includeKeywords?: boolean;
}) {
  let variants = indexCache.get(tagsTree);
  if (!variants) {
    variants = new Map();
    indexCache.set(tagsTree, variants);
  }
  let index = variants.get(includeKeywords);
  if (!index) {
    index = buildIndex(tagsTree, includeKeywords);
    variants.set(includeKeywords, index);
  }
  const eligible = new Set(flattenTagsTree(eligibleTree).map((node) => node.id));
  const scores = new Map<number, number>();
  const addTerms = (text: string, weight: number) => {
    for (const term of terms(text)) {
      const ids = index!.postings.get(term) ?? [];
      const idf = Math.log(1 + index!.nodes.length / (1 + ids.length));
      for (const id of ids)
        if (eligible.has(id)) scores.set(id, (scores.get(id) ?? 0) + weight * idf);
    }
  };
  addTerms(evidenceText.slice(0, 12000), 3);
  addTerms(semanticTerms.join(" ").slice(0, 4000), 1);
  const ranked = [...eligible].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || a - b);
  const selected = new Set<number>();
  let characters = 0;
  for (const id of ranked) {
    // No-evidence filler must not crowd out relevant candidates. A small,
    // balanced preview is retained when the retrieval itself finds nothing.
    if (!scores.has(id) && scores.size > 0) continue;
    const chain: number[] = [];
    let current: number | undefined = id;
    while (current !== undefined && !selected.has(current)) {
      chain.push(current);
      current = index.byId.get(current)?.parentId;
    }
    const cost = chain.reduce((sum, tagId) => sum + nodeCost(index!.byId.get(tagId)!), 0);
    if (
      selected.size + chain.length > TAG_PROMPT_NODE_LIMIT ||
      characters + cost > TAG_PROMPT_CHAR_LIMIT
    )
      continue;
    for (const tagId of chain) selected.add(tagId);
    characters += cost;
  }
  const copy = (tree: TagWithChildren[]): TagWithChildren[] =>
    tree
      .filter((node) => selected.has(node.id))
      .map((node) => ({
        ...node,
        extra: promptExtra(node.extra),
        children: copy(node.children ?? []),
      }));
  return {
    tagsTree: copy(eligibleTree),
    selectedIds: selected,
    total: eligible.size,
    selected: selected.size,
    estimatedCharacters: characters,
    matched: scores.size,
  };
}
