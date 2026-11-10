"use client";

import type { TagNode } from "../types";
import { TagImportExportDialog } from "./TagImportExportDialog";

/** One table carries the tag paths and optional configuration columns. */
export function BatchTagImportExportDialog({
  open,
  onOpenChange,
  maxLevel,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxLevel: 3 | 4;
  tagsTree?: TagNode[];
  onImportedText?: (text: string) => void;
  onImported?: () => void;
}) {
  return (
    <TagImportExportDialog
      open={open}
      maxLevel={maxLevel}
      onOpenChange={onOpenChange}
      onImported={() => onImported?.()}
      onExportCleaned={onImported}
    />
  );
}
