// @vitest-environment node
import { POST } from "@/app/api/tags/sort/route";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  save: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/app/(auth)/requestAuth", () => ({ getAuthSession: mocks.session }));
vi.mock("@/app/tags/actions", () => ({ updateTagSort: mocks.save }));
vi.mock("@/lib/logging", () => ({ rootLogger: { info: mocks.info, error: mocks.error } }));
const tags = [
  { id: 2, sort: 2 },
  { id: 1, sort: 1 },
];
const request = (body: unknown = { tags }, headers = {}) =>
  new NextRequest("https://auto.example/api/tags/sort", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 9 }, team: { id: 7, slug: "t/155340" } });
  mocks.save.mockResolvedValue({ success: true, data: { sorts: tags } });
});
it("uses JSON with a request ID and returns server-confirmed sort values", async () => {
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect(result.headers.get("content-type")).toContain("application/json");
  expect(result.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(await result.json()).toEqual({ success: true, data: { sorts: tags } });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith(tags);
});
it("returns an explicit JSON 401 when the session is missing, without invoking the write", async () => {
  mocks.session.mockResolvedValue(null);
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect((await response.json()).success).toBe(false);
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each([{}, { tags: [] }, { tags: [{ id: 0, sort: 1 }] }, { tags: [{ id: 1, sort: 1.5 }] }])(
  "rejects invalid input: %j",
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  },
);
it("rejects oversized payloads before invoking the write", async () => {
  expect(
    (await POST(request({ tags }, { "content-length": String(1024 * 1024 + 1) }))).status,
  ).toBe(413);
  expect(mocks.save).not.toHaveBeenCalled();
});
it.each([
  ["forbidden", 403],
  ["busy", 409],
])("preserves the existing %s guard and uses HTTP %s", async (code, status) => {
  mocks.save.mockResolvedValue({ success: false, code, message: "denied" });
  const response = await POST(request());
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ success: false, code });
});
it("converts unexpected exceptions to safe JSON without exposing credentials or stack traces", async () => {
  mocks.save.mockRejectedValue(new Error("private token"));
  const response = await POST(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("private token");
  expect(JSON.stringify(mocks.error.mock.calls)).not.toContain("private token");
});
