import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/app/tags/tagSortClient", async original => ({
  ...(await original<typeof import("@/app/tags/tagSortClient")>()), saveTagSort: mocks.save,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
import { TagSortRequestError } from "@/app/tags/tagSortClient";
import { TagSortModal } from "@/app/tags/components/TagSortModal";
const tags = [{ id: 1, slug: "g/101", name: "A", children: [] }, { id: 2, slug: "g/202", name: "B", children: [] }];
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

it("keeps the dialog open when saving fails and does not run another client sync", async () => {
  mocks.save.mockResolvedValue({ success: false, message: "offline" });
  const onClose = vi.fn(), onConfirm = vi.fn();
  render(<TagSortModal open onClose={onClose} onConfirm={onConfirm} tags={tags} level={1} />);
  fireEvent.click(screen.getByText("confirm"));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
  await waitFor(() => expect((screen.getByText("confirm") as HTMLButtonElement).disabled).toBe(false));
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

it("waits for server saving and the parent refresh before closing", async () => {
  let finish!: () => void;
  mocks.save.mockResolvedValue({ success: true, data: { sorts: [{ id: 1, sort: 2 }, { id: 2, sort: 1 }] } });
  const onClose = vi.fn();
  const onConfirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<TagSortModal open onClose={onClose} onConfirm={onConfirm} tags={tags} level={1} />);
  fireEvent.click(screen.getByText("confirm"));
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith([{ id: 1, sort: 2 }, { id: 2, sort: 1 }]);
  expect(onClose).not.toHaveBeenCalled();
  finish();
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});

it("keeps the dialog open and identifies an unknown proxy failure without retrying", async () => {
  mocks.save.mockRejectedValue(new TagSortRequestError(502, "request-123"));
  const onClose = vi.fn(), onConfirm = vi.fn();
  render(<TagSortModal open onClose={onClose} onConfirm={onConfirm} tags={tags} level={1} />);
  fireEvent.click(screen.getByText("confirm"));
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("sortOutcomeUnknown (HTTP 502 · request-123)"));
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});
