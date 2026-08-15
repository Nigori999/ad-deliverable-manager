# AD Deliverable Manager 分支管理规范

## 分支模型

```text
main
 │
 └── dev
       │
       ├── feature/*
       ├── fix/*
       └── hotfix/*
```

## 分支职责

### main
- 生产发布分支
- 必须保持可构建、可部署、可发布
- 禁止直接开发和直接提交
- 仅允许通过 PR 合并

### dev
- 开发集成分支
- 用于联调、集成测试、版本验收
- 所有功能和缺陷修复先进入 dev

### feature/*
- 新功能开发分支
- 必须从 dev 创建
- 命名示例：feature/product-baseline

### fix/*
- 普通缺陷修复分支
- 必须从 dev 创建
- 命名示例：fix/dashboard-loading

### hotfix/*
- 线上紧急修复分支
- 必须从 main 创建
- 命名示例：hotfix/login-failure

## 开发流程

### 新功能

```text
dev
 ↓
feature/*
 ↓
开发+自测
 ↓
PR → dev
 ↓
集成测试
 ↓
PR → main
```

### 缺陷修复

```text
dev
 ↓
fix/*
 ↓
修复+自测
 ↓
PR → dev
 ↓
回归测试
 ↓
PR → main
```

### 紧急修复

```text
main
 ↓
hotfix/*
 ↓
修复验证
 ↓
PR → main
 ↓
同步回 dev
```

## PR 规范

### Feature
- feat: 新增产品基线管理
- feat: 新增测试报告管理

### Fix
- fix: 修复交付物详情加载问题
- fix: 修复 DataScope 过滤问题

### Hotfix
- hotfix: 修复登录异常
- hotfix: 修复权限失效问题

## 分支清理

发布完成后删除：
- feature/*
- fix/*
- hotfix/*

长期保留：
- main
- dev

## 原则

Main 负责发布
Dev 负责集成
Feature/Fix 负责开发
Hotfix 负责救火
