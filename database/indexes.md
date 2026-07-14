# 索引规划

阶段0不创建真实索引。以下为后续开发时的索引建议。

## users

- `openId` 唯一索引
- `status`

## teams

- `ownerId`
- `status`

## team_members

- `teamId + userId` 唯一索引
- `teamId + role`
- `userId + status`

## warehouses

- `teamId + status`

## products

- `teamId + warehouseId + status`
- `teamId + warehouseId + code`
- `teamId + warehouseId + searchKeywords`
- `teamId + warehouseId + categoryId`

## stock_records

- `teamId + warehouseId + productId + createdAt`
- `teamId + warehouseId + requestKey`
- `teamId + createdAt`

## categories

- `teamId + warehouseId + status`

## invites

- `teamId + code`
- `expiresAt + status`

## audit_logs

- `teamId + createdAt`
- `teamId + operatorId + createdAt`
