import type { TagNode } from "./types";

/** merge-tags uses unchanged ancestors to locate a child; unrelated nodes are omitted. */
export function buildTagNameChange(nodes: TagNode[], targetId: string, name: string): TagNode[] {
  for (const node of nodes) {
    if ((node.id ? String(node.id) : node.tempId) === targetId) {
      return [
        {
          id: node.id,
          slug: node.slug,
          tempId: node.tempId,
          name,
          verb: node.id ? (node.originalName !== name ? "update" : undefined) : "create",
          children: [],
        },
      ];
    }

    const children = buildTagNameChange(node.children, targetId, name);
    if (children.length) {
      return [{ id: node.id, slug: node.slug, name: node.name, children }];
    }
  }
  return [];
}
