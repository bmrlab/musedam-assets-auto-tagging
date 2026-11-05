import prisma from "@/prisma/prisma";
import "server-only";
import { retrieveTeamCredentials } from "./apiKey";
import { requestMuseDAMAPI } from "./lib";

let draining = false;

/** Saved in the same transaction as settings. Stable keys make delivery retryable after a network failure. */
export async function flushMetadataSettingAudits(teamId?: number) {
  if (draining) return;
  draining = true;
  try {
    const events = await prisma.teamConfig.findMany({
      where: { ...(teamId ? { teamId } : {}), key: { startsWith: "metadataSettingAudit:" } },
      include: { team: { select: { id: true, slug: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    for (const event of events) {
      try {
        const { apiKey } = await retrieveTeamCredentials({ team: event.team });
        await requestMuseDAMAPI("/api/muse/metadata-ai-setting-audit", {
          method: "POST",
          timeoutMs: 10000,
          headers: { Authorization: `Bearer ${apiKey}` },
          body: event.value,
        });
        await prisma.teamConfig.deleteMany({ where: { id: event.id, key: event.key } });
      } catch {
        console.warn("Metadata settings audit delivery pending", {
          teamId: event.teamId,
          eventId: event.id,
        });
      }
    }
  } finally {
    draining = false;
  }
}
