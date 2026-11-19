import { buildAllowedFolderIdSet, isAssetInApplicationScope } from "@/app/(tagging)/application-scope";
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
  checkApplicationScope: z.boolean().optional().default(false),
  assetIds: z.array(z.coerce.bigint().positive()).max(100).optional(),
});

/**
 * Read-only per-asset price for a new tagging task.
 * predict-asset-tag enqueues and must not be used to preview a charge.
 */
export async function POST(request: NextRequest) {
  try {
    const { teamId: musedamTeamId, assetIds: requestedIds, checkApplicationScope } = requestSchema.parse(
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
      // A suspended task cannot run. Returning a successful zero-price quote
      // makes the parent application's manual dialog advertise free tagging.
      return NextResponse.json(
        {
          success: false,
          code: "TEAM_TAGGING_SUSPENDED",
          error: "Tagging is suspended for this team",
        },
        { status: 409 },
      );
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
    let eligibleAssetIds: string[] | undefined;
    if (assetIds !== undefined) {
      if ((!unitCreditCost && !checkApplicationScope) || !assetIds.length) {
        creditCost = 0;
        if (checkApplicationScope) eligibleAssetIds = [];
      }
      else {
        try {
          let assets = await fetchAssetCreditInputs(team, assetIds);
          if (checkApplicationScope) {
            const allowed = await buildAllowedFolderIdSet({ team, applicationScope: settings.applicationScope });
            // Missing folder metadata cannot be treated as an unrestricted scope.
            if (assets.some((asset) => !Array.isArray(asset.parentIds))) throw new Error("Missing parent folders");
            assets = assets.filter((asset) => isAssetInApplicationScope(asset.parentIds!, allowed));
            eligibleAssetIds = assets.map((asset) => asset.id);
          }
          creditCost = assets.reduce(
            (sum, asset) =>
              sum + (settings.isTaggingEnabled ? getTaggingCreditQuote(getAssetFeatureImageMode(settings, asset), asset).creditCost : 0),
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
        ...(eligibleAssetIds === undefined ? {} : {
          eligibleAssetIds,
          excludedCount: (assetIds?.length ?? 0) - eligibleAssetIds.length,
        }),
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
