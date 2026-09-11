import "server-only";

import prisma from "@/prisma/prisma";

export type BatchImportTagLookup = Map<
  string,
  {
    assetTagId: number;
    tagPath: string[];
  }
>;

export function normalizeBatchImportTagPath(value: string) {
  return value
    .split(">")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join(">");
}

function splitTagPath(value: string) {
  return value
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function findMissingBatchImportTagPaths({
  tagPathValues,
  tagLookup,
}: {
  tagPathValues: string[];
  tagLookup: BatchImportTagLookup;
}) {
  const missingPaths = new Map<string, string>();

  for (const value of tagPathValues) {
    const path = splitTagPath(value);
    const normalizedPath = normalizeBatchImportTagPath(path.join(" > "));

    if (!normalizedPath || tagLookup.has(normalizedPath) || missingPaths.has(normalizedPath)) {
      continue;
    }

    missingPaths.set(normalizedPath, path.join(" > "));
  }

  return Array.from(missingPaths.values());
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function createMissingBatchImportTagTrees({
  teamId,
  tagPaths,
}: {
  teamId: number;
  tagPaths: string[];
}) {
  for (const tagPath of tagPaths) {
    const names = splitTagPath(tagPath);
    let parentId: number | null = null;

    for (const [index, name] of names.entries()) {
      let tag: { id: number } | null = await prisma.assetTag.findFirst({
        where: {
          teamId,
          parentId,
          name: {
            equals: name,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
        },
      });

      if (!tag) {
        try {
          tag = await prisma.assetTag.create({
            data: {
              teamId,
              parentId,
              name,
              level: index + 1,
            },
            select: {
              id: true,
            },
          });
        } catch (error) {
          if (!isUniqueConstraintError(error)) {
            throw error;
          }

          tag = await prisma.assetTag.findFirst({
            where: {
              teamId,
              parentId,
              name: {
                equals: name,
                mode: "insensitive",
              },
            },
            select: {
              id: true,
            },
          });

          if (!tag) {
            throw error;
          }
        }
      }

      parentId = tag.id;
    }
  }
}
