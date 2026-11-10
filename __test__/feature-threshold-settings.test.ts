// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ teamId: 7, rows: new Map<string, number>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/withAuth", () => ({ withAuth: (run: (ctx: { team: { id: number } }) => unknown) => run({ team: { id: state.teamId } }) }));
vi.mock("@/prisma/prisma", () => ({ default: { teamConfig: {
  findMany: async ({ where }: { where: { teamId: number; key: { in: string[] } } }) => where.key.in.flatMap(key => { const value = state.rows.get(`${where.teamId}:${key}`); return value === undefined ? [] : [{ key, value }]; }),
  upsert: async ({ create }: { create: { teamId: number; key: string; value: number } }) => state.rows.set(`${create.teamId}:${create.key}`, create.value),
} } }));
import { fetchFeatureThreshold, saveFeatureThreshold } from "@/app/(tagging)/tagging/components/feature-threshold-actions";
beforeEach(() => { state.rows.clear(); state.teamId = 7; });
it("isolates settings by authenticated team and does not overwrite other feature types", async () => {
  await saveFeatureThreshold("brand", 70); await saveFeatureThreshold("product", 55);
  expect(await fetchFeatureThreshold("brand")).toBe(70);
  state.teamId = 8;
  expect(await fetchFeatureThreshold("brand")).toBe(60);
  await saveFeatureThreshold("brand", 90);
  state.teamId = 7;
  expect(await fetchFeatureThreshold("brand")).toBe(70);
  expect(await fetchFeatureThreshold("product")).toBe(55);
});
it.each([-1, 101, 70.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid threshold %s on the server", async value => {
  await expect(saveFeatureThreshold("brand", value)).rejects.toThrow("Invalid feature threshold");
  expect(state.rows.size).toBe(0);
});
