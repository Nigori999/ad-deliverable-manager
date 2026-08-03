# 智驾中心交付物管理系统

一个轻量级、单项目部署的交付物管理网页应用：ASP.NET Core 10 同时承载前端静态页面、内部业务路由和 SQLite 数据库访问。

## V1.0 功能

- 仪表盘：交付物、版本、变更统计和趋势图
- 交付物台账：查询、筛选、录入、详情查看
- 交付物分类：硬件软件包、PRD、FR、测试用例
- 版本管理：草稿、评审中、发布、替代、废止
- 统一编码和统一文件名自动生成
- 原始名称、原始版本和服务器文件路径保留
- 各类型专属字段
- 变更管理：发起、评估、实施、验证、关闭
- 项目/车型基础数据维护
- SQLite 自动建库和启动备份
- 原生 HTML/CSS/JavaScript，不依赖 Node.js、Vue、React 或在线 CDN

## 技术结构

```text
ASP.NET Core 10 单项目
├─ wwwroot：HTML / CSS / JavaScript
├─ Controllers：仅供本网页使用的内部业务路由
├─ Services：SQLite数据访问、版本规则和备份
├─ Data/schema.sql：建表与初始基础数据
└─ data/deliverables.db：运行后自动生成
```

项目不启用 Swagger，也不规划对外开放 API。`/internal/*` 路由仅用于本系统网页和后端之间的数据交互。

## 开发运行

前提：开发电脑安装 .NET 10 SDK。

```bash
dotnet restore
dotnet run
```

默认访问：`http://localhost:5078`

## 发布 Windows 64 位免运行时版本

双击：

```text
publish-win-x64.bat
```

或执行：

```bash
dotnet publish -c Release -r win-x64 --self-contained true \
  -p:PublishSingleFile=true \
  -p:IncludeNativeLibrariesForSelfExtract=true \
  -p:PublishTrimmed=false \
  -o publish/win-x64
```

发布目录中的程序包含 .NET 运行时。同事无需安装 .NET、SQLite、IIS、Node.js 或数据库软件。

## 运行模式

### 单机模式

保持 `appsettings.json`：

```json
"AllowLanAccess": false
```

双击 `AdDeliverableManager.exe` 或 `start.bat`。

### 局域网共享模式

在指定主机上修改：

```json
"AllowLanAccess": true
```

其他同事通过以下地址访问：

```text
http://主机IP:5078
```

还需在 Windows 防火墙中允许 TCP 5078 端口。SQLite 数据库必须保留在运行后端的这台电脑本地磁盘，不要把 `.db` 文件放到网络共享目录供多台电脑直接打开。

## 数据与文件

- 实际软件包、PRD、FR、测试用例继续存放在文件服务器。
- SQLite 只保存元数据、版本、变更、状态和文件服务器路径。
- `data/*.db`、备份和日志默认不提交到 Git。
- 启动时会自动创建数据库并执行基础数据初始化。

## 当前限制

- 当前未实现正式账号登录和分角色权限。
- 当前不上传或下载大型实际文件，只记录和复制服务器路径。
- 当前使用 `Ensure schema` 方式初始化，不依赖 EF Core Migration。
- 当前代码需要在具备 .NET 10 SDK 和 NuGet 网络的开发机上完成最终编译验证。
