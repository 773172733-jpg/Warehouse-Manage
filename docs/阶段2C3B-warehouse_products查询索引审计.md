# 阶段2C3B warehouse_products查询索引审计

## 审计结论

腾讯云确认CloudBase单集合最多20个索引，所有套餐上限一致。正式环境创建 `idx_wh_products_team_product` 时返回 `LimitExceeded.OutOfIndexQuota`，因此该索引已从2C3B部署要求中取消。

最终采用方案A：以 `products.activeWarehouseCount` 作为合法业务写入下的权威活跃仓库实例计数，并用products文档事务写冲突实现目录删除与仓库激活互斥。`product.catalog.delete` 和 `product.catalog.restore` 不再查询warehouse_products，不做无索引扫描，也不新增、删除或重排任何warehouse_products索引。

代码库登记了18个warehouse_products业务索引。云控制台的实际索引总数和系统索引只能以正式环境索引管理页为准；本地仓库无法读取云端完整清单，不能把下表虚构为控制台现状。正式环境新增索引时报额度超限，可证明该集合已达到系统允许上限，但不能仅凭本地文档断言其余系统索引的名称。

## 查询与索引矩阵

| 编号 | 接口/位置 | 业务用途 | where条件及顺序 | orderBy | 分页 | 唯一查询 | 当前支撑索引 | 最左前缀判断 | 无索引风险 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Q01 | product.create/loadCreateDocuments | 创建幂等结果读取 | `_id = warehouseProductId` | 无 | 否 | 是 | 系统 `_id` | 完整匹配 | 无 | 保留doc读取 |
| Q02 | product.update | 当前仓库实例锁定与结果读取 | `_id = createWarehouseProductId(teamId, warehouseId, productId)` | 无 | 否 | 是 | 系统 `_id` | 完整匹配 | 无 | 保留doc读取 |
| Q03 | product.removeFromWarehouse | 锁定待移除实例 | `_id = warehouseProductId`，随后校验可信teamId/warehouseId | 无 | 否 | 是 | 系统 `_id` | 完整匹配 | 无 | 保留doc读取 |
| Q04 | product.restoreToWarehouse | 锁定待恢复实例 | `_id = warehouseProductId`，随后校验可信teamId/warehouseId | 无 | 否 | 是 | 系统 `_id` | 完整匹配 | 无 | 保留doc读取 |
| Q05 | product.detail | 当前仓库详情 | `_id = warehouseProductId`，随后校验productId | 无 | 否 | 是 | 系统 `_id` | 完整匹配 | 无 | 保留doc读取 |
| Q06 | product.list/removed.list | 无筛选列表 | `teamId =, warehouseId =, status =`，游标增加updatedAt范围及_id范围 | `updatedAt DESC, _id DESC`，稳定游标 | 是 | 否 | idx_wh_products_status_updated | 完整匹配 | 列表扫描/排序 | 保留 |
| Q07 | product.list/removed.list | 库存状态筛选 | Q06 + `stockStatus =` | 同Q06 | 是 | 否 | idx_wh_products_stock_status | 完整匹配 | 扫描/排序 | 保留 |
| Q08 | product.list/removed.list | 分类筛选 | Q06 + `categorySnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_category | 完整匹配 | 扫描/排序 | 保留 |
| Q09 | product.list/removed.list | 分类和库存状态 | Q06 + `categorySnapshot =, stockStatus =` | 同Q06 | 是 | 否 | idx_wh_products_category_stock | 完整匹配 | 扫描/排序 | 保留 |
| Q10 | product.list/removed.list | 编号查询 | Q06 + `normalizedCodeSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_code | 完整匹配 | 扫描/排序 | 保留 |
| Q11 | product.list/removed.list | 名称前缀 | Q06 + `normalizedNameSnapshot >=,<` | 同Q06 | 是 | 否 | idx_wh_products_name | 完整匹配 | 扫描/排序 | 保留 |
| Q12 | product.list/removed.list | 关键词token | Q06 + `searchKeywordsSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_keyword | 完整匹配 | 扫描/排序 | 保留 |
| Q13 | product.list/removed.list | 分类和编号 | Q08 + `normalizedCodeSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_category_code | 完整匹配 | 扫描/排序 | 保留 |
| Q14 | product.list/removed.list | 分类和名称 | Q08 + `normalizedNameSnapshot >=,<` | 同Q06 | 是 | 否 | idx_wh_products_category_name | 完整匹配 | 扫描/排序 | 保留 |
| Q15 | product.list/removed.list | 分类和关键词 | Q08 + `searchKeywordsSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_category_keyword | 完整匹配 | 扫描/排序 | 保留 |
| Q16 | product.list/removed.list | 库存状态和编号 | Q07 + `normalizedCodeSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_stock_code | 完整匹配 | 扫描/排序 | 保留 |
| Q17 | product.list/removed.list | 库存状态和名称 | Q07 + `normalizedNameSnapshot >=,<` | 同Q06 | 是 | 否 | idx_wh_products_stock_name | 完整匹配 | 扫描/排序 | 保留 |
| Q18 | product.list/removed.list | 库存状态和关键词 | Q07 + `searchKeywordsSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_stock_keyword | 完整匹配 | 扫描/排序 | 保留 |
| Q19 | product.list/removed.list | 分类、库存状态和编号 | Q09 + `normalizedCodeSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_category_stock_code | 完整匹配 | 扫描/排序 | 保留 |
| Q20 | product.list/removed.list | 分类、库存状态和名称 | Q09 + `normalizedNameSnapshot >=,<` | 同Q06 | 是 | 否 | idx_wh_products_category_stock_name | 完整匹配 | 扫描/排序 | 保留 |
| Q21 | product.list/removed.list | 分类、库存状态和关键词 | Q09 + `searchKeywordsSnapshot =` | 同Q06 | 是 | 否 | idx_wh_products_category_stock_keyword | 完整匹配 | 扫描/排序 | 保留 |
| Q22 | product.catalog.delete | 全局目录删除阻断 | 不查询warehouse_products；事务内读取products._id并校验activeWarehouseCount | 无 | 否 | 是 | products系统 `_id` | 完整匹配 | 不适用 | 已移除跨仓查询 |
| Q23 | product.catalog.restore | 共享目录恢复 | 不查询warehouse_products；事务内读取products._id并校验activeWarehouseCount | 无 | 否 | 是 | products系统 `_id` | 完整匹配 | 不适用 | 已移除跨仓查询 |
| Q24 | 后续库存写入 | 锁定余额并写流水 | `_id = warehouseProductId`，校验status=active | 无 | 否 | 是 | 系统 `_id` | 完整匹配 | 无 | 预留必须沿用doc事务 |

`product.list` 与 `product.removed.list` 共用同一个where构造器，区别仅为status分别是active和removed；上表Q06至Q21对两个接口都成立。关键词查询由编号、名称和token三个OR分支组成，每个分支必须分别命中对应组合索引。

## 现有业务索引

| 索引名称 | 字段完整顺序 | 唯一 | 实际支撑查询 | 最左前缀可覆盖 | 仍被使用 | 已验收功能 |
| --- | --- | --- | --- | --- | --- | --- |
| uidx_wh_products_relation | teamId ASC, warehouseId ASC, productId ASC | 是 | 一仓一产品唯一约束 | teamId；teamId+warehouseId | 是 | 创建/未来加入仓库 |
| uidx_wh_products_request | teamId ASC, warehouseId ASC, createRequestKey ASC | 是 | 创建幂等约束 | teamId；teamId+warehouseId | 是 | 产品创建 |
| idx_wh_products_status_updated | teamId ASC, warehouseId ASC, status ASC, updatedAt DESC, _id DESC | 否 | Q06 | 至status前缀 | 是 | 首页/仓库回收站 |
| idx_wh_products_stock_status | teamId ASC, warehouseId ASC, status ASC, stockStatus ASC, updatedAt DESC, _id DESC | 否 | Q07 | 至stockStatus前缀 | 是 | 库存筛选 |
| idx_wh_products_category | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, updatedAt DESC, _id DESC | 否 | Q08 | 至categorySnapshot前缀 | 是 | 分类筛选 |
| idx_wh_products_category_stock | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, stockStatus ASC, updatedAt DESC, _id DESC | 否 | Q09 | 至stockStatus前缀 | 是 | 组合筛选 |
| idx_wh_products_name | teamId ASC, warehouseId ASC, status ASC, normalizedNameSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q11 | 至名称前缀 | 是 | 名称搜索 |
| idx_wh_products_code | teamId ASC, warehouseId ASC, status ASC, normalizedCodeSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q10 | 至编号前缀 | 是 | 编号搜索 |
| idx_wh_products_keyword | teamId ASC, warehouseId ASC, status ASC, searchKeywordsSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q12 | 至关键词前缀 | 是 | token搜索 |
| idx_wh_products_category_name | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, normalizedNameSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q14 | 至名称前缀 | 是 | 分类+名称 |
| idx_wh_products_category_code | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, normalizedCodeSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q13 | 至编号前缀 | 是 | 分类+编号 |
| idx_wh_products_category_keyword | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, searchKeywordsSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q15 | 至关键词前缀 | 是 | 分类+token |
| idx_wh_products_stock_name | teamId ASC, warehouseId ASC, status ASC, stockStatus ASC, normalizedNameSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q17 | 至名称前缀 | 是 | 状态+名称 |
| idx_wh_products_stock_code | teamId ASC, warehouseId ASC, status ASC, stockStatus ASC, normalizedCodeSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q16 | 至编号前缀 | 是 | 状态+编号 |
| idx_wh_products_stock_keyword | teamId ASC, warehouseId ASC, status ASC, stockStatus ASC, searchKeywordsSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q18 | 至关键词前缀 | 是 | 状态+token |
| idx_wh_products_category_stock_name | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, stockStatus ASC, normalizedNameSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q20 | 至名称前缀 | 是 | 分类+状态+名称 |
| idx_wh_products_category_stock_code | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, stockStatus ASC, normalizedCodeSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q19 | 至编号前缀 | 是 | 分类+状态+编号 |
| idx_wh_products_category_stock_keyword | teamId ASC, warehouseId ASC, status ASC, categorySnapshot ASC, stockStatus ASC, searchKeywordsSnapshot ASC, updatedAt DESC, _id DESC | 否 | Q21 | 至关键词前缀 | 是 | 分类+状态+token |

这些索引都不是 `teamId + productId` 查询的有效覆盖。尤其 `uidx_wh_products_relation` 在productId之前存在warehouseId间隙，不能按最左前缀替代原拟新增索引。

## 事务不变量证明

1. product.create在同一事务创建products和默认warehouse_products，activeWarehouseCount初始为1。
2. removeFromWarehouse先锁定active实例并要求stock等于0。
3. removeFromWarehouse在同一事务把实例改为removed，并要求计数是至少1的安全整数后减1；不再使用 `Math.max` 掩盖异常。
4. restoreToWarehouse锁定removed实例、要求stock等于0且products.status为active，并在同一事务严格加1。
5. removed实例被产品详情和后续库存写前置校验拒绝；未来库存写仍必须锁定warehouse_products并要求status为active。
6. product.create、仓库移除、仓库恢复、catalog.delete和catalog.restore都读取或更新同一products记录。
7. catalog.delete在事务内重新验证owner、products.status、version和activeWarehouseCount等于0。
8. restoreToWarehouse与catalog.delete并发时会写冲突重试；删除先完成则恢复看到deleted，恢复先完成则删除看到计数大于0。
9. 各操作先检查requestKey/hash和目标状态，幂等重试不会重复加减计数。
10. 计数缺失、为负或非整数均返回PRODUCT_WAREHOUSE_STATE_CONFLICT，不自动修复。

## 边界与剩余风险

方案B未采用。现有warehouses索引为teamId+status，无法在不新增索引、不使用无界skip的前提下稳定游标遍历所有状态的全部仓库；只查active仓库或单页会漏判。方案C也未采用，因为现有warehouse_products索引没有teamId+productId最左前缀。

方案A保证所有经warehouse-api执行的合法业务写入一致。拥有云控制台权限的人若直接改写warehouse_products而不同步products，可以绕过该不变量；在线接口无法在“零新增索引且禁止全表扫描”的约束下完整侦测这种人工脏数据。生产环境必须保持客户端直访关闭并禁止控制台人工改业务数据，后续如需检查历史脏数据，应建设独立、受控、可暂停业务写入的离线一致性审计任务。

阶段2C3B仍需重新部署warehouse-api并完成真实CloudBase验收，验收前不得标记为最终通过或推送。
