import { buildTagStructureText, fetchTagsTree } from "@/app/tagging/utils";
import prisma from "@/prisma/prisma";
import { describe, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe.skip("Tag Prediction - Real Database Test", () => {
  it("should predict tags for a real asset", async () => {
    const teamSlug = "t/test-team-id";
    const { id: teamId } = await prisma.team.findUniqueOrThrow({
      where: { slug: teamSlug },
      select: { id: true },
    });
    const tagsTree = await fetchTagsTree({ teamId });
    console.log(tagsTree);
    const tagStructureText = buildTagStructureText(tagsTree);
    console.log(tagStructureText);
  }, 30000); // 30秒超时
});
