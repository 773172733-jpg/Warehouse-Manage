# 数据库权限

## 基本原则

1. 前端隐藏按钮不是权限控制。
2. 前端传入的 `role`、`teamId`、`warehouseId`、`openId`、`userId` 均不可信。
3. `users`、`teams`、`team_members`、`warehouses`、`invites` 以及后续 `products`、`stock_records` 的客户端读取和写入全部关闭。
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

| 能力 | owner | admin | viewer | pending/removed |
| --- | --- | --- | --- | --- |
| active产品列表与详情 | 允许 | 允许 | 允许 | 拒绝 |
| 新增、编辑、软删除产品 | 允许 | 允许 | 拒绝 | 拒绝 |
| 入库、出库、库存调整 | 允许 | 允许 | 拒绝 | 拒绝 |
| 库存流水列表与详情 | 允许 | 允许 | 允许 | 拒绝 |
| 自定义封面上传或替换 | 允许 | 允许 | 拒绝 | 拒绝 |

同时满足以下条件才允许访问：用户为active、成员关系为active、团队为active、仓库为active。disabled/deleted团队、disabled/deleted仓库和pending/removed成员不能继续读取业务数据。

deleted产品默认不返回详情，也不能执行库存操作；历史流水继续通过产品和操作人快照读取。产品有库存时禁止软删除。

库存变更必须在云函数事务中同时更新 `products.stock`、重算 `stockStatus`并写入 `stock_records`。出库不得产生负库存，写操作使用 `requestKey`防重复提交。

## 响应白名单

- 产品可返回展示字段、库存、最低库存、库存状态、封面临时URL和时间。
- 流水可返回产品/单位/操作人快照、变动数量、前后库存、原因、来源去向、备注和时间。
- 不返回 `openId`、内部 `userId`、`teamId`、`warehouseId`、`operatorId`、`createdBy`、`updatedBy`、requestKey、输入哈希或完整数据库文档。
- viewer可通过产品读接口获得active产品封面的临时URL，但无存储写权限。
