import { TagItem } from "@/app/tags/components/TagItem";
import type { TagNode } from "@/app/tags/types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/icons", () => ({
  TagOutlinedIcon: () => null,
  TagSearchIcon: () => null,
}));
vi.mock("@/embed/message", () => ({ dispatchMuseDAMClientAction: vi.fn() }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  DropdownMenuSeparator: () => null,
}));
afterEach(cleanup);

function setup(children: TagNode[], success = true, level = 1) {
  const onDelete = vi.fn(async () => success);
  render(
    <TagItem
      tag={{ id: 1, name: "parent", slug: null, children }}
      level={level}
      onDelete={onDelete}
      onEdit={async () => true}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      onRestore={() => {}}
      getNodeId={() => "1"}
      canEdit
    />,
  );
  fireEvent.click(screen.getByText("delete"));
  return onDelete;
}
const child: TagNode = { id: 2, name: "child", slug: null, children: [] };

describe("tag deletion confirmation", () => {
  it.each([1, 2, 3])("asks for confirmation before deleting a level %s tag", async (level) => {
    const onDelete = setup(level < 3 ? [child] : [], true, level);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("deleteConfirmDescription");
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("confirmDelete"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledExactlyOnceWith("1"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const onDelete = setup([child]);
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("cancel"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });
});

it("uses the current name when editing after a details rename", async () => {
  const onEdit = vi.fn(async () => true);
  const props = {
    level: 1, onEdit, onDelete: async () => true, onStartEdit: () => {},
    onCancelEdit: () => {}, onRestore: () => {}, getNodeId: () => "1", canEdit: true,
  };
  const tag: TagNode = { id: 1, name: "宣传海报", slug: null, children: [] };
  const { rerender } = render(<TagItem {...props} tag={tag} />);
  rerender(<TagItem {...props} tag={{ ...tag, name: "1" }} />);
  rerender(<TagItem {...props} tag={{ ...tag, name: "1", isEditing: true }} />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  expect(input.value).toBe("1");
  fireEvent.blur(input);
  await waitFor(() => expect(onEdit).toHaveBeenCalledWith("1", "1"));
});

it("does not submit the draft on blur after Escape", async () => {
  const onEdit = vi.fn(async () => true);
  render(<TagItem tag={{ id: 1, name: "原名", slug: null, children: [], isEditing: true }}
    level={1} onEdit={onEdit} onDelete={async () => true} onStartEdit={() => {}}
    onCancelEdit={() => {}} onRestore={() => {}} getNodeId={() => "1"} canEdit />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "未保存草稿" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.blur(input);
  expect(onEdit).not.toHaveBeenCalled();
});

it("submits Enter followed by blur only once while saving", async () => {
  let finish!: (value: boolean) => void;
  const onEdit = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  render(<TagItem tag={{ id: 1, name: "原名", slug: null, children: [], isEditing: true }}
    level={1} onEdit={onEdit} onDelete={async () => true} onStartEdit={() => {}}
    onCancelEdit={() => {}} onRestore={() => {}} getNodeId={() => "1"} canEdit />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "新名" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.blur(input);
  expect(onEdit).toHaveBeenCalledOnce();
  finish(true);
});
