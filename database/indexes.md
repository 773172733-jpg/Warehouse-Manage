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

## products（2C2）

以下索引尚未创建。字段顺序按“租户等值条件、业务等值条件、排序字段、稳定ID”排列。

| 索引名 | 字段 | 唯一 | 用途 | 创建时间 |
| --- | --- | --- | --- | --- |
| `idx_products_wh_status_updated` | `teamId`升序、`warehouseId`升序、`status`升序、`updatedAt`降序、`_id`降序 | 否 | active列表、最近更新、总数 | 2C2前 |
| `idx_products_wh_status_stock_updated` | `teamId`升序、`warehouseId`升序、`status`升序、`stockStatus`升序、`updatedAt`降序、`_id`降序 | 否 | 低库存/缺货筛选与统计 | 2C2前 |
| `idx_products_wh_status_category_updated` | `teamId`升序、`warehouseId`升序、`status`升序、`category`升序、`updatedAt`降序、`_id`降序 | 否 | 分类筛选 | 2C2前 |
| `idx_products_wh_status_category_stock_updated` | `teamId`升序、`warehouseId`升序、`status`升序、`category`升序、`stockStatus`升序、`updatedAt`降序、`_id`降序 | 否 | 分类与库存状态叠加 | 叠加筛选上线前 |
| `idx_products_wh_status_name` | `teamId`升序、`warehouseId`升序、`status`升序、`normalizedName`升序、`_id`升序 | 否 | 精确和前缀名称定位 | 2C2前 |
| `uidx_products_create_request` | `teamId`升序、`warehouseId`升序、`createRequestKey`升序 | 是 | 创建幂等第二层约束 | 2C2前 |

`searchText`的包含正则不能利用普通索引，不创建一个看似存在但无法优化正则的索引。V1限制单仓规模；规模扩大后再启用经验证的全文索引或独立搜索服务。

方案A没有 `inventory_balances` 集合，因此当前没有余额唯一索引。未来拆分余额时必须创建 `teamId + warehouseId + productId` 唯一索引。

## stock_records（2C2至2C5）

以下索引尚未创建。

| 索引名 | 字段 | 唯一 | 用途 | 创建时间 |
| --- | --- | --- | --- | --- |
| `idx_records_wh_created` | `teamId`升序、`warehouseId`升序、`createdAt`降序、`_id`降序 | 否 | 仓库流水和时间范围 | 2C5前 |
| `idx_records_product_created` | `teamId`升序、`warehouseId`升序、`productId`升序、`createdAt`降序、`_id`降序 | 否 | 产品流水摘要和筛选 | 2C2前 |
| `idx_records_type_created` | `teamId`升序、`warehouseId`升序、`type`升序、`createdAt`降序、`_id`降序 | 否 | 类型筛选 | 2C5前 |
| `idx_records_operator_created` | `teamId`升序、`warehouseId`升序、`operatorId`升序、`createdAt`降序、`_id`降序 | 否 | 经验证的操作人筛选 | 2C5前 |
| `idx_records_product_type_created` | `teamId`升序、`warehouseId`升序、`productId`升序、`type`升序、`createdAt`降序、`_id`降序 | 否 | 产品与类型组合 | 2C5前 |
| `uidx_records_request` | `teamId`升序、`warehouseId`升序、`requestAction`升序、`requestKey`升序 | 是 | initial及库存写入幂等第二层约束 | 2C2前 |

不预先为所有筛选排列创建重复索引。根据2C5真实慢查询和数据规模再补充必要组合。

## audit_logs（仍为预留）

- `teamId`升序 + `createdAt`降序
- `teamId`升序 + `operatorId`升序 + `createdAt`降序
