# Design: 抖音爆款库来源

## 1. 数据模型

`viral_library` 新增：

```sql
industry TEXT DEFAULT ''
```

迁移路径：
- 新建库：`store-schema.js` 建表 DDL 自带。
- 旧库：`store-schema.js migrateKnowledgeEvolutionSchema` + `creator-schema.js` 的列检查各补一条 `ALTER TABLE`，重复执行幂等。

`addViralItem/updateViralItem` 的 INSERT/UPDATE 都写 industry；`parseViralRow` 直接透传。

## 2. 查询过滤

`listViralItems(opts)` 新增：

| 参数 | SQL |
| --- | --- |
| `platform` | `platform = ?` |
| `industry` | `industry = ?` |
| `minLikes` | `likes >= ?` |

过滤条件与 search 以 AND 组合；无参数时行为不变（回归锁 U-107b）。

## 3. 来源适配

`workflow-source.js`：

```js
normalizeDouyinViral(item) -> {
  sourceType:'douyinViral', platform:'douyin',
  externalId, title, content, summary, url, coverImage, publishedAt,
  needsCollect:false, needsGeneration:false,
  meta:{ industry, likes, collections, comments, author }
}
```

`collectDouyinViral` 调 `deps.viralLibrary.listViral`，按 `sort` 映射：
- `score` → `sortBy:'likes'`
- `latest` → `sortBy:'created_at'`

无服务时返回 warning，不拖垮其他来源；无数据返回空 items，由运行摘要显示 0。

## 4. Schema / UI

- `SOURCE_TYPES` 加 `douyinViral`；`SOURCE_LABELS` 加「抖音爆款库」。
- `VIRAL_INDUSTRIES` 从共享 JSON 读取（fallback 内置），`getWorkflowMeta` 输出 `viralIndustries`。
- 校验：industry 必须在枚举内；limit 1–50；minLikes 0–10,000,000 的整数。
- `WorkflowEditor` 分支：行业下拉、条数、最低点赞、说明文案。
- `ViralFormDialog` 行业下拉；`ViralLibraryTable` 增加行业列。

## 5. 错误与提示

| 场景 | 行为 |
| --- | --- |
| 未选行业 | `source.industry: unknown`，保存被拦截 |
| 爆款库服务未装配 | 运行 warning「爆款库服务未装配」，不崩溃 |
| 过滤结果为空 | items=[]，运行摘要 collected=0；用户回爆款库采集 |
| 旧数据无 industry | 不会被新来源选中（数据质量门禁） |

## 6. 测试

- `workflow-schema.test.js`：枚举/校验边界。
- `workflow-source.test.js`：查询参数与归一化。
- `knowledge-library-store.viral.test.js`：SQL 过滤/参数。
- `WorkflowEditor.test.js`：切换来源渲染行业/最低点赞。
- `ViralFormDialog.label-association.test.js`：行业 label 接线。
