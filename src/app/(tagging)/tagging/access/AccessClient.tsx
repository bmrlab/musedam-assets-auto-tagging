"use client";
import { AccessPermission, AccessRole } from "@/app/(tagging)/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { idToSlug } from "@/lib/slug";
import { cn } from "@/lib/utils";
import { dispatchMuseDAMClientAction } from "@/musedam/embed";
import { MuseDAMID } from "@/musedam/types";
import { Building, Loader2, Plus, Trash2, User, Users } from "lucide-react";
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
  const [selectedRole, setSelectedRole] = useState<AccessRole>("reviewer");

  const handleMemberSelection = async () => {
    try {
      setIsSelecting(true);
      const res: MemberSelectionResult = await dispatchMuseDAMClientAction(
        "member-selector-modal-open",
        {},
      );

      const { members, departments, groups } = res;
      const allPermissions: AccessPermission[] = [];

      // 处理用户
      if (members && members.length > 0) {
        for (const member of members) {
          allPermissions.push({
            slug: idToSlug("user", member.id),
            name: member.name,
            role: selectedRole,
          });
        }
      }

      // 处理部门
      if (departments && departments.length > 0) {
        for (const dept of departments) {
          allPermissions.push({
            slug: idToSlug("department", dept.id),
            name: dept.name,
            role: selectedRole,
          });
        }
      }

      // 处理用户组
      if (groups && groups.length > 0) {
        for (const group of groups) {
          allPermissions.push({
            slug: idToSlug("group", group.id),
            name: group.name,
            role: selectedRole,
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

  const getRoleDescription = (role: AccessRole) => {
    return role === "admin" ? "拥有所有功能的访问权限" : "仅可访问审核页面";
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">权限管理</h1>
        <p className="mt-2 text-muted-foreground">管理谁可以访问自动标签功能</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>添加权限</CardTitle>
          <CardDescription>选择成员并设置其权限级别</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label>权限级别</Label>
            <RadioGroup
              value={selectedRole}
              onValueChange={(v) => setSelectedRole(v as AccessRole)}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="reviewer" id="reviewer" />
                <Label htmlFor="reviewer" className="font-normal cursor-pointer">
                  <div>
                    <div className="font-medium">可审核</div>
                    <div className="text-sm text-muted-foreground">
                      {getRoleDescription("reviewer")}
                    </div>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="admin" id="admin" />
                <Label htmlFor="admin" className="font-normal cursor-pointer">
                  <div>
                    <div className="font-medium">可管理</div>
                    <div className="text-sm text-muted-foreground">
                      {getRoleDescription("admin")}
                    </div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Button
            onClick={handleMemberSelection}
            disabled={isSelecting || isPending}
            className="w-full sm:w-auto"
          >
            {isSelecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                选择成员中...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                选择成员
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前权限</CardTitle>
          <CardDescription>已配置的访问权限列表</CardDescription>
        </CardHeader>
        <CardContent>
          {permissions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">暂无权限配置</div>
          ) : (
            <div className="space-y-2">
              {permissions.map((permission) => (
                <div
                  key={permission.slug}
                  className={cn(
                    "flex items-center justify-between rounded-lg border p-3",
                    "hover:bg-accent/50 transition-colors",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                      {getPermissionIcon(permission.slug)}
                    </div>
                    <div>
                      <div className="font-medium">{permission.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {getPermissionType(permission.slug)} · {getRoleLabel(permission.role)}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemovePermission(permission.slug)}
                    disabled={isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
