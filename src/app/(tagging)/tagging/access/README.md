```
2. 成员选择器
action: member-selector-modal-open
args 类型:
{
    selectedItems?: {
        members?: Array<{ id: string; name: string }>;
        departments?: Array<{ id: string; name: string }>;
        groups?: Array<{ id: string; name: string }>;
    };
    theme?: 'light' | 'dark';
}
result.data 类型:
{
    members: Array<{ id: string; name: string }>;
    departments: Array<{ id: string; name: string }>;
    groups: Array<{ id: string; name: string }>;
}
示例:
// 请求
{
    action: "member-selector-modal-open",
    args: {
        selectedItems: {
            members: [{ id: "user_123", name: "张三" }],
            departments: [{ id: "dept_001", name: "设计部" }]
        },
        theme: 'light'
    }
}

// 成功响应
{
    result: {
        success: true,
        data: {
            members: [
                { id: "user_123", name: "张三" },
                { id: "user_456", name: "李四" }
            ],
            departments: [{ id: "dept_001", name: "设计部" }],
            groups: []
        }
    }
}

// 取消响应
{
    result: {
        success: false,
        message: "用户取消操作"
    }
}
```
