import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

interface MatchingSources {
  basicInfo: boolean;
  materializedPath: boolean;
  contentAnalysis: boolean;
  tagKeywords: boolean;
}

interface MatchingStrategySectionProps {
  matchingSources: MatchingSources;
  onSourceChange: (source: keyof MatchingSources, checked: boolean) => void;
}

export function MatchingStrategySection({
  matchingSources,
  onSourceChange,
}: MatchingStrategySectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>匹配策略选择</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex items-center space-x-3">
            <Checkbox
              checked={matchingSources.materializedPath}
              onCheckedChange={(checked) => onSourceChange("materializedPath", checked as boolean)}
            />
            <div>
              <h3 className="font-medium">文件类路径匹配</h3>
              <p className="text-sm text-muted-foreground">基于素材所在的文件类路径进行标签匹配</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Checkbox
              checked={matchingSources.basicInfo}
              onCheckedChange={(checked) => onSourceChange("basicInfo", checked as boolean)}
            />
            <div>
              <h3 className="font-medium">素材名称匹配</h3>
              <p className="text-sm text-muted-foreground">分析文件名称中的关键信息进行匹配</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Checkbox
              checked={matchingSources.contentAnalysis}
              onCheckedChange={(checked) => onSourceChange("contentAnalysis", checked as boolean)}
            />
            <div>
              <h3 className="font-medium">素材内容匹配</h3>
              <p className="text-sm text-muted-foreground">AI 分析文件内容进行智能识别</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Checkbox
              checked={matchingSources.tagKeywords}
              onCheckedChange={(checked) => onSourceChange("tagKeywords", checked as boolean)}
            />
            <div>
              <h3 className="font-medium">标签关键词匹配</h3>
              <p className="text-sm text-muted-foreground">基于现有关键词进行准确匹配</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
