# 轻仓｜微信小程序仓库管理器

当前进入阶段2C2B2：产品创建、库存首页和产品详情已接入真实 `product.create/list/detail`。首页支持cursor分页、云端搜索、分类/库存状态筛选和创建返回刷新；详情组合权威产品主资料、当前仓库库存及真实权限。产品编辑、库存操作和真实流水仍按后续阶段实施。

## 技术栈

- 微信原生小程序
- 微信云开发 CloudBase
- JavaScript

## 目录

- `miniprogram/`：小程序端代码
- `cloudfunctions/warehouse-api/`：仓库管理器独立统一云函数入口
- `database/`：集合、索引和权限规划
- `docs/`：项目架构、数据模型、权限矩阵和验收文档

云端阶段文档：

- [`docs/阶段2A云端架构.md`](docs/阶段2A云端架构.md)
- [`docs/阶段2A部署与验收.md`](docs/阶段2A部署与验收.md)
- [`docs/阶段2B1团队邀请与成员权限.md`](docs/阶段2B1团队邀请与成员权限.md)
- [`docs/阶段2B1部署与验收.md`](docs/阶段2B1部署与验收.md)
- [`docs/阶段2B2A加入团队页面.md`](docs/阶段2B2A加入团队页面.md)
- [`docs/阶段2B2A部署与验收.md`](docs/阶段2B2A部署与验收.md)
- [`docs/阶段2B2B1真实邀请码与审核界面.md`](docs/阶段2B2B1真实邀请码与审核界面.md)
- [`docs/阶段2B2B1部署与验收.md`](docs/阶段2B2B1部署与验收.md)
- [`docs/阶段2B2B2成员管理与退出团队.md`](docs/阶段2B2B2成员管理与退出团队.md)
- [`docs/阶段2B2B2部署与验收.md`](docs/阶段2B2B2部署与验收.md)
- [`docs/阶段2C1产品库存与流水架构.md`](docs/阶段2C1产品库存与流水架构.md)
- [`docs/阶段2C1接口契约.md`](docs/阶段2C1接口契约.md)
- [`docs/阶段2C1实施拆分与迁移.md`](docs/阶段2C1实施拆分与迁移.md)
- [`docs/阶段2C2A产品目录云端核心.md`](docs/阶段2C2A产品目录云端核心.md)
- [`docs/阶段2C2A部署与验收.md`](docs/阶段2C2A部署与验收.md)
- [`docs/阶段2C2B1产品创建页面接入.md`](docs/阶段2C2B1产品创建页面接入.md)
- [`docs/阶段2C2B1部署与验收.md`](docs/阶段2C2B1部署与验收.md)
- [`docs/阶段2C2B2真实库存首页与产品详情.md`](docs/阶段2C2B2真实库存首页与产品详情.md)
- [`docs/阶段2C2B2部署与验收.md`](docs/阶段2C2B2部署与验收.md)
- [`database/collections.md`](database/collections.md)
- [`database/indexes.md`](database/indexes.md)
- [`database/permissions.md`](database/permissions.md)

## 本地配置

1. 项目正式 AppID 为 `wxd5819a772c90b7a2`。
2. 独立 CloudBase 环境 ID 为 `cloud1-d8gm59cz2be4e7c23`。
3. 统一云函数名称为 `warehouse-api`。
4. `project.private.config.json` 仅保存本机编译偏好并被 Git 忽略。
5. 部署前阅读 [`docs/云环境隔离与部署说明.md`](docs/云环境隔离与部署说明.md)。

## 当前范围

已包含：

- startup 启动页
- 库存、记录、团队、我的四个 tab 页
- loading、empty、error 基础组件
- 前端 `services`、`constants`、`utils` 基础层
- 云函数 `warehouse-api` 的身份、团队、邀请、申请和成员管理白名单接口
- `users`、`teams`、`team_members`、`warehouses`、`invites` 数据模型和权限规划
- 无团队用户的首次团队创建流程
- owner邀请与成员管理、admin/viewer成员查看及主动退出的云端service
- 无团队用户的邀请码申请、待审核/拒绝状态和审核通过后身份刷新流程
- owner真实邀请码生成、pending批准/拒绝及全角色真实active成员页面
- owner将viewer升级为admin、将admin降为viewer及移除active成员
- admin/viewer主动退出团队、统一团队上下文清理及startup重新路由
- 阶段2C1团队级products共享目录、warehouse_products仓库余额、永久流水和多仓设计
- 产品、库存、流水接口契约、错误码、索引与mock页面分阶段迁移方案
- 当前仓库产品软删除回收站与恢复、99,999目录上限和2MB图片生命周期规则
- searchKeywords只能由warehouse-api服务端生成，前端禁止提交searchKeywords/normalizedName/normalizedCode
- 全局目录删除与恢复UI定于2C3B，仅owner可操作，不阻塞2C2
- 99,999压测定于2C5，使用独立测试环境；2C2只完成游标分页、事务限额和必要索引
- `products`、`warehouse_products`、`stock_records` 云端模型及全部客户端直访关闭方案
- `product.create/list/detail` 静态白名单路由、可信身份复核和字段脱敏
- 服务端名称/编号规范化、受控searchKeywords、库存状态和封面校验纯函数
- 创建产品、默认仓库实例、可选initial流水及teams计数的单事务写入
- `miniprogram/services/product-service.js` 请求白名单封装
- 三步产品创建页真实接入 `product.create`，网络失败可按同一requestKey安全重试
- owner/admin新增入口和路由权限检查，viewer保持只读
- 本地图片只保留预览并在保存前明确阻断，未向数据库提交临时路径
- 库存首页真实接入 `product.list`，支持20条cursor分页、搜索防抖和过时响应隔离
- 分类与库存状态使用云端筛选，摘要数字明确限定为当前已加载真实数据
- 产品卡片通过真实warehouseProductId进入 `product.detail`，组合主资料、库存和权限
- viewer可读但不显示写入口，未实现操作只提示后续阶段且不修改本地数据
- mock产品和mock流水已从库存首页与详情页运行路径移除

暂不包含：

- 产品编辑及当前仓库移除/恢复接口
- 真实入库、出库、库存调整和库存流水接口
- 邀请二维码、微信分享卡片和owner转让
- 团队解散、多团队切换和实时成员状态推送
- 微信头像昵称授权
- 图片上传、统计图表、Excel 导入导出、订阅消息

## 导入微信开发者工具

选择“导入项目”，项目目录选择本目录。确认开发者工具显示轻仓正式 AppID 和独立 CloudBase 环境后，从 `pages/startup/startup` 编译。无申请的新用户进入团队创建页；pending用户进入加入团队状态页；active团队用户进入库存tab。
