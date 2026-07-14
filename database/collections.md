# 集合规划

阶段0仅做数据设计，不创建真实集合或真实数据。

## users

用户基础资料。后续通过云函数写入，不在前端信任昵称、头像或身份字段。

预留字段：`openId`、`displayName`、`avatarFileId`、`status`、`createdAt`、`updatedAt`。

## teams

团队基础信息。

预留字段：`name`、`ownerId`、`status`、`createdAt`、`updatedAt`、`deletedAt`。

## team_members

团队成员与角色关系。所有团队业务集合必须预留 `teamId`。

预留字段：`teamId`、`userId`、`role`、`status`、`joinedAt`、`createdAt`、`updatedAt`。

## warehouses

仓库信息。后续多仓库能力不在阶段0实现，但仓库业务集合需要预留 `warehouseId`。

预留字段：`teamId`、`name`、`status`、`createdBy`、`createdAt`、`updatedAt`。

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
