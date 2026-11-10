// Explicit synthetic fixture only; no shared team-setting changes.
import { loadEnvConfig } from "@next/env";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
async function main() {
  loadEnvConfig(process.cwd());
  assert.equal(process.env.MUSEDAM_API_ENV_TAG, "version-env-09");
  const [
    { default: prisma },
    { syncSingleAssetFromMuseDAM },
    { MuseDAMID },
    { predictMetadata },
    { getTaggingSettings },
    { applyMetadataPredictions, fetchMetadataContext, fetchMetadataValues },
  ] = await Promise.all([
    import("../../src/prisma/prisma"),
    import("../../src/musedam/assets"),
    import("../../src/musedam/types"),
    import("../../src/lib/metadata/predict"),
    import("../../src/app/(tagging)/tagging/settings/lib"),
    import("../../src/musedam/metadata"),
  ]);
  try {
    const team = await prisma.team.findUniqueOrThrow({
      where: { slug: "t/135" },
      select: { id: true, slug: true },
    });
    const materialId = "6964801";
    const { assetObject } = await syncSingleAssetFromMuseDAM({
      team,
      musedamAssetId: MuseDAMID.from(materialId),
    });
    assert.match(assetObject.name, /联动测试/);
    const settings = {
      ...(await getTaggingSettings(team.id)),
      isMetadataEnabled: true,
      isTaggingEnabled: false,
      matchingSources: {
        basicInfo: true,
        materializedPath: false,
        contentAnalysis: false,
        tagKeywords: false,
      },
    };
    const predictions = await predictMetadata(assetObject, team, settings);
    const channel = "3accf9ca-3bbd-4b3c-ab98-181ed786764c",
      season = "526c01bd-940d-440d-8d38-11d0338ab332",
      bool = "f2e048a4-8d46-415c-ab1c-7df6fa2ad1bc",
      category = "9b016a4e-f300-4ad8-aeaf-e25d67d59a6d";
    const effective = predictions.filter((p) => p.effective);
    assert.deepEqual(effective.map((p) => p.fieldId).sort(), [channel, season].sort());
    assert.deepEqual(effective.find((p) => p.fieldId === channel)?.optionIds, [
      "11825d49-877a-452e-8568-28fdf4fc8309",
    ]);
    assert.deepEqual(effective.find((p) => p.fieldId === season)?.optionIds, [
      "b99fd14b-9113-4f48-a4ce-3421f5c801a6",
    ]);
    const before = await fetchMetadataContext(team, materialId);
    const requestId = "metadata-linkage-20261110-6964801-v1";
    const applied = await applyMetadataPredictions(team, materialId, effective, requestId);
    assert.deepEqual(applied.applied.sort(), [channel, season].sort());
    const retry = await applyMetadataPredictions(team, materialId, effective, requestId);
    assert.deepEqual(retry, applied);
    const after = await fetchMetadataContext(team, materialId);
    assert.equal(after.version, before.version + 1);
    assert(!after.fields.some((f) => [bool, category].includes(f.fieldId)));
    const blocked = await applyMetadataPredictions(
      team,
      materialId,
      [
        {
          ...effective.find((p) => p.fieldId === season)!,
          optionIds: ["606aee84-5f79-4b75-81dc-20069c04ee73"],
        },
        {
          ...effective[0],
          fieldId: bool,
          expectedFieldVersion: before.fields.find((f) => f.fieldId === bool)!.fieldVersion,
          optionIds: undefined,
          checked: true,
        },
        {
          ...effective[0],
          fieldId: category,
          expectedFieldVersion: before.fields.find((f) => f.fieldId === category)!.fieldVersion,
          optionIds: ["c92d8e0c-de20-4f80-8f96-24b568c8e7cb"],
        },
      ],
      "metadata-linkage-20261110-6964801-blocked-v1",
    );
    assert.deepEqual(blocked.applied, []);
    assert.deepEqual(blocked.skipped.sort(), [season, bool, category].sort());
    assert.equal((await fetchMetadataContext(team, materialId)).version, after.version);
    const values = await fetchMetadataValues(team, materialId);
    const report = {
      testedAt: new Date().toISOString(),
      materialId,
      assetName: assetObject.name,
      predictions,
      applied,
      retry,
      blocked,
      beforeVersion: before.version,
      afterVersion: after.version,
      values,
    };
    await writeFile(
      "development/metadata-test-data/linkage-verification.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        materialId,
        predictions: effective.map((p) => ({ field: p.fieldName, labels: p.labels })),
        applied,
        version: after.version,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
