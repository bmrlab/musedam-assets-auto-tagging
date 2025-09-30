"use client";
import { AccessPermission, AccessRole } from "@/app/(tagging)/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { dispatchMuseDAMClientAction } from "@/embed/message";
import { idToSlug } from "@/lib/slug";
import { Building, Check, ChevronDown, GroupIcon, Loader2, Plus, User, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { addAccessPermissionAction, removeAccessPermissionAction } from "./actions";
import { DepartmentIcon, TeamIcon } from "@/components/ui";
import { cn } from "@/lib/utils";

interface AccessClientProps {
  initialPermissions: AccessPermission[];
}

export default function AccessClient({ initialPermissions }: AccessClientProps) {
  const t = useTranslations("Tagging.Access");
  const [permissions, setPermissions] = useState<AccessPermission[]>(initialPermissions);
  const [isPending, startTransition] = useTransition();
  const [isSelecting, setIsSelecting] = useState(false);
  // 默认是可审核权限
  const defaultRole = "reviewer";

  const handleMemberSelection = async () => {
    try {
      setIsSelecting(true);
      const res = await dispatchMuseDAMClientAction("member-selector-modal-open", {
        selectedItems: {
          members: initialPermissions.filter((p) => p.slug.startsWith("u/")).map((p) => ({ id: p.slug.split("/")[1], name: p.name })),
          departments: initialPermissions.filter((p) => p.slug.startsWith("ud/")).map((p) => ({ id: p.slug.split("/")[1], name: p.name })),
          groups: initialPermissions.filter((p) => p.slug.startsWith("ug/")).map((p) => ({ id: p.slug.split("/")[1], name: p.name })),
        }
      });
      if (!res) return;
      const { members, departments, groups } = res;
      const allPermissions: AccessPermission[] = [];
      console.log("member", members)
      // 处理用户 
      if (members && members.length > 0) {
        for (const member of members) {
          allPermissions.push({
            slug: idToSlug("user", member.id),
            name: member.name,
            role: defaultRole,
            extra: {
              avatarUrl: member.avatarUrl,
              departmentsName: member.departmentsName,
            }
          });
        }
      }

      // 处理部门 
      if (departments && departments.length > 0) {
        for (const dept of departments) {
          allPermissions.push({
            slug: idToSlug("department", dept.id),
            name: dept.name,
            role: defaultRole,
          });
        }
      }

      // 处理用户组 
      if (groups && groups.length > 0) {
        for (const group of groups) {
          allPermissions.push({
            slug: idToSlug("group", group.id),
            name: group.name,
            role: defaultRole,
          });
        }
      }

      if (allPermissions.length > 0) {
        // 批量添加权限
        for (const permission of allPermissions) {
          startTransition(async () => {
            const result = await addAccessPermissionAction(permission);
            if (result.success) {
              setPermissions(result.data.permissions);
              toast.success(t("permissionAddedSuccess", { name: permission.name }));
            } else {
              toast.error(t("permissionAddFailed", { name: permission.name }));
            }
          });
        }
      } else {
        toast.info(t("noMembersSelected"));
      }
    } catch (error) {
      console.error("选择成员失败:", error);
      toast.error(t("selectMembersFailed"));
    } finally {
      setIsSelecting(false);
    }
  };

  const handleChangeRole = async (slug: string, newRole: AccessRole) => {
    const permission = permissions.find((p) => p.slug === slug);
    if (!permission) return;

    const updatedPermission: AccessPermission = { ...permission, role: newRole };

    startTransition(async () => {
      const result = await addAccessPermissionAction(updatedPermission);
      if (result.success) {
        setPermissions(result.data.permissions);
        toast.success(
          t("permissionUpdatedSuccess", { name: permission.name, role: getRoleLabel(newRole) }),
        );
      } else {
        toast.error(t("updatePermissionFailed"));
      }
    });
  };

  const handleRemovePermission = (slug: string) => {
    startTransition(async () => {
      const result = await removeAccessPermissionAction(slug);
      if (result.success) {
        setPermissions(result.data.permissions);
        toast.success(t("permissionRemoved"));
      } else {
        toast.error(t("removePermissionFailed"));
      }
    });
  };

  const getPermissionIcon = ({ slug, extra, name }: AccessPermission) => {
    const nameInAvatar = name.slice(0, 1)
    if (extra?.avatarUrl) {
      return <img src={extra.avatarUrl} alt="avatar" width={40} height={40} className='rounded-full object-cover size-9' />
    }
    return <div className="flex size-9 items-center justify-center bg-[#C5CEE0] border border-black/10 border-solid text-white rounded-full text-[14px]">
      {
        slug.startsWith("u/") ? <div className="w-full h-full flex items-center justify-center">{nameInAvatar}</div>
          : slug.startsWith("ug/") ?
            <TeamIcon className="size-[14px] text-current" />
            : <DepartmentIcon className="size-[14px] text-current" />
      }
    </div>
  };

  const getPermissionDes = ({ slug, extra }: AccessPermission) => {
    if (slug.startsWith("u/")) return extra?.departmentsName ? extra.departmentsName : t("user");
    if (slug.startsWith("ug/")) return t("userGroup");
    if (slug.startsWith("ud/")) return t("department");
    return t("unknown");
  };

  const getRoleLabel = (role: AccessRole) => {
    return role === "admin" ? t("canManage") : t("canReview");
  };

  return (
    <div className="bg-background border rounded-lg h-full">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-medium text-sm">{t("roleAndPermissions")}</h3>
        <Button onClick={handleMemberSelection} disabled={isSelecting || isPending} size="sm">
          {isSelecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("selectingMembers")}
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              {t("addMembers")}
            </>
          )}
        </Button>
      </div>
      <div className="px-5 py-[6px]">
        <div className="space-y-0">
          {/* 固定的系统管理员 */}
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="logo" width={40} height={40} className='rounded-full' />
              <div>
                <div className="font-medium text-sm">{t("systemAdmin")}</div>
              </div>
            </div>
            {/*<div className="text-sm text-basic-5 w-20 text-right">可管理</div>*/}
            <Button variant="ghost" size="sm" className="h-8 w-20" disabled={true}>
              <span>{t("canManage")}</span>
              <ChevronDown className="ml-1 h-3 w-3 opacity-0" />
            </Button>
          </div>

          {/* 固定的内容管理员 */}
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="logo" width={40} height={40} className='rounded-full' />
              <div>
                <div className="font-medium text-sm">{t("contentAdmin")}</div>
              </div>
            </div>
            {/*<div className="text-sm text-basic-5 w-20 text-right">可管理</div>*/}
            <Button variant="ghost" size="sm" className="h-8 w-20" disabled={true}>
              <span>{t("canManage")}</span>
              <ChevronDown className="ml-1 h-3 w-3 opacity-0" />
            </Button>
          </div>

          {permissions?.map((permission) => (
            <div
              key={permission.slug}
              className="flex items-center justify-between py-3 border-b"
            >
              <div className="flex items-center gap-3">
                {getPermissionIcon(permission)}
                <div>
                  <div className="font-medium text-sm">{permission.name}</div>
                  <div className="text-xs text-basic-5">
                    {getPermissionDes(permission)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild className="font-normal">
                    <Button variant="ghost" size="sm" className="h-8 w-20 hover:bg-transparent group" disabled={isPending}>
                      <span>{getRoleLabel(permission.role)}</span>
                      <ChevronDown className="size-[14px] text-basic-5 group-hover:text-primary-6 transition-all duration-300 ease-in-out" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[270px]">
                    <DropdownMenuItem
                      onClick={() => handleChangeRole(permission.slug, "admin")}
                      disabled={permission.role === "admin"}
                      className="py-[6px]"
                    >
                      <div className="flex flex-col flex-1">
                        <span className="text-sm">{t("canManage")}</span>
                        <span className="text-xs text-basic-5 mt-[2px]">
                          {t("fullManagementPermission")}
                        </span>
                      </div>
                      {permission.role === "admin" && (
                        <Check className="h-4 w-4 text-primary-6" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleChangeRole(permission.slug, "reviewer")}
                      disabled={permission.role === "reviewer"}
                      className="py-[6px]"
                    >
                      <div className="flex flex-col flex-1">
                        <span className="text-sm">{t("canReview")}</span>
                        <span className="text-xs text-basic-5 mt-[2px]">{t("reviewPermission")}</span>
                      </div>
                      {permission.role === "reviewer" && (
                        <Check className="h-4 w-4 text-primary-6" />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="!text-danger-6 py-[6px] "
                      onClick={() => handleRemovePermission(permission.slug)}
                    >
                      <span className="text-sm">{t("remove")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
