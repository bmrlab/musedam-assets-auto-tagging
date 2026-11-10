import { unmatchedQuery } from "@/app/(tagging)/tagging/review/unmatched-query";
import { expect, it } from "vitest";
const capabilities = { fields: true, brand: true, product: true, ip: true, person: true };
const filters = { content: "fields" as const, time: "all" as const, search: "" };
it("validates paging, scope and search before constructing a query", () => {
  expect(() => unmatchedQuery(7, filters, capabilities, 0, 40)).toThrow("Invalid query");
  expect(() => unmatchedQuery(7, filters, capabilities, 1, 100000)).toThrow("Invalid query");
  expect(() =>
    unmatchedQuery(7, { ...filters, content: "bad" as never }, capabilities, 1, 40),
  ).toThrow("Invalid query");
  expect(() =>
    unmatchedQuery(7, { ...filters, search: "a".repeat(201) }, capabilities, 1, 40),
  ).toThrow("Invalid query");
});
it("binds tenant IDs and literal search parameters, and ranks before testing the outcome", () => {
  const query = unmatchedQuery(7, { ...filters, search: "100%_case'" }, capabilities, 1, 40);
  expect(query.sql).toContain('SELECT DISTINCT ON ("assetObjectId")');
  expect(query.sql).toContain("q.\"status\" = 'completed'");
  expect(query.sql).toContain("\"taskType\" <> 'test'");
  expect(query.sql).not.toContain("100%_case");
  expect(query.values).toContain("%100\\%\\_case'%");
  expect(query.values.filter((value) => value === 7)).toHaveLength(2);
});

it.each([["today", 10], ["week", 8], ["month", 1]] as const)("uses the calendar boundary for %s", (time, day) => {
  const query = unmatchedQuery(7, { ...filters, time }, capabilities, 1, 40, false, new Date(2026, 10, 10, 15, 30));
  expect(query.values).toContainEqual(new Date(2026, 10, day));
});
