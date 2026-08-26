import { withAuth } from "@/app/(auth)/withAuth";
import { predictAssetTags } from "@/app/(tagging)/predict";
import prisma from "@/prisma/prisma";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const querySchema = z.object({
  assetId: z.coerce.number().int().positive().optional(),
});

const debugModel = "gpt-5-mini";

const debugTagsTree = [
  {
    id: 900001,
    name: "内容类型",
    extra: {},
    children: [
      {
        id: 900002,
        name: "视频",
        extra: { keywords: ["视频", "mp4"] },
      },
      {
        id: 900003,
        name: "图片",
        extra: { keywords: ["图片", "jpg", "jpeg", "png"] },
      },
    ],
  },
  {
    id: 900010,
    name: "内容主题",
    extra: {},
    children: [
      {
        id: 900011,
        name: "汽车",
        extra: { keywords: ["汽车", "赛车", "布加迪"] },
      },
      {
        id: 900012,
        name: "人物",
        extra: { keywords: ["人物", "人像"] },
      },
      {
        id: 900013,
        name: "其他",
        extra: {},
      },
    ],
  },
];

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  return withAuth(async ({ team: { id: teamId } }) => {
    const query = querySchema.safeParse({
      assetId: request.nextUrl.searchParams.get("assetId") || undefined,
    });
    if (!query.success) {
      return NextResponse.json(
        {
          success: false,
          error: "assetId must be a positive integer",
        },
        { status: 400 },
      );
    }

    const asset = await prisma.assetObject.findFirst({
      where: {
        teamId,
        ...(query.data.assetId ? { id: query.data.assetId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (!asset) {
      return NextResponse.json(
        {
          success: false,
          error: query.data.assetId
            ? `Asset ${query.data.assetId} was not found in the current team`
            : "No assets were found in the current team",
        },
        { status: 404 },
      );
    }

    try {
      const result = await predictAssetTags(asset, {
        tagsTreeOverride: debugTagsTree,
        modelOverride: debugModel,
      });

      return NextResponse.json({
        success: true,
        data: {
          asset: {
            id: asset.id,
            name: asset.name,
            materializedPath: asset.materializedPath,
          },
          model: debugModel,
          provider: process.env.AZURE_EASTUS2_API_KEY ? "azure-eastus2" : "openai-compatible",
          tagSource: "hardcoded-debug-tags",
          ...result,
        },
      });
    } catch (error) {
      console.error("Debug tagging prediction failed:", error);
      return NextResponse.json(
        {
          success: false,
          assetId: asset.id,
          error: error instanceof Error ? error.message : "Unknown prediction error",
        },
        { status: 502 },
      );
    }
  });
}
