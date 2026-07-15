# 索引清单

以下索引必须在轻仓云开发控制台人工创建。代码和部署不会自动创建索引。

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
- `idx_members_user_updated`：`userId` 升序 + `updatedAt` 降序，普通（查询当前用户最近申请结果）

## warehouses

- `idx_warehouses_team_status`：`teamId` 升序 + `status` 升序，普通
- `idx_warehouses_team_default_status`：`teamId` 升序 + `isDefault` 升序 + `status` 升序，普通

## invites

- `idx_invites_code_unique`：`code` 升序，唯一
- `idx_invites_team_status_expiry`：`teamId` 升序 + `status` 升序 + `expiresAt` 升序，普通
- `idx_invites_team_request_unique`：`teamId` 升序 + `requestKey` 升序，唯一
- `idx_invites_creator_created`：`createdBy` 升序 + `createdAt` 降序，普通

在云开发控制台进入对应集合的“索引管理”，选择“新建索引”，严格按上述字段顺序和升降序逐项添加，并只为标注“唯一”的索引打开唯一开关。等待全部索引状态变为可用后再测试接口。

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

### audit_logs

- `teamId + createdAt`
- `teamId + operatorId + createdAt`
