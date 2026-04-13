"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  GripVertical,
  Loader2,
  PencilLine,
  Plus,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
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
  createAssetLogoTypeAction,
  reorderAssetLogoTypesAction,
  softDeleteAssetLogoTypeAction,
  updateAssetLogoTypeAction,
} from "./actions";
import { BrandLogoTypeItem } from "./types";

type SortableContextViewProps = {
  children: React.ReactNode;
  items: Array<string | number>;
  strategy?: typeof verticalListSortingStrategy;
};

const SortableContextView = SortableContext as unknown as React.ComponentType<SortableContextViewProps>;

type LogoTypeSelectProps = {
  value: string | null;
  types: BrandLogoTypeItem[];
  onChange: (typeId: string | null) => void;
  onTypesChange: (types: BrandLogoTypeItem[]) => void;
  onTypeRenamed?: (typeId: string, name: string) => void;
  onTypeDeleted?: (typeId: string) => void;
  fallbackType?: {
    id: string;
    name: string;
  } | null;
  disabled?: boolean;
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
  type: BrandLogoTypeItem;
  editingTypeId: string | null;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onStartEdit: (type: BrandLogoTypeItem) => void;
  onCancelEdit: () => void;
  onSubmitEdit: (type: BrandLogoTypeItem) => void;
  onDelete: (type: BrandLogoTypeItem) => void;
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
        "flex items-center gap-3 rounded-[12px] px-3 py-3 text-basic-8 transition-colors",
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
        <GripVertical className="size-4" />
      </button>

      {isEditing ? (
        <>
          <Input
            value={editingName}
            onChange={(event) => onEditingNameChange(event.target.value)}
            className="h-9 flex-1"
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
          <Button type="button" size="icon" variant="default" onClick={() => onSubmitEdit(type)}>
            <Check className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" onClick={onCancelEdit}>
            <X className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-[15px]">{type.name}</span>
          <Button type="button" size="icon" variant="ghost" onClick={() => onStartEdit(type)}>
            <PencilLine className="size-4 text-basic-5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" onClick={() => onDelete(type)}>
            <Trash2 className="size-4 text-danger-6" />
          </Button>
        </>
      )}
    </div>
  );
}

export default function LogoTypeSelect({
  value,
  types,
  onChange,
  onTypesChange,
  onTypeRenamed,
  onTypeDeleted,
  fallbackType,
  disabled,
}: LogoTypeSelectProps) {
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

  async function handleCreateType() {
    const nextName = newTypeName.trim();
    if (!nextName) {
      toast.error("请输入类型名称");
      return;
    }

    startTransition(async () => {
      const result = await createAssetLogoTypeAction(nextName);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      const nextTypes = [...types, result.data.logoType].sort((left, right) => left.sort - right.sort);
      onTypesChange(nextTypes);
      onChange(result.data.logoType.id);
      setIsCreating(false);
      setNewTypeName("");
      setMode("list");
      toast.success("标识类型已创建");
    });
  }

  async function handleRenameType(type: BrandLogoTypeItem) {
    const nextName = editingName.trim();
    if (!nextName) {
      toast.error("请输入类型名称");
      return;
    }

    startTransition(async () => {
      const result = await updateAssetLogoTypeAction(type.id, nextName);
      if (!result.success) {
        toast.error(result.message);
        return;
      }

      onTypesChange(
        types.map((item) => (item.id === type.id ? result.data.logoType : item)),
      );
      onTypeRenamed?.(type.id, result.data.logoType.name);
      setEditingTypeId(null);
      setEditingName("");
      toast.success("标识类型已更新");
    });
  }

  async function handleDeleteType(type: BrandLogoTypeItem) {
    if (!window.confirm(`确认删除类型“${type.name}”？删除后不会影响已存在的品牌标识。`)) {
      return;
    }

    startTransition(async () => {
      const result = await softDeleteAssetLogoTypeAction(type.id);
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
      toast.success("标识类型已删除");
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
      const result = await reorderAssetLogoTypesAction(reordered.map((type) => type.id));
      if (!result.success) {
        onTypesChange(previous);
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-12 w-full items-center justify-between rounded-[12px] border border-basic-4 bg-background px-4 text-left text-sm transition-all",
          "hover:border-primary-5",
          open && "border-primary-5 shadow-[0_0_0_2px_rgba(51,102,255,0.2)]",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className={cn(!selectedType && "text-basic-5")}>
          {selectedType?.name ?? "请选择"}
        </span>
        <ChevronDown className={cn("size-4 text-basic-5 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-2 rounded-[16px] border bg-background p-3 shadow-[0_12px_32px_rgba(31,35,41,0.12)]">
          {mode === "manage" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <button
                  type="button"
                  className="inline-flex items-center text-basic-5 transition-colors hover:text-basic-8"
                  onClick={() => {
                    setMode("list");
                    setEditingTypeId(null);
                    setEditingName("");
                  }}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-[15px] font-semibold text-basic-8">管理类型</span>
              </div>

              <div className="max-h-[260px] overflow-y-auto rounded-[12px] border">
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
                <div className="flex items-center gap-2 border-t pt-3">
                  <Input
                    value={newTypeName}
                    onChange={(event) => setNewTypeName(event.target.value)}
                    placeholder="请输入新类型"
                    className="h-10"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCreateType();
                      }
                    }}
                  />
                  <Button type="button" size="icon" onClick={handleCreateType} disabled={isPending}>
                    {isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      setIsCreating(false);
                      setNewTypeName("");
                    }}
                    disabled={isPending}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  className="inline-flex items-center gap-2 px-1 text-sm text-primary transition-colors hover:text-primary-5"
                >
                  <Plus className="size-4" />
                  新建类型
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="max-h-[260px] overflow-y-auto rounded-[12px] border">
                <div className="space-y-1 p-2">
                  {types.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => {
                        onChange(type.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center rounded-[12px] px-4 py-3 text-left text-[15px] text-basic-8 transition-colors hover:bg-[#eef3ff]",
                        value === type.id && "bg-[#eef3ff]",
                      )}
                    >
                      <span className="truncate">{type.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {isCreating ? (
                <div className="flex items-center gap-2 border-t pt-3">
                  <Input
                    value={newTypeName}
                    onChange={(event) => setNewTypeName(event.target.value)}
                    placeholder="请输入新类型"
                    className="h-10"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCreateType();
                      }
                    }}
                  />
                  <Button type="button" size="icon" onClick={handleCreateType} disabled={isPending}>
                    {isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => {
                      setIsCreating(false);
                      setNewTypeName("");
                    }}
                    disabled={isPending}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between border-t pt-3">
                  <button
                    type="button"
                    onClick={() => setIsCreating(true)}
                    className="inline-flex items-center gap-2 text-sm text-primary transition-colors hover:text-primary-5"
                  >
                    <Plus className="size-4" />
                    新建类型
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("manage")}
                    className="inline-flex items-center gap-2 text-sm text-basic-5 transition-colors hover:text-basic-8"
                  >
                    <Settings className="size-4" />
                    管理
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
