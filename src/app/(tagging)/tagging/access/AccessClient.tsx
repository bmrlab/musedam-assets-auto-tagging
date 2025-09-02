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
import { idToSlug } from "@/lib/slug";
import { dispatchMuseDAMClientAction } from "@/musedam/embed";
import { MuseDAMID } from "@/musedam/types";
import { Building, ChevronDown, Loader2, Plus, User, Users } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addAccessPermissionAction, removeAccessPermissionAction } from "./actions";

interface AccessClientProps {
  initialPermissions: AccessPermission[];
}

interface MemberSelectionResult {
  members: { id: MuseDAMID; name: string }[];
  departments: { id: MuseDAMID; name: string }[];
  groups: { id: MuseDAMID; name: string }[];
}

export default function AccessClient({ initialPermissions }: AccessClientProps) {
  const [permissions, setPermissions] = useState<AccessPermission[]>(initialPermissions);
  const [isPending, startTransition] = useTransition();
  const [isSelecting, setIsSelecting] = useState(false);

  const handleMemberSelection = async () => {
    try {
      setIsSelecting(true);
      const res: MemberSelectionResult = await dispatchMuseDAMClientAction(
        "member-selector-modal-open",
        {},
      );

      const { members, departments, groups } = res;
      const allPermissions: AccessPermission[] = [];

      // 处理用户 - 默认都是可管理权限
      if (members && members.length > 0) {
        for (const member of members) {
          allPermissions.push({
            slug: idToSlug("user", member.id),
            name: member.name,
            role: "admin",
          });
        }
      }

      // 处理部门 - 默认都是可管理权限
      if (departments && departments.length > 0) {
        for (const dept of departments) {
          allPermissions.push({
            slug: idToSlug("department", dept.id),
            name: dept.name,
            role: "admin",
          });
        }
      }

      // 处理用户组 - 默认都是可管理权限
      if (groups && groups.length > 0) {
        for (const group of groups) {
          allPermissions.push({
            slug: idToSlug("group", group.id),
            name: group.name,
            role: "admin",
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
              toast.success(`已添加 ${permission.name} 的权限`);
            } else {
              toast.error(`添加 ${permission.name} 权限失败`);
            }
          });
        }
      } else {
        toast.info("未选择任何成员");
      }
    } catch (error) {
      console.error("选择成员失败:", error);
      toast.error("选择成员失败");
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
        toast.success(`已更新 ${permission.name} 的权限为${getRoleLabel(newRole)}`);
      } else {
        toast.error("更新权限失败");
      }
    });
  };

  const handleRemovePermission = (slug: string) => {
    startTransition(async () => {
      const result = await removeAccessPermissionAction(slug);
      if (result.success) {
        setPermissions(result.data.permissions);
        toast.success("权限已移除");
      } else {
        toast.error("移除权限失败");
      }
    });
  };

  const getPermissionIcon = (slug: string) => {
    if (slug.startsWith("u/")) return <User className="h-4 w-4" />;
    if (slug.startsWith("ug/")) return <Users className="h-4 w-4" />;
    if (slug.startsWith("ud/")) return <Building className="h-4 w-4" />;
    return null;
  };

  const getPermissionType = (slug: string) => {
    if (slug.startsWith("u/")) return "用户";
    if (slug.startsWith("ug/")) return "用户组";
    if (slug.startsWith("ud/")) return "部门";
    return "未知";
  };

  const getRoleLabel = (role: AccessRole) => {
    return role === "admin" ? "可管理" : "可审核";
  };

  return (
    <div className="bg-background border rounded-lg">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h3 className="font-medium text-sm">角色与权限</h3>
        <Button onClick={handleMemberSelection} disabled={isSelecting || isPending} size="sm">
          {isSelecting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              选择成员中...
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              添加成员
            </>
          )}
        </Button>
      </div>
      <div className="p-6">
        <div className="space-y-0">
          {/* 固定的系统管理员 */}
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <div className="text-blue-600">⚡</div>
              </div>
              <div>
                <div className="font-medium">系统管理员</div>
              </div>
            </div>
            {/*<div className="text-sm text-muted-foreground w-20 text-right">可管理</div>*/}
            <Button variant="ghost" size="sm" className="h-8 w-20" disabled={true}>
              <span>可管理</span>
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </div>

          {/* 固定的内容管理员 */}
          <div className="flex items-center justify-between py-3 border-b">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <div className="text-blue-600">⚡</div>
              </div>
              <div>
                <div className="font-medium">内容管理员</div>
              </div>
            </div>
            {/*<div className="text-sm text-muted-foreground w-20 text-right">可管理</div>*/}
            <Button variant="ghost" size="sm" className="h-8 w-20" disabled={true}>
              <span>可管理</span>
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </div>

          {/* 动态权限列表 */}
          {permissions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-b">
              暂无其他权限配置，点击上方&quot;添加成员&quot;按钮开始配置
            </div>
          ) : (
            <>
              {permissions.map((permission) => (
                <div
                  key={permission.slug}
                  className="flex items-center justify-between py-3 border-b"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                      {getPermissionIcon(permission.slug)}
                    </div>
                    <div>
                      <div className="font-medium">{permission.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {getPermissionType(permission.slug)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-20" disabled={isPending}>
                          <span>{getRoleLabel(permission.role)}</span>
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem
                          onClick={() => handleChangeRole(permission.slug, "admin")}
                          disabled={permission.role === "admin"}
                          className="py-3"
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">可管理</span>
                            <span className="text-xs text-muted-foreground">
                              完整管理权限，包括配置和成员管理
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleChangeRole(permission.slug, "reviewer")}
                          disabled={permission.role === "reviewer"}
                          className="py-3"
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">可审核</span>
                            <span className="text-xs text-muted-foreground">
                              可查看和审核打标结果，不可修改配置
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive py-3"
                          onClick={() => handleRemovePermission(permission.slug)}
                        >
                          <span className="text-sm font-medium">移除</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
