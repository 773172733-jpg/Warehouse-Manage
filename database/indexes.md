# 索引清单

以下索引必须在轻仓云开发控制台人工创建。唯一索引缺失时，禁止执行首次用户初始化和团队创建验收。

## users

- `idx_users_openid_unique`：`openId` 升序，唯一
- `idx_users_current_team`：`currentTeamId` 升序，普通

## teams

- `idx_teams_owner_status`：`ownerId` 升序 + `status` 升序，普通
- `idx_teams_owner_request_unique`：`ownerId` 升序 + `createRequestKey` 升序，唯一
- `idx_teams_status_created`：`status` 升序 + `createdAt` 降序，普通

## team_members

- `idx_members_team_user_unique`：`teamId` 升序 + `userId` 升序，唯一
- `idx_members_user_status`：`userId` 升序 + `status` 升序，普通
- `idx_members_team_status_role`：`teamId` 升序 + `status` 升序 + `role` 升序，普通

## warehouses

- `idx_warehouses_team_status`：`teamId` 升序 + `status` 升序，普通
- `idx_warehouses_team_default_status`：`teamId` 升序 + `isDefault` 升序 + `status` 升序，普通

上述索引没有重复前缀用途：唯一索引负责身份和成员关系约束，普通索引对应阶段2A实际查询。其余后续业务索引暂不创建。

## 后续阶段索引草案

### products

- `teamId + warehouseId + status`
- `teamId + warehouseId + code`
- `teamId + warehouseId + searchKeywords`
- `teamId + warehouseId + categoryId`

### stock_records

- `teamId + warehouseId + productId + createdAt`
- `teamId + warehouseId + requestKey`
- `teamId + createdAt`

### categories

- `teamId + warehouseId + status`

### invites

- `teamId + code`
- `expiresAt + status`

### audit_logs

- `teamId + createdAt`
- `teamId + operatorId + createdAt`
