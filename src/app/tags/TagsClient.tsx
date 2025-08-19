"use client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExtractServerActionData } from "@/lib/serverAction";
import { Tag } from "@/prisma/client";
import { ChevronRight, Tag as TagIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchTeamTags } from "./actions";

interface TagWithChildren extends Tag {
  parent?: Tag | null;
  children?: TagWithChildren[];
}

interface TagsClientProps {
  initialTags: ExtractServerActionData<typeof fetchTeamTags>["tags"];
}

export default function TagsClient({ initialTags }: TagsClientProps) {
  const [tags, setTags] = useState<TagWithChildren[]>(initialTags);
  const [selectedLevel1, setSelectedLevel1] = useState<TagWithChildren | null>(null);
  const [selectedLevel2, setSelectedLevel2] = useState<TagWithChildren | null>(null);
  const [selectedLevel3, setSelectedLevel3] = useState<TagWithChildren | null>(null);

  // 获取不同层级的标签
  const level1Tags = tags.filter((tag) => tag.level === 1);
  const level2Tags = selectedLevel1?.children || [];
  const level3Tags = selectedLevel2?.children || [];

  const handleLevel1Click = (tag: TagWithChildren) => {
    setSelectedLevel1(tag);
    setSelectedLevel2(null);
    setSelectedLevel3(null);
  };

  const handleLevel2Click = (tag: TagWithChildren) => {
    setSelectedLevel2(tag);
    setSelectedLevel3(null);
  };

  const handleLevel3Click = (tag: TagWithChildren) => {
    setSelectedLevel3(tag);
  };

  const refreshTags = async () => {
    const result = await fetchTeamTags();
    if (result.success) {
      setTags(result.data.tags);
    }
  };

  useEffect(() => {
    // 如果选中的一级标签不在当前标签列表中，清除选择
    if (selectedLevel1 && !level1Tags.find((tag) => tag.id === selectedLevel1.id)) {
      setSelectedLevel1(null);
      setSelectedLevel2(null);
      setSelectedLevel3(null);
    }
  }, [tags, selectedLevel1, level1Tags]);

  return (
    <div className="space-y-6">
      {/* 标题和操作栏 */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">标签管理</h1>
          <p className="text-muted-foreground">管理团队的三级标签体系</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={refreshTags} variant="outline">
            刷新
          </Button>
          <Button>新建标签</Button>
        </div>
      </div>

      {/* 面包屑导航 */}
      {(selectedLevel1 || selectedLevel2 || selectedLevel3) && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedLevel1(null);
              setSelectedLevel2(null);
              setSelectedLevel3(null);
            }}
          >
            所有标签
          </Button>
          {selectedLevel1 && (
            <>
              <ChevronRight className="h-4 w-4" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedLevel2(null);
                  setSelectedLevel3(null);
                }}
              >
                {selectedLevel1.name}
              </Button>
            </>
          )}
          {selectedLevel2 && (
            <>
              <ChevronRight className="h-4 w-4" />
              <Button variant="ghost" size="sm" onClick={() => setSelectedLevel3(null)}>
                {selectedLevel2.name}
              </Button>
            </>
          )}
          {selectedLevel3 && (
            <>
              <ChevronRight className="h-4 w-4" />
              <span className="font-medium text-foreground">{selectedLevel3.name}</span>
            </>
          )}
        </div>
      )}

      {/* 三列标签展示 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 第一列：一级标签 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              一级标签
              <span className="text-sm font-normal text-muted-foreground">
                ({level1Tags.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {level1Tags.length === 0 ? (
              <p className="text-muted-foreground text-sm">暂无一级标签</p>
            ) : (
              level1Tags.map((tag) => (
                <Button
                  key={tag.id}
                  variant={selectedLevel1?.id === tag.id ? "default" : "ghost"}
                  className="w-full justify-between"
                  onClick={() => handleLevel1Click(tag)}
                >
                  <span>{tag.name}</span>
                  {tag.children && tag.children.length > 0 && (
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                      {tag.children.length}
                    </span>
                  )}
                </Button>
              ))
            )}
          </CardContent>
        </Card>

        {/* 第二列：二级标签 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              二级标签
              <span className="text-sm font-normal text-muted-foreground">
                ({level2Tags.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedLevel1 ? (
              <p className="text-muted-foreground text-sm">请先选择一级标签</p>
            ) : level2Tags.length === 0 ? (
              <p className="text-muted-foreground text-sm">该一级标签下暂无二级标签</p>
            ) : (
              level2Tags.map((tag) => (
                <Button
                  key={tag.id}
                  variant={selectedLevel2?.id === tag.id ? "default" : "ghost"}
                  className="w-full justify-between"
                  onClick={() => handleLevel2Click(tag)}
                >
                  <span>{tag.name}</span>
                  {tag.children && tag.children.length > 0 && (
                    <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded">
                      {tag.children.length}
                    </span>
                  )}
                </Button>
              ))
            )}
          </CardContent>
        </Card>

        {/* 第三列：三级标签 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              三级标签
              <span className="text-sm font-normal text-muted-foreground">
                ({level3Tags.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!selectedLevel2 ? (
              <p className="text-muted-foreground text-sm">请先选择二级标签</p>
            ) : level3Tags.length === 0 ? (
              <p className="text-muted-foreground text-sm">该二级标签下暂无三级标签</p>
            ) : (
              level3Tags.map((tag) => (
                <Button
                  key={tag.id}
                  variant={selectedLevel3?.id === tag.id ? "default" : "ghost"}
                  className="w-full justify-start"
                  onClick={() => handleLevel3Click(tag)}
                >
                  {tag.name}
                </Button>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* 统计信息 */}
      <Card>
        <CardHeader>
          <CardTitle>标签统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {level1Tags.length}
              </div>
              <div className="text-sm text-muted-foreground">一级标签</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {tags.filter((tag) => tag.level === 2).length}
              </div>
              <div className="text-sm text-muted-foreground">二级标签</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                {tags.filter((tag) => tag.level === 3).length}
              </div>
              <div className="text-sm text-muted-foreground">三级标签</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                {tags.length}
              </div>
              <div className="text-sm text-muted-foreground">总标签数</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
