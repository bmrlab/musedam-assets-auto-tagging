import { Tag, TagGroup } from "./tag";

export function TagExamples() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">基础标签</h3>
        <TagGroup>
          <Tag>默认标签</Tag>
          <Tag variant="secondary">次要标签</Tag>
          <Tag variant="outline">轮廓标签</Tag>
          <Tag variant="destructive">危险标签</Tag>
          <Tag variant="success">成功标签</Tag>
          <Tag variant="warning">警告标签</Tag>
          <Tag variant="info">信息标签</Tag>
          <Tag variant="purple">紫色标签</Tag>
        </TagGroup>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">不同尺寸</h3>
        <TagGroup>
          <Tag size="sm">小标签</Tag>
          <Tag size="default">默认标签</Tag>
          <Tag size="lg">大标签</Tag>
        </TagGroup>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">不同形状</h3>
        <TagGroup>
          <Tag shape="rounded">圆角标签</Tag>
          <Tag shape="pill">胶囊标签</Tag>
          <Tag shape="square">方形标签</Tag>
        </TagGroup>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">可移除标签</h3>
        <TagGroup>
          <Tag removable onRemove={() => alert("移除标签")}>
            可移除标签
          </Tag>
          <Tag variant="purple" removable onRemove={() => alert("移除推荐标签")}>
            推荐
          </Tag>
        </TagGroup>
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">标签组间距</h3>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-2">小间距</p>
            <TagGroup spacing="sm">
              <Tag>标签1</Tag>
              <Tag>标签2</Tag>
              <Tag>标签3</Tag>
            </TagGroup>
          </div>
          <div>
            <p className="text-sm text-gray-600 mb-2">默认间距</p>
            <TagGroup spacing="default">
              <Tag>标签1</Tag>
              <Tag>标签2</Tag>
              <Tag>标签3</Tag>
            </TagGroup>
          </div>
          <div>
            <p className="text-sm text-gray-600 mb-2">大间距</p>
            <TagGroup spacing="lg">
              <Tag>标签1</Tag>
              <Tag>标签2</Tag>
              <Tag>标签3</Tag>
            </TagGroup>
          </div>
        </div>
      </div>
    </div>
  );
}
