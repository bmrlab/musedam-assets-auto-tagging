"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  GripVertical,
  Loader2,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createAssetIpTypeAction,
  reorderAssetIpTypesAction,
  softDeleteAssetIpTypeAction,
  updateAssetIpTypeAction,
} from "./actions";
import { IpTypeItem } from "./types";

type SortableContextViewProps = {
  children: React.ReactNode;
  items: Array<string | number>;
  strategy?: typeof verticalListSortingStrategy;
};

const SortableContextView =
  SortableContext as unknown as React.ComponentType<SortableContextViewProps>;

type IpTypeSelectProps = {
  value: string | null;
  types: IpTypeItem[];
  usedTypeIds?: string[];
  onChange: (typeId: string | null) => void;
  onTypesChange: (types: IpTypeItem[]) => void;
  onTypeRenamed?: (typeId: string, name: string) => void;
  onTypeDeleted?: (typeId: string) => void;
  fallbackType?: {
    id: string;
    name: string;
  } | null;
  disabled?: boolean;
  triggerClassName?: string;
};


function SortableTypeRow({
  type,
  editingTypeId,
  editingName,
  onEditingNameChange,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
  onDelete,
  disabled,
}: {
  type: IpTypeItem;
  editingTypeId: string | null;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onStartEdit: (type: IpTypeItem) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (type: IpTypeItem) => void;
  onDelete: (type: IpTypeItem) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: type.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isEditing = editingTypeId === type.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex h-8 items-center rounded-[6px] px-[10px] py-2 transition-colors",
        isEditing ? "gap-2" : "gap-2",
        isDragging && "bg-[#eef3ff] shadow-sm",
        !isDragging && "hover:bg-[#eef3ff]",
      )}
    >
      <button
        type="button"
        className="cursor-grab text-basic-5 active:cursor-grabbing"
        {...attributes}
        {...listeners}
        disabled={disabled || isEditing}
      >
        <GripVertical className="size-[14px]" />
      </button>

      {isEditing ? (
        <>
          <Input
            value={editingName}
            onChange={(event) => onEditingNameChange(event.target.value)}
            className="h-[30px] flex-1 rounded-[6px] px-3 py-[5px] focus-visible:border-[#598BFF] focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitEdit(type);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelEdit();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="icon"
              variant="default"
              className="size-7 bg-[#3366FF] text-white hover:bg-[#2457F5]"
              onClick={() => onSubmitEdit(type)}
            >
              <Check className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-7"
              onClick={onCancelEdit}
            >
              <X className="size-4" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-[14px] leading-[22px] font-normal text-[#101426]">
            {type.name}
          </span>
          <div className="ml-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => onStartEdit(type)}
              className="h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <span
                aria-hidden="true"
                className="block h-4 w-4 bg-[#8F9BB3] [mask-image:url('/Icon/Edit.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
              />
            </button>
            <button
              type="button"
              onClick={() => onDelete(type)}
              className="h-4 w-4 p-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <span
                aria-hidden="true"
                className="block h-4 w-4 bg-[#FF3D71] [mask-image:url('/Icon/Delete.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:100%_100%]"
              />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function IpTypeSelect({
  value,
  types,
  usedTypeIds = [],
  onChange,
  onTypesChange,
  onTypeRenamed,
  onTypeDeleted,
  fallbackType,
  disabled,
  triggerClassName,
}: IpTypeSelectProps) {
  const t = useTranslations("Tagging.IpLibrary.ipType");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"list" | "manage">("list");
  const [isCreating, setIsCreating] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setMode("list");
        setIsCreating(false);
        setEditingTypeId(null);
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const selectedType =
    types.find((type) => type.id === value) ??
    (fallbackType && fallbackType.id === value
      ? { ...fallbackType, sort: types.length + 1 }
      : null);
  const canSubmitNewType = newTypeName.trim().length > 0;

  async function handleCreateType() {
    const nextName = newTypeName.trim();
    if (!nextName) {
      toast.error(t("typeNameRequired"));
      return;
    }

    startTransition(async () => {
      const result = await createAssetIpTypeAction(nextName);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      const nextTypes = [...types, result.data.ipType].sort(
        (left, right) => left.sort - right.sort,
      );
      onTypesChange(nextTypes);
      onChange(result.data.ipType.id);
      setIsCreating(false);
      setNewTypeName("");
      setMode("list");
      toast.success(t("created"));
    });
  }

  async function handleRenameType(type: IpTypeItem) {
    const nextName = editingName.trim();
    if (!nextName) {
      toast.error(t("typeNameRequired"));
      return;
    }

    startTransition(async () => {
      const result = await updateAssetIpTypeAction(type.id, nextName);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      onTypesChange(types.map((item) => (item.id === type.id ? result.data.ipType : item)));
      onTypeRenamed?.(type.id, result.data.ipType.name);
      setEditingTypeId(null);
      setEditingName("");
      toast.success(t("updated"));
    });
  }

  async function handleDeleteType(type: IpTypeItem) {
    if (usedTypeIds.includes(type.id)) {
      toast.error(t("inUse"));
      return;
    }

    startTransition(async () => {
      const result = await softDeleteAssetIpTypeAction(type.id);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      onTypesChange(types.filter((item) => item.id !== type.id));
      if (value === type.id) {
        onChange(null);
      }
      onTypeDeleted?.(type.id);
      setEditingTypeId(null);
      setEditingName("");
      toast.success(t("deleted"));
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = types.findIndex((type) => type.id === active.id);
    const newIndex = types.findIndex((type) => type.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reordered = arrayMove(types, oldIndex, newIndex).map((type, index) => ({
      ...type,
      sort: index + 1,
    }));
    const previous = types;

    onTypesChange(reordered);

    startTransition(async () => {
      const result = await reorderAssetIpTypesAction(reordered.map((type) => type.id));
      if (!result.success) {
        onTypesChange(previous);
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="relative w-[350px]" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-12 w-[350px] items-center justify-between rounded-[6px] border border-basic-4 bg-background px-4 text-left text-sm transition-all",
          triggerClassName,
          "hover:border-primary-5",
          open && "border-primary-5 shadow-[0_0_0_2px_rgba(51,102,255,0.2)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn(!selectedType && "text-basic-5")}>
          {selectedType?.name ?? t("placeholder")}
        </span>
        <ChevronDown
          className={cn("size-4 text-basic-5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="absolute top-full left-0 z-50 mt-2 w-[350px] rounded-[6px] border border-[#E4E9F2] bg-background p-1 shadow-[0_12px_32px_rgba(31,35,41,0.12)]">
          {mode === "manage" ? (
            <div className="space-y-1">
              <div className="flex h-[37px] items-center border-b border-[#E4E9F2] px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 transition-colors hover:opacity-80"
                  onClick={() => {
                    setMode("list");
                    setEditingTypeId(null);
                    setEditingName("");
                  }}
                >
                  <ChevronLeft className="h-[14px] w-[14px] text-[#8F9BB3]" />
                  <span className="text-[14px] leading-5 font-medium text-[#192038]">
                    {t("manageTitle")}
                  </span>
                </button>
              </div>

              <div className="max-h-[260px] overflow-y-auto rounded-[6px]">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContextView
                    items={types.map((type) => type.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1 p-2">
                      {types.map((type) => (
                        <SortableTypeRow
                          key={type.id}
                          type={type}
                          editingTypeId={editingTypeId}
                          editingName={editingName}
                          onEditingNameChange={setEditingName}
                          onStartEdit={(nextType) => {
                            setEditingTypeId(nextType.id);
                            setEditingName(nextType.name);
                          }}
                          onCancelEdit={() => {
                            setEditingTypeId(null);
                            setEditingName("");
                          }}
                          onSubmitEdit={handleRenameType}
                          onDelete={handleDeleteType}
                          disabled={isPending}
                        />
                      ))}
                    </div>
                  </SortableContextView>
                </DndContext>
              </div>

              {isCreating ? (
                <div className="flex h-12 items-center gap-2 border-t px-3 py-2">
                  <Input
                    value={newTypeName}
                    onChange={(event) => setNewTypeName(event.target.value)}
                    placeholder={t("newTypePlaceholder")}
                    className="h-8 px-3 py-0 focus-visible:border-[#598BFF] focus-visible:ring-0 focus-visible:ring-offset-0"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCreateType();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      onClick={handleCreateType}
                      disabled={isPending || !canSubmitNewType}
                      className="size-7 bg-[#3366FF] text-white hover:bg-[#2457F5]"
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-7"
                      onClick={() => {
                        setIsCreating(false);
                        setNewTypeName("");
                      }}
                      disabled={isPending}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="h-px w-full bg-[#e4e9f2]" />
                  <div className="flex h-9 items-center px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setIsCreating(true)}
                      className="inline-flex h-5 items-center gap-[6px] text-[#3366FF] transition-colors hover:text-[#2457F5]"
                    >
                      <Plus className="h-[14px] w-[14px] text-[#3366FF]" />
                      <span className="text-[14px] leading-5 font-medium text-[#3366FF]">
                        {t("create")}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div className="max-h-[260px] overflow-y-auto rounded-[6px]">
                <div className="space-y-1">
                  {types.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => {
                        onChange(type.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex h-8 w-full items-center rounded-[6px] px-[10px] py-[5px] text-left text-[14px] leading-[22px] font-normal text-[#101426] transition-colors hover:bg-[#F2F6FF]",
                        value === type.id && "bg-[#F2F6FF]",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-[14px] leading-[22px] font-normal text-[#101426]">
                        {type.name}
                      </span>
                      {value === type.id ? (
                        <Check className="ml-auto h-[14px] w-[14px] shrink-0 text-[#3366FF]" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>

              {isCreating ? (
                <div className="flex h-12 items-center gap-2 border-t px-3 py-2">
                  <Input
                    value={newTypeName}
                    onChange={(event) => setNewTypeName(event.target.value)}
                    placeholder={t("newTypePlaceholder")}
                    className="h-8 px-3 py-0 focus-visible:border-[#598BFF] focus-visible:ring-0 focus-visible:ring-offset-0"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCreateType();
                      }
                    }}
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      onClick={handleCreateType}
                      disabled={isPending || !canSubmitNewType}
                      className="size-7 bg-[#3366FF] text-white hover:bg-[#2457F5]"
                    >
                      {isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-7"
                      onClick={() => {
                        setIsCreating(false);
                        setNewTypeName("");
                      }}
                      disabled={isPending}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="h-px w-full bg-[#e4e9f2]" />
                  <div className="flex h-9 items-center justify-between px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setIsCreating(true)}
                      className="inline-flex h-5 items-center gap-[6px] text-[#3366FF] transition-colors hover:text-[#2457F5]"
                    >
                      <Plus className="h-[14px] w-[14px] text-[#3366FF]" />
                      <span className="text-[14px] leading-5 font-medium text-[#3366FF]">
                        {t("create")}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode("manage")}
                      className="inline-flex h-4 items-center gap-1 text-[#8F9BB3] transition-colors hover:text-[#7B879E]"
                    >
                      <Settings className="h-[12px] w-[12px] text-[#8F9BB3]" />
                      <span className="text-[12px] leading-4 font-medium text-[#8F9BB3]">
                        {t("manageTitle")}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
