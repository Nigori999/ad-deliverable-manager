# GitHub Actions 使用说明

仓库长期只保留一个工作流：**Windows 构建与发布**。

## 工作流何时运行

- 向`main`发起或更新Pull Request时自动运行，用于验证尚未合并的新功能。
- 代码合并到`main`后自动运行，用于生成正式稳定版本发布包。
- 也可以在Actions页面点击`Run workflow`手动运行指定分支。

## 功能测试应该下载哪个包

### 测试PR中的新功能

1. 进入`Actions`。
2. 选择`Windows 构建与发布`。
3. 打开对应PR最新一次、状态为绿色成功的运行记录。
4. 在页面底部`Artifacts`下载`AdDeliverableManager-win-x64`。

不要下载较早运行记录中的包，因为较早的包可能不包含最新修复。

### 测试已合并的正式版本

选择由`main`分支触发的最新绿色成功运行，再下载同名Artifact。

## 页面中的历史工作流

`build`、`V0.6 validation`和`cleanup temporary branches`可能仍出现在历史运行记录中：

- `build`已改名并规整为`Windows 构建与发布`。
- `V0.6 validation`的工作流文件已删除，不会再产生新运行。
- `cleanup temporary branches`是一次性清理任务，工作流文件和临时分支均已删除，不会再运行。

GitHub会保留历史运行记录，因此旧名称可能暂时继续显示。这些历史记录无需处理，也不应再用于下载测试包。

## 构建内容

工作流会依次执行：

1. 检出源码。
2. 配置.NET 10。
3. 还原项目依赖。
4. 执行Release编译。
5. 生成Windows x64自包含发布目录。
6. 生成构建摘要和EXE SHA-256。
7. 上传`AdDeliverableManager-win-x64`发布包，保留30天。
