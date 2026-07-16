# 集合设计

阶段2C1只定稿产品、库存和流水架构，不创建集合。当前云端继续使用 `users`、`teams`、`team_members`、`warehouses`、`invites`；`products` 和 `stock_records` 等到2C2按部署文档人工创建，以保证带初始库存的产品创建能原子写入initial流水。代码不会自动创建集合、索引或权限。

## users

用户身份只由 `cloud.getWXContext()` 的可信 OPENID 建立。OPENID 仅保存在云端，不返回客户端。

- `_id`：由 OPENID 哈希生成的确定性用户文档 ID
- `openId`：可信微信 OPENID，唯一
- `displayName`：初始为“微信用户”
- `avatarUrl`：初始为空，本阶段不请求授权
- `status`：`active` 或 `disabled`
- `currentTeamId`：当前团队 ID，可为空
- `currentWarehouseId`：当前仓库 ID，可为空
- `createdAt`、`updatedAt`、`lastLoginAt`：服务端时间

## teams

- `_id`：由用户 ID 与 `createRequestKey` 生成的确定性 ID
- `name`：2至30字符
- `ownerId`：可信当前用户 ID
- `defaultWarehouseId`：默认仓库 ID
- `status`：`active`、`disabled` 或 `deleted`
- `createRequestKey`：创建幂等键
- `createdAt`、`updatedAt`：服务端时间
- `deletedAt`：软删除预留，本阶段为 `null`
- `activeInviteId`：最近一次刷新生成的邀请码ID，可为空；用于并发刷新时锁定团队状态

## team_members

- `_id`：由团队 ID 与用户 ID 生成的确定性 ID
- `teamId`、`userId`：成员关系唯一键
- `role`：`owner`、`admin` 或 `viewer`
- `status`：`pending`、`active` 或 `removed`
- `invitedBy`：创建者成员关系为 `null`
- `joinedAt`、`createdAt`、`updatedAt`：服务端时间
- `removedAt`：移除预留，本阶段为 `null`
- `memberRemark`：团队内成员备注，可为空
- `applyRequestKey`、`appliedAt`、`inviteId`：加入申请幂等键、申请时间和来源邀请码
- `reviewedAt`、`reviewedBy`、`reviewResult`、`reviewRemark`：审核时间、审核人、结果和备注
- `removalReason`、`removedBy`：移除原因和操作者，可为空
- `reviewRequestKey`、`reviewDecision`：审核操作幂等记录
- `roleUpdateRequestKey`、`roleUpdateRole`、`roleUpdatedBy`：角色变更幂等记录
- `removeRequestKey`：owner移除成员幂等记录
- `leaveRequestKey`：成员主动退出幂等记录

阶段2A已经存在的owner记录无需迁移。所有新增字段都按可空字段读取；owner旧记录缺少申请、审核和移除字段不会报错。

## warehouses

- `_id`：由团队 ID 生成的默认仓库确定性 ID
- `teamId`：所属团队
- `name`：1至30字符，前端默认“默认仓库”
- `description`：说明，本阶段为空
- `isDefault`：默认仓库为 `true`
- `status`：`active`、`disabled` 或 `deleted`
- `createdBy`：可信当前用户 ID
- `createdAt`、`updatedAt`：服务端时间
- `deletedAt`：软删除预留，本阶段为 `null`

以上集合的真实读写全部经过 `warehouse-api`。产品、库存和流水集合仍属于后续阶段。

## products（2C2创建）

V1采用仓库级产品文档：产品资料、库存余额、最低库存和派生库存状态保存在同一文档，使用软删除。

- 身份与归属：`_id`、`teamId`、`warehouseId`
- 基本资料：`name`、`normalizedName`、`code`、`normalizedCode`、`category`、`unit`、`brand`、`specification`、`description`、`keywords`、`searchText`
- 封面：`coverType`、`coverText`、`coverEmoji`、`coverAssetKey`、`coverFileId`、`coverBackground`
- 余额：`stock`、`minStock`、`stockStatus`、`stockVersion`
- 生命周期与并发：`status`、`version`、`createRequestKey`、`lastMutationAction`、`lastMutationRequestKey`、`lastMutationInputHash`
- 审计：`createdBy`、`updatedBy`、`deletedBy`、`createdAt`、`updatedAt`、`deletedAt`

`stockStatus`由云端按 `out/low/normal` 规则计算并持久化，客户端不得提交。普通产品编辑不得修改 `stock`。产品名称和编号V1允许重复，`_id`是唯一身份。

## stock_records（2C2创建，2C4启用完整库存写入）

不可变库存流水。库存更新与流水创建必须由 `warehouse-api` 在同一事务完成。

- `_id`、`teamId`、`warehouseId`、`productId`
- `productNameSnapshot`、`productCodeSnapshot`、`unitSnapshot`
- `type`：`initial`、`inbound`、`outbound`、`adjust`
- `changeQuantity`：有符号整数
- `beforeStock`、`afterStock`
- `reason`、`sourceOrDestination`、`remark`
- `operatorId`、`operatorMemberId`、`operatorNameSnapshot`
- `requestAction`、`requestKey`、`requestInputHash`
- `createdAt`

流水创建后不修改、不物理删除。产品改名、删除或操作人离队后，历史仍通过快照正常显示。

## categories（当前不创建）

V1分类直接保存为 `products.category` 字符串，单位直接保存为 `products.unit` 字符串。只有出现分类排序、停用、合并或权限需求后才引入独立集合，避免当前过度设计。

## invites

团队邀请码。邀请码只能由owner通过云函数生成和读取，不是登录凭证。

- `_id`：由团队ID、可信owner用户ID和刷新requestKey确定性生成
- `teamId`：可信当前团队ID
- `code`：6至8位大写不易混淆字符，云端安全随机生成，全局唯一
- `status`：`active`、`revoked`或`expired`
- `createdBy`：可信owner用户ID
- `expiresAt`：过期时间，默认24小时
- `maxUses`：最大审核通过次数，默认20
- `usedCount`：已经审核通过的次数，从0开始
- `requiresApproval`：阶段2B1固定为`true`
- `requestKey`：刷新邀请码幂等键
- `createdAt`、`updatedAt`：服务端时间
- `revokedAt`：刷新撤销时间，可为空

每个团队最多保留一个active邀请码。刷新会在事务中撤销旧码；申请pending时不增加`usedCount`，只有owner审核通过才增加。

## audit_logs

审计日志。

预留字段：`teamId`、`warehouseId`、`operatorId`、`action`、`targetType`、`targetId`、`snapshot`、`createdAt`。
