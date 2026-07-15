# 集合设计

阶段2A需要在轻仓环境 `cloud1-d8gm59cz2be4e7c23` 人工创建 `users`、`teams`、`team_members`、`warehouses`。代码不会自动创建集合、索引或权限。

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

## team_members

- `_id`：由团队 ID 与用户 ID 生成的确定性 ID
- `teamId`、`userId`：成员关系唯一键
- `role`：`owner`、`admin` 或 `viewer`
- `status`：`pending`、`active` 或 `removed`
- `invitedBy`：创建者成员关系为 `null`
- `joinedAt`、`createdAt`、`updatedAt`：服务端时间
- `removedAt`：移除预留，本阶段为 `null`

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

以上四个集合的真实读写全部经过 `warehouse-api`。产品、库存和流水集合仍属于后续阶段。

## products

产品主表，使用软删除。

规划字段：`teamId`、`warehouseId`、`name`、`code`、`description`、`categoryId`、`unit`、`stock`、`minStock`、`coverMode`、`systemAssetKey`、`customFileId`、`displayText`、`searchText`、`searchKeywords`、`status`、`createdBy`、`updatedBy`、`createdAt`、`updatedAt`、`deletedAt`、`deletedBy`。

## stock_records

库存流水表。库存不允许仅修改 `products.stock` 而不产生 `stock_records` 流水。

规划字段：`teamId`、`warehouseId`、`productId`、`type`、`quantityDelta`、`stockBefore`、`stockAfter`、`reason`、`remark`、`operatorId`、`requestKey`、`createdAt`。

`type` 可取值：`initial`、`inbound`、`outbound`、`adjustment`。

后续库存变更必须在云函数中完成，并考虑并发一致性与重复提交。

## categories

产品分类。

预留字段：`teamId`、`warehouseId`、`name`、`sortOrder`、`status`、`createdAt`、`updatedAt`。

## invites

团队邀请。

预留字段：`teamId`、`inviterId`、`role`、`code`、`status`、`expiresAt`、`createdAt`、`usedAt`。

## audit_logs

审计日志。

预留字段：`teamId`、`warehouseId`、`operatorId`、`action`、`targetType`、`targetId`、`snapshot`、`createdAt`。
