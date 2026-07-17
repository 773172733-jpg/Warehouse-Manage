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

上述索引没有重复前缀用途：唯一索引负责身份和成员关系约束，普通索引对应阶段2A实际查询。以下2C2A产品索引需要在本阶段部署前继续创建。

## products（2C2A部署前）

以下索引尚未创建。字段顺序按“租户等值条件、业务等值条件、排序字段、稳定ID”排列。`product.create`主要使用确定性文档ID，但唯一索引仍作为跨实现幂等约束。

| 索引名 | 字段 | 唯一 | 用途 | 2C2A部署前必须 |
| --- | --- | --- | --- | --- |
| `idx_products_team_status_updated` | `teamId`升序、`status`升序、`updatedAt`降序、`_id`降序 | 否 | 共享目录列表预留 | 是 |
| `idx_products_team_status_name` | `teamId`升序、`status`升序、`normalizedName`升序、`_id`升序 | 否 | 共享目录名称前缀预留 | 是 |
| `idx_products_team_status_code` | `teamId`升序、`status`升序、`normalizedCode`升序、`_id`升序 | 否 | 共享目录编号定位预留 | 是 |
| `idx_products_team_category_status` | `teamId`升序、`category`升序、`status`升序、`updatedAt`降序、`_id`降序 | 否 | 共享目录分类预留 | 是 |
| `idx_products_team_status_keyword` | `teamId`升序、`status`升序、`searchKeywords`升序、`_id`升序 | 否 | 受控关键词token预留 | 是 |
| `uidx_products_team_request` | `teamId`升序、`createRequestKey`升序 | 是 | `product.create`幂等 | 是 |

products没有仓库和库存字段。名称使用前缀范围查询；任意包含式正则不能依赖普通索引，也不作为99,999规模承诺。

## warehouse_products（2C2A部署前）

阶段2C3A回收站继续按 `status=removed` 与 `updatedAt` 倒序分页，复用下表已有的状态、分类、名称、编号和关键词组合索引，不新增 `removedAt` 索引。移除操作会同步更新 `updatedAt`，因此游标排序稳定且无需重复索引。

| 索引名 | 字段 | 唯一 | 用途 | 2C2A部署前必须 |
| --- | --- | --- | --- | --- |
| `uidx_wh_products_relation` | `teamId`升序、`warehouseId`升序、`productId`升序 | 是 | 一仓一产品实例 | 是 |
| `uidx_wh_products_request` | `teamId`升序、`warehouseId`升序、`createRequestKey`升序 | 是 | 创建/加入仓库幂等 | 是 |
| `idx_wh_products_status_updated` | `teamId`升序、`warehouseId`升序、`status`升序、`updatedAt`降序、`_id`降序 | 否 | 无筛选列表 | 是 |
| `idx_wh_products_stock_status` | `teamId`升序、`warehouseId`升序、`status`升序、`stockStatus`升序、`updatedAt`降序、`_id`降序 | 否 | 库存状态筛选 | 是 |
| `idx_wh_products_category` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类筛选 | 是 |
| `idx_wh_products_category_stock` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`stockStatus`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+库存状态 | 是 |
| `idx_wh_products_name` | `teamId`升序、`warehouseId`升序、`status`升序、`normalizedNameSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 名称前缀 | 是 |
| `idx_wh_products_code` | `teamId`升序、`warehouseId`升序、`status`升序、`normalizedCodeSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 编号精确查询 | 是 |
| `idx_wh_products_keyword` | `teamId`升序、`warehouseId`升序、`status`升序、`searchKeywordsSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 受控关键词 | 是 |
| `idx_wh_products_category_name` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`normalizedNameSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+名称 | 是 |
| `idx_wh_products_category_code` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`normalizedCodeSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+编号 | 是 |
| `idx_wh_products_category_keyword` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`searchKeywordsSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+关键词 | 是 |
| `idx_wh_products_stock_name` | `teamId`升序、`warehouseId`升序、`status`升序、`stockStatus`升序、`normalizedNameSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 库存状态+名称 | 是 |
| `idx_wh_products_stock_code` | `teamId`升序、`warehouseId`升序、`status`升序、`stockStatus`升序、`normalizedCodeSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 库存状态+编号 | 是 |
| `idx_wh_products_stock_keyword` | `teamId`升序、`warehouseId`升序、`status`升序、`stockStatus`升序、`searchKeywordsSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 库存状态+关键词 | 是 |
| `idx_wh_products_category_stock_name` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`stockStatus`升序、`normalizedNameSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+状态+名称 | 是 |
| `idx_wh_products_category_stock_code` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`stockStatus`升序、`normalizedCodeSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+状态+编号 | 是 |
| `idx_wh_products_category_stock_keyword` | `teamId`升序、`warehouseId`升序、`status`升序、`categorySnapshot`升序、`stockStatus`升序、`searchKeywordsSnapshot`升序、`updatedAt`降序、`_id`降序 | 否 | 分类+状态+关键词 | 是 |

可选筛选字段位于排序字段之前；缺少其中任一等值字段会形成索引间隙，因此不能用一个超长索引代替上述实际查询形状。若控制台对OR分支提示不同索引，以实际提示核对字段顺序，不得放宽为客户端全量筛选。

## warehouse_products（2C3B索引额度处理记录）

CloudBase单集合最多20个索引，且套餐升级不能提高该上限。阶段2C3B原计划新增以下索引，但云端返回 `LimitExceeded.OutOfIndexQuota`，现已取消，不再需要：

| 索引名 | 字段 | 唯一 | 原用途 | 当前结论 |
| --- | --- | --- | --- | --- |
| `idx_wh_products_team_product` | `teamId`升序、`productId`升序、`_id`升序 | 否 | 跨仓分页检查产品实例 | 取消，不再需要 |

`uidx_wh_products_relation`的字段顺序为teamId、warehouseId、productId，不能按最左前缀覆盖teamId+productId查询，因此不得虚构复用。当前实现改用products.activeWarehouseCount事务不变量：创建、仓库移除和仓库恢复在同一事务内严格增减计数，目录删除在事务内锁定products并要求计数为0。用户无需删除、重排或新增任何warehouse_products索引。

阶段2C3B的deleted products列表继续按 `updatedAt desc, _id desc`，复用既有 `idx_products_team_status_updated`、`idx_products_team_category_status` 以及名称、编号、关键词索引；不新增deletedAt排序索引。

## product_image_assets（2C3C1部署前）

| 索引名 | 字段 | 唯一 | 用途 |
| --- | --- | --- | --- |
| `uidx_image_assets_stage_request` | `teamId`升序、`stageRequestKey`升序 | 是 | prepare幂等 |
| `idx_image_assets_product_status` | `teamId`升序、`productId`升序、`status`升序、`updatedAt`降序 | 否 | 产品图片状态查询 |
| `idx_image_assets_cleanup` | `status`升序、`cleanupAfter`升序、`_id`升序 | 否 | 2C3C2清理游标 |

`fileId`不得建立唯一索引。CloudBase唯一索引会把字段缺失视为`null`，而多条`awaiting_upload`记录在confirm前都没有`fileId`，唯一索引会阻断第二条及后续prepare。verified文件身份由随机`verifiedCloudPath`、资产文档ID和绑定事务共同保证，不依赖`fileId`查询。

以上3个索引属于独立新集合，不占用warehouse_products的单集合20索引额度。2C3C1不得调整warehouse_products索引。

## stock_records（2C2A至2C5）

以下索引尚未创建。

| 索引名 | 字段 | 唯一 | 用途 | 创建时间 |
| --- | --- | --- | --- | --- |
| `idx_records_wh_created` | `teamId`升序、`warehouseId`升序、`createdAt`降序、`_id`降序 | 否 | 仓库流水和时间范围 | 2C2A前 |
| `idx_records_wh_product_created` | `teamId`升序、`warehouseId`升序、`warehouseProductId`升序、`createdAt`降序、`_id`降序 | 否 | 仓库产品流水 | 2C2A前 |
| `idx_records_product_created` | `teamId`升序、`productId`升序、`createdAt`降序、`_id`降序 | 否 | 跨仓产品历史 | 2C2A前 |
| `idx_records_type_created` | `teamId`升序、`warehouseId`升序、`type`升序、`createdAt`降序、`_id`降序 | 否 | 类型筛选 | 2C5前 |
| `idx_records_operator_created` | `teamId`升序、`warehouseId`升序、`operatorId`升序、`createdAt`降序、`_id`降序 | 否 | 经验证的操作人筛选 | 2C5前 |
| `uidx_records_request` | `teamId`升序、`warehouseId`升序、`requestKey`升序 | 是 | initial及库存写入幂等 | 2C2A前 |

不预先为所有筛选排列创建重复索引。根据2C5真实慢查询和数据规模再补充必要组合。

## audit_logs（仍为预留）

- `teamId`升序 + `createdAt`降序
- `teamId`升序 + `operatorId`升序 + `createdAt`降序
