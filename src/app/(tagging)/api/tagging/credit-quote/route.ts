import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { isTeamTaggingSuspended } from "@/lib/tagging/team-suspension";
import { getTaggingCreditCost } from "@/lib/tagging-credit";
import { idToSlug } from "@/lib/slug";
import { assertTeamTaggingAuthorization } from "@/musedam/apiKey";
import { hasEnabledTaggingOutput } from "@/musedam/metadata";
import { MuseDAMID } from "@/musedam/types";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  teamId: z.coerce.bigint().positive(),
});

/**
 * Read-only per-asset price for a new tagging task.
 * predict-asset-tag enqueues and must not be used to preview a charge.
 */
export async function POST(request: NextRequest) {
  try {
    const { teamId: musedamTeamId } = requestSchema.parse(await request.json());
    const team = await prisma.team.findUnique({
      where: { slug: idToSlug("team", new MuseDAMID(musedamTeamId)) },
    });
    if (!team) {
      return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
    }

    const settings = await getTaggingSettings(team.id);
    if (await isTeamTaggingSuspended(team.id)) {
      return NextResponse.json({
        success: true,
        data: {
          featureImageMode: settings.featureImageMode,
          creditCost: 0,
          message: "Tagging is suspended for this team",
        },
      });
    }

    try {
      await assertTeamTaggingAuthorization(team);
    } catch (error) {
      console.error("MuseDAM tagging authorization failed:", error);
      return NextResponse.json(
        { success: false, error: "MuseDAM authorization failed; credit was not quoted" },
        { status: 502 },
      );
    }

    const creditCost = (await hasEnabledTaggingOutput(team, settings))
      ? getTaggingCreditCost(settings.featureImageMode)
      : 0;
    return NextResponse.json({
      success: true,
      data: {
        featureImageMode: settings.featureImageMode,
        creditCost,
      },
    });
  } catch (error) {
    console.error("Credit quote failed:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid request format", details: error.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
