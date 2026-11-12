import { getTaggingSettings } from "@/app/(tagging)/tagging/settings/lib";
import { idToSlug } from "@/lib/slug";
import {
  getTaggingCreditCost,
  getAssetFeatureImageMode,
  getTaggingCreditQuote,
  TAGGING_CREDIT_PRICING_VERSION,
} from "@/lib/tagging-credit";
import { assertTeamTaggingAuthorization } from "@/musedam/apiKey";
import { fetchAssetCreditInputs } from "@/musedam/asset-credit-quote";
import { MuseDAMID } from "@/musedam/types";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  teamId: z.coerce.bigint().positive(),
  assetIds: z.array(z.coerce.bigint().positive()).max(100).optional(),
});

/**
 * Read-only per-asset price for a new tagging task.
 * predict-asset-tag enqueues and must not be used to preview a charge.
 */
export async function POST(request: NextRequest) {
  try {
    const { teamId: musedamTeamId, assetIds: requestedIds } = requestSchema.parse(
      await request.json(),
    );
    const assetIds = requestedIds ? [...new Set(requestedIds)] : undefined;
    const team = await prisma.team.findUnique({
      where: { slug: idToSlug("team", new MuseDAMID(musedamTeamId)) },
    });
    if (!team) {
      return NextResponse.json({ success: false, error: "Team not found" }, { status: 404 });
    }

    const settings = await getTaggingSettings(team.id);
    const suspension = await prisma.teamConfig.findUnique({
      where: { teamId_key: { teamId: team.id, key: "taggingSuspended" } },
      select: { value: true },
    });
    if (suspension?.value === true) {
      return NextResponse.json({
        success: true,
        data: {
          featureImageMode: settings.featureImageMode,
          featureVideoImageMode: settings.featureVideoImageMode === true,
          creditCost: 0,
          unitCreditCost: 0,
          videoUnitCreditCost: 0,
          creditPricingVersion: TAGGING_CREDIT_PRICING_VERSION,
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

    const unitCreditCost = settings.isTaggingEnabled
      ? getTaggingCreditCost(settings.featureImageMode)
      : 0;
    let creditCost = unitCreditCost;
    if (assetIds !== undefined) {
      if (!unitCreditCost || !assetIds.length) creditCost = 0;
      else {
        try {
          const assets = await fetchAssetCreditInputs(team, assetIds);
          creditCost = assets.reduce(
            (sum, asset) =>
              sum + getTaggingCreditQuote(getAssetFeatureImageMode(settings, asset), asset).creditCost,
            0,
          );
        } catch {
          return NextResponse.json(
            { success: false, error: "Asset metadata unavailable; credit was not quoted" },
            { status: 502 },
          );
        }
      }
    }
    return NextResponse.json({
      success: true,
      data: {
        featureImageMode: settings.featureImageMode,
        featureVideoImageMode: settings.featureVideoImageMode === true,
        creditCost,
        unitCreditCost,
        videoUnitCreditCost: settings.isTaggingEnabled ? getTaggingCreditCost(settings.featureVideoImageMode === true) : 0,
        creditPricingVersion: TAGGING_CREDIT_PRICING_VERSION,
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
