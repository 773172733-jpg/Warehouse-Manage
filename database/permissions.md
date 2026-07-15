# 数据库权限

## 基本原则

1. 前端隐藏按钮不是权限控制。
2. 前端传入的 `role`、`teamId`、`warehouseId`、`openId`、`userId` 均不可信。
3. `users`、`teams`、`team_members`、`warehouses`、`invites` 的客户端读取和写入全部关闭。
4. 云函数使用 `cloud.getWXContext()` 获取可信身份，并由服务端 SDK 访问数据库。
5. 页面不得调用 `wx.cloud.database()` 直接访问核心集合。

## 五个集合的安全规则

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

## 后续库存一致性

库存变更必须在云函数中完成。后续实现时，需要在一次服务端流程中同时校验权限、更新产品库存、写入 `stock_records`，并使用 `requestKey` 防止重复提交。
