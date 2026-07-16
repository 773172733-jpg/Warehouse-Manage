# 数据库权限

## 基本原则

1. 前端隐藏按钮不是权限控制。
2. 前端传入的 `role`、`teamId`、`warehouseId`、`openId`、`userId` 均不可信。
3. `users`、`teams`、`team_members`、`warehouses`、`invites`、`products`、`product_image_assets`、`warehouse_products`、`stock_records` 的客户端读取和写入全部关闭。
4. 云函数使用 `cloud.getWXContext()` 获取可信身份，并由服务端 SDK 访问数据库。
5. 页面不得调用 `wx.cloud.database()` 直接访问核心集合。

## 业务集合的安全规则

在每个集合的“权限管理”中切换到自定义安全规则，并分别保存：

```json
{
  "read": false,
  "write": false
}
```

该规则拒绝小程序客户端访问，不影响云函数和云开发控制台的管理员访问。不要选择“所有用户可读写”。

## 团队成员权限

- `owner`：可读取和刷新邀请码，查看active与pending成员，审核申请，管理admin/viewer；不能移除自己、降级owner或退出团队。
- `admin`：只能查看active成员，可主动退出；不能读取邀请码、查看pending、审核或管理角色。
- `viewer`：只能查看active成员，可主动退出；不能读取邀请码、查看pending或执行成员管理。
- `pending`：只能通过可信身份查看自己的申请状态，不能读取成员列表、邀请码和团队业务数据。

前端传入的`memberId`只用于定位候选成员记录，云函数仍会验证该记录属于可信当前团队。所有写操作使用事务和分action的`requestKey`幂等字段。

## 产品、库存和流水权限

阶段2C3C1新增 `product.image.stage.prepare` 和 `product.image.stage.confirm`，仅owner/admin可调用。客户端只能向prepare下发的随机uploads路径传临时文件，不能写verified目录，也不能直接提交coverFileId。库存写入与流水读取仍是后续阶段契约。

| 能力 | owner | admin | viewer | pending/removed |
| --- | --- | --- | --- | --- |
| 共享产品及当前仓库实例读取 | 允许 | 允许 | 允许 | 拒绝 |
| 新增、编辑共享产品 | 允许 | 允许 | 拒绝 | 拒绝 |
| 当前仓库移除与恢复 | 允许 | 允许 | 拒绝 | 拒绝 |
| 查看共享目录回收站 | 允许 | 拒绝 | 拒绝 | 拒绝 |
| 入库、出库、库存调整 | 允许 | 允许 | 拒绝 | 拒绝 |
| 库存流水列表与详情 | 允许 | 允许 | 允许 | 拒绝 |
| 自定义封面上传或替换 | 允许 | 允许 | 拒绝 | 拒绝 |
| 全局目录删除与恢复 | 允许 | 拒绝 | 拒绝 | 拒绝 |

同时满足以下条件才允许访问：用户为active、成员关系为active、团队为active、仓库为active。disabled/deleted团队、disabled/deleted仓库和pending/removed成员不能继续读取业务数据。

当前仓库移除操作要求stock为0，并在同一事务内将 `warehouse_products` 设为removed、严格递减products.activeWarehouseCount。仓库恢复要求products仍为active，并在同一事务内恢复实例、严格递增计数。全局目录删除只软删除products并更新teams.activeProductCount，事务内要求activeWarehouseCount严格为0。目录恢复不自动恢复warehouse_products。两种删除和恢复都不影响永久流水。

目录删除、目录回收站读取和目录恢复均要求云端从可信active成员关系确认role=owner。admin即使伪造role或直接调用action也返回FORBIDDEN；页面入口和 `canDeleteCatalog` 只是交互提示，云函数事务仍是最终权限边界。

库存变更必须在云函数事务中同时更新 `warehouse_products.stock`、重算 `stockStatus`并写入 `stock_records`。出库不得产生负库存，写操作使用 `requestKey`防重复提交。products不得保存库存字段。

## 响应白名单

- 产品响应由warehouse-api组合products权威主资料与当前warehouse_products库存，不允许前端自行拼接集合。
- 流水可返回产品/单位/操作人快照、变动数量、前后库存、原因、来源去向、备注和时间。
- 不返回 `openId`、内部 `userId`、`teamId`、`warehouseId`、`operatorId`、`createdBy`、`updatedBy`、requestKey、输入哈希或完整数据库文档。
- 共享目录回收站只返回产品展示字段、deletedAt、deletionReason、安全version、activeWarehouseCount和canRestore；仓库回收站的canDeleteCatalog由后端结合可信角色和目录计数生成。
- viewer可通过产品读接口获得active产品封面的临时URL，但无存储写权限。
- 2C3C1通过staged资产接入单张JPG、PNG或WebP封面。云函数下载真实Buffer校验并复制到verified目录后，才允许产品事务绑定；客户端本地路径、任意fileID、云路径和图片元数据均不可信。
- 流水永久保留，普通业务接口不提供修改和删除能力；未来只能做保持审计可查的冷归档。
