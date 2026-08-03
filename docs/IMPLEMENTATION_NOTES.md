# V1.0 实现说明

## 1. 已确认的技术决策

1. 一个 ASP.NET Core 10 项目同时承载前端、后端和 SQLite 数据访问。
2. 前端采用原生 HTML、CSS、JavaScript，图表使用 Canvas 绘制。
3. 不使用 Node.js、npm、前端构建工具或在线 CDN。
4. 不建设开放 API，不启用 Swagger；内部路由统一使用 `/internal` 前缀。
5. 数据访问使用 `Microsoft.Data.Sqlite`，不额外引入 EF Core 和迁移工具。
6. 实际交付物保存在文件服务器，系统只保存索引与元数据。
7. 发布采用 win-x64 self-contained single-file。

## 2. 交付物核心模型

```text
Deliverables（主档）
    └─ DeliverableVersions（版本）
        ├─ HardwarePackageDetails
        ├─ PrdDetails
        ├─ FrDetails
        └─ TestCaseDetails
```

交付物主档保存稳定属性；版本表保存文件名称、服务器路径、版本状态和发布快照。历史版本不覆盖、不物理删除。

## 3. 生命周期

```text
DRAFT → IN_REVIEW → RELEASED → SUPERSEDED / DEPRECATED
```

- 发布新版本时，原当前版本自动变为 `SUPERSEDED`。
- `DEPRECATED` 表示禁止继续使用。
- 同一交付物最多只有一个 `IsCurrent=1` 的版本。

## 4. 内部路由

这些路由只服务本网页，不作为第三方开放接口：

```text
/internal/dashboard
/internal/master-data
/internal/deliverables
/internal/changes
/internal/system
```

## 5. 下一阶段建议

1. 在真实 Windows 10/11 x64 环境完成 restore、build、publish 和启动测试。
2. 根据实际文件服务器目录完善路径校验规则。
3. 增加CSV批量导入历史台账。
4. 增加账号登录、角色权限和发布审批人约束。
5. 增加交付物关系维护页面，形成 PRD → FR → 测试用例追溯。
6. 增加项目应交付清单，计算项目交付物完整率。
