import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("MuseDAM request logging", () => {
  let generateCurlCommand: typeof import("@/musedam/lib").generateCurlCommand;

  beforeAll(async () => {
    ({ generateCurlCommand } = await import("@/musedam/lib"));
  });

  it("redacts credentials from diagnostic curl commands", () => {
    const command = generateCurlCommand("https://musedam.example/api", "POST", {
      Authorization: "Bearer secret-token",
      Cookie: "session=secret-cookie",
      "Content-Type": "application/json",
    });

    expect(command).toContain("Authorization: [REDACTED]");
    expect(command).toContain("Cookie: [REDACTED]");
    expect(command).toContain("Content-Type: application/json");
    expect(command).not.toContain("secret-token");
    expect(command).not.toContain("secret-cookie");
  });
});
