# 轻仓｜微信小程序仓库管理器

阶段0目标是建立微信原生小程序、CloudBase 统一云函数入口、基础页面、基础组件、服务层和数据设计文档。当前版本不实现正式库存、产品、团队或成员业务。

## 技术栈

- 微信原生小程序
- 微信云开发 CloudBase
- JavaScript

## 目录

- `miniprogram/`：小程序端代码
- `cloudfunctions/api/`：统一云函数入口
- `database/`：集合、索引和权限规划
- `docs/`：项目架构、数据模型、权限矩阵和验收文档

## 本地配置

1. 复制 `project.private.config.json.example` 为 `project.private.config.json`，填写真实 AppID。
2. 如需指定云环境，在 `miniprogram/config/env.js` 中填写 `DB_ENV`。
3. `DB_ENV` 为空时，小程序使用云开发默认环境初始化，避免占位环境 ID 导致启动失败。

## 阶段0范围

已包含：

- startup 启动页
- 库存、记录、团队、我的四个 tab 页
- loading、empty、error 基础组件
- 前端 `services`、`constants`、`utils` 基础层
- 云函数 `api` 和 `system.ping`
- 数据库与权限规划文档

暂不包含：

- 产品列表、搜索、新增、编辑
- 入库、出库、库存调整
- 真实团队创建、邀请成员
- 微信头像昵称授权
- 图片上传、统计图表、Excel 导入导出、订阅消息

## 导入微信开发者工具

选择“导入项目”，项目目录选择本目录，AppID 可先使用测试号或填写真实 AppID。导入后从 `pages/startup/startup` 编译，启动页会初始化本地占位用户状态并跳转到库存 tab。
