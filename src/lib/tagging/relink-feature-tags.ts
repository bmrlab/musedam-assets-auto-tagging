import "server-only";

import { Prisma } from "@/prisma/client";
import prisma from "@/prisma/prisma";

export type LibraryType = "product" | "brand" | "person" | "ip";
type Tag = { id: number; name: string; parentId: number | null };
type Link = { id: string; featureId: string; assetTagId: number | null; tagPath: unknown };

/** Exact component matching: separators inside tag names are not path separators. */
export function planFeatureTagRelinks(tags: Tag[], links: Link[]) {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const paths = new Map<string, number[]>();
  for (const tag of tags) {
    const path: string[] = [];
    const seen = new Set<number>();
    let node: Tag | undefined = tag;
    let valid = true;
    while (node) {
      if (seen.has(node.id)) {
        valid = false;
        break;
      }
      seen.add(node.id);
      path.unshift(node.name);
      if (node.parentId === null) break;
      node = byId.get(node.parentId);
      if (!node) valid = false;
    }
    if (valid) {
      const key = JSON.stringify(path);
      paths.set(key, [...(paths.get(key) ?? []), tag.id]);
    }
  }

  const occupied = new Set(
    links
      .filter((link) => link.assetTagId !== null)
      .map((link) => JSON.stringify([link.featureId, link.assetTagId])),
  );
  return links.map((link) => {
    const base = {
      linkId: link.id,
      featureId: link.featureId,
      tagPath: link.tagPath,
      oldTagId: link.assetTagId,
    };
    // An existing association is authoritative, even when its cached name/path is stale.
    if (link.assetTagId !== null && byId.has(link.assetTagId)) {
      return { ...base, status: "unchanged" as const, newTagId: link.assetTagId };
    }
    if (
      !Array.isArray(link.tagPath) ||
      link.tagPath.length === 0 ||
      !link.tagPath.every((part) => typeof part === "string" && part.length > 0)
    ) {
      return { ...base, status: "invalid_path" as const, newTagId: null };
    }
    const matches = paths.get(JSON.stringify(link.tagPath)) ?? [];
    if (matches.length !== 1) {
      return {
        ...base,
        status: matches.length ? ("ambiguous" as const) : ("not_found" as const),
        newTagId: null,
      };
    }
    const newTagId = matches[0];
    const key = JSON.stringify([link.featureId, newTagId]);
    if (occupied.has(key)) return { ...base, status: "duplicate" as const, newTagId };
    occupied.add(key);
    return { ...base, status: "relink" as const, newTagId };
  });
}

export async function relinkFeatureTags(teamId: number, types: LibraryType[], dryRun: boolean) {
  return prisma.$transaction(
    async (tx) => {
      const tags = await tx.assetTag.findMany({
        where: { teamId },
        select: { id: true, name: true, parentId: true },
      });
      const results = [];
      for (const type of types) {
        // Filter through the owning feature: association rows do not have a teamId column.
        const orderBy = [{ sort: "asc" as const }, { id: "asc" as const }];
        let links: Link[];
        switch (type) {
          case "product":
            links = (
              await tx.assetProductTag.findMany({ where: { assetProduct: { teamId } }, orderBy })
            ).map((r) => ({ ...r, featureId: r.assetProductId }));
            break;
          case "brand":
            links = (
              await tx.assetLogoTag.findMany({ where: { assetLogo: { teamId } }, orderBy })
            ).map((r) => ({ ...r, featureId: r.assetLogoId }));
            break;
          case "person":
            links = (
              await tx.assetPersonTag.findMany({ where: { assetPerson: { teamId } }, orderBy })
            ).map((r) => ({ ...r, featureId: r.assetPersonId }));
            break;
          case "ip":
            links = (await tx.assetIpTag.findMany({ where: { assetIp: { teamId } }, orderBy })).map(
              (r) => ({ ...r, featureId: r.assetIpId }),
            );
            break;
        }
        const details = planFeatureTagRelinks(tags, links);
        if (!dryRun) {
          for (const item of details) {
            if (item.status !== "relink") continue;
            const args = { where: { id: item.linkId }, data: { assetTagId: item.newTagId } };
            switch (type) {
              case "product":
                await tx.assetProductTag.update(args);
                break;
              case "brand":
                await tx.assetLogoTag.update(args);
                break;
              case "person":
                await tx.assetPersonTag.update(args);
                break;
              case "ip":
                await tx.assetIpTag.update(args);
                break;
            }
          }
        }
        const matched = details.filter((item) => item.status === "relink").length;
        const unchanged = details.filter((item) => item.status === "unchanged").length;
        results.push({
          type,
          total: details.length,
          matched,
          updated: dryRun ? 0 : matched,
          unchanged,
          skipped: details.length - matched - unchanged,
          details,
        });
      }
      return { dryRun, results };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
  );
}
