import prisma from "@/prisma/prisma";
import { randomUUID } from "node:crypto";
import "server-only";
import type { TagNode } from "./types";

export async function wrapTagChangeWithAncestors(
  node: TagNode,
  parentId: number | null,
  teamId: number,
) {
  let change = node;
  const visited = new Set(node.id ? [node.id] : []);
  while (parentId !== null) {
    if (visited.has(parentId)) throw new Error("标签层级异常，请刷新后重试");
    visited.add(parentId);
    const parent = await prisma.assetTag.findFirst({
      where: { deletedAt: null, id: parentId, teamId },
    });
    if (!parent) throw new Error("父标签不存在或已被删除，请刷新后重试");
    if (!parent.slug) throw new Error("父标签尚未同步到主站，请先从主站同步标签");
    change = { id: parent.id, slug: parent.slug, name: parent.name, children: [change] };
    parentId = parent.parentId;
  }
  return [change];
}

/** 在发往主站前校验真实归属和路径，避免远端成功后才发现本地不能保存。 */
export async function validateTagChanges(
  nodes: TagNode[],
  teamId: number,
  parentId: number | null = null,
  newParent = false,
): Promise<TagNode[]> {
  const result: TagNode[] = [];
  const names = new Set<string>();
  for (const node of nodes) {
    if (
      (node.verb === "create" && node.id !== undefined) ||
      (!node.id && node.verb !== "create") ||
      (node.id !== undefined && (!Number.isSafeInteger(node.id) || node.id <= 0))
    )
      throw new Error("标签参数无效，请刷新后重试");
    const name = node.name.trim();
    if (!name || name.length > 100) throw new Error("标签名不能为空且不能超过100个字符");
    if (names.has(name)) throw new Error(`标签名 "${name}" 在同级中已存在`);
    names.add(name);
    const current = node.id
      ? await prisma.assetTag.findFirst({ where: { deletedAt: null, id: node.id, teamId } })
      : null;
    if (node.id && (newParent || !current || current.parentId !== parentId))
      throw new Error("标签不存在或层级已变化，请刷新后重试");
    if (current && !current.slug) throw new Error("标签尚未同步到主站，请先从主站同步标签");
    if (!newParent && (node.verb === "create" || node.verb === "update")) {
      const duplicate = await prisma.assetTag.findFirst({
        where: {
          deletedAt: null,
          teamId,
          parentId,
          name,
          ...(node.id ? { id: { not: node.id } } : {}),
        },
      });
      if (duplicate) throw new Error(`标签名 "${name}" 在同级中已存在`);
    }
    result.push({
      ...node,
      slug: current?.slug ?? node.slug,
      ...(node.verb === "create" ? { tempId: node.tempId ?? randomUUID() } : {}),
      name: node.verb ? name : (current?.name ?? name),
      children:
        node.verb === "delete"
          ? []
          : await validateTagChanges(node.children, teamId, node.id ?? null, !node.id),
    });
  }
  return result;
}
