# 开发流程规范（Development Workflow）

## 新功能开发
1. 从 dev 创建 feature 分支
2. 完成功能开发
3. 本地自测
4. 提交 PR 到 dev
5. 集成测试
6. 合并 main

## Bug修复
1. 从 dev 创建 fix 分支
2. 修复问题
3. 验证问题关闭
4. 提交 PR 到 dev
5. 回归测试
6. 发布

## 提交规范
feat: 新功能
fix: 缺陷修复
docs: 文档更新
refactor: 重构
chore: 杂项维护

## 禁止事项
- 直接提交 main
- 未验证即合并
- 跳过代码评审
