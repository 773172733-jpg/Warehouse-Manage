# 阶段2C3C2 产品图片资产延迟清理Worker部署指南

## 1. 部署范围

本阶段新增独立云函数 `product-image-cleanup-worker`，入口为
`cloudfunctions/product-image-cleanup-worker/index.js`。它只处理服务端查询得到的到期
`product_image_assets`，不接受客户端指定的assetKey、productId、fileID或cloudPath。

本阶段同时调整了 `warehouse-api` 的图片资产生命周期和绑定竞争保护，因此必须重新部署
`warehouse-api`。不要修改AppID、环境ID、现有业务云函数名称或远程仓库配置。

正式资源固定为：

- AppID：`wxd5819a772c90b7a2`
- CloudBase环境：`cloud1-d8gm59cz2be4e7c23`
- 业务云函数：`warehouse-api`
- 清理云函数：`product-image-cleanup-worker`

严禁部署到任何事件管理器项目或其 CloudBase 环境。

## 2. 数据库与云存储

不新增集合，不新增、删除或修改索引。`product_image_assets` 继续保持客户端
`read=false`、`write=false`，当前只有以下3个索引：

| 索引 | 字段 | 唯一 |
| --- | --- | --- |
| `uidx_image_assets_stage_request` | `teamId`、`stageRequestKey`升序 | 是 |
| `idx_image_assets_product_status` | `teamId`、`productId`、`status`升序，`updatedAt`降序 | 否 |
| `idx_image_assets_cleanup` | `status`、`cleanupAfter`、`_id`升序 | 否 |

不得恢复 `fileId` 唯一索引，也不得增加 `warehouse_products` 索引。

云存储权限继续保持“仅创建者及管理员可读写”。不需要改为所有用户可读，不需要购买
CloudBase个人版。产品展示仍由 `warehouse-api` 返回短期HTTPS链接，客户端不读取fileID。

## 3. 生命周期语义

| 状态 | cleanupAfter | Worker行为 |
| --- | --- | --- |
| `awaiting_upload` | 与prepare的`expiresAt`相同 | 到期后原子转`rejected`，删除存在的source |
| `staged` | 与confirm后的`expiresAt`相同 | 未绑定且到期时原子转`rejected`，删除source和verified |
| `bound` | 有source时为`boundAt + 24小时` | 只删除source，绝不删除verified |
| `rejected` | `rejectedAt + 24小时` | 删除仍存在的source和verified |
| `orphaned` | `orphanedAt + 7天` | 复核products未引用后删除source和verified |

`cleanupState` 使用 `pending`、`processing`、`retry`、`completed`。每次处理先领取约5分钟
租约，写入 `cleanupLeaseToken`、`cleanupLeaseUntil` 并增加
`cleanupAttemptCount`。完成时必须匹配同一leaseToken。

绑定和清理通过同一资产文档的事务写冲突互斥：产品先绑定时Worker只能按bound规则删除
source；Worker先把到期staged转为rejected时，产品绑定会失败并要求重新选择图片。

## 4. 文件删除安全边界

Worker只接受能够严格解析并同时满足以下条件的fileID：

- 环境必须是 `cloud1-d8gm59cz2be4e7c23`；
- source路径必须精确匹配资产记录，且位于 `product-images/uploads/`；
- verified路径必须精确匹配资产记录，且位于 `product-images/verified/`；
- 扩展名只能是JPG、JPEG、PNG或WebP；
- 非法、空、跨环境、目录不符或归属不明的fileID不调用删除接口。

删除verified前会重新读取products。产品仍通过 `coverAssetKey` 或 `coverFileId` 引用文件、
产品归属不一致或状态不明确时，Worker拒绝删除并进入安全重试。

物理删除使用 `wx-server-sdk@4.0.2` 的：

```js
cloud.deleteFile({
  fileList: [...]
})
```

该版本返回 `fileList[].fileID`、`status` 和 `errMsg`。Worker每次最多领取20条资产，对最多
40个source/verified fileID去重后批量调用一次。文件不存在视为幂等成功；部分成功只记录
实际成功项，失败项重试；整批失败不会把任何资产错误标记为completed。

## 5. 重试与审计

失败后写入 `cleanupState=retry`、脱敏业务错误码和错误时间。退避依次为15分钟、30分钟、
1小时、2小时，继续翻倍且最长24小时。最多尝试8次；达到上限后
`cleanupAfter=null`、错误码为 `IMAGE_CLEANUP_RETRY_EXHAUSTED`，停止自动高频重试并保留人工
检查入口。

source成功写 `sourceDeletedAt`，verified成功写 `verifiedDeletedAt`，全部目标完成写
`cleanedAt`。bound只写source结果，`verifiedDeletedAt`必须保持为空。Worker不删除
`product_image_assets`审计记录。

日志只包含workerRunId、候选/领取/成功/重试/跳过数量、业务错误码和耗时，不包含完整
assetKey、requestKey、OPENID、fileID、cloudPath、临时URL、文件内容或数据库记录。

## 6. 部署步骤

1. 在微信开发者工具确认当前项目是Warehouse-Manager。
2. 确认AppID和CloudBase环境与第1节一致。
3. 右键 `cloudfunctions/warehouse-api`。
4. 选择“上传并部署：云端安装依赖”，等待部署成功。
5. 右键 `cloudfunctions/product-image-cleanup-worker`。
6. 选择“上传并部署：云端安装依赖”，等待部署成功。
7. 在云开发控制台确认两个云函数都位于正式轻仓环境。
8. 不创建集合，不调整3个现有索引，不修改云存储权限。

本仓库没有已验证的定时触发器配置范例，因此没有在 `config.json` 中猜测触发器schema。
请在CloudBase控制台为 `product-image-cleanup-worker` 手工创建“每小时一次”的定时触发器。
触发器不需要传入任何删除目标。

## 7. 首次手动触发

部署后先不要立即启用定时触发器。进入云函数控制台，选择
`product-image-cleanup-worker`，使用空参数 `{}` 手动运行一次。

检查返回摘要：

- `candidateCount`：本次命中的到期候选；
- `claimedCount`：成功领取租约数量；
- `successCount`：完成清理数量；
- `retryCount`：进入安全重试数量；
- `skippedCount`：租约冲突、状态变化等安全跳过数量；
- `errorCodes`：脱敏业务错误码；
- `durationMs`：运行耗时。

确认日志没有完整fileID、cloudPath、assetKey、requestKey或身份信息后，再创建每小时触发器。

## 8. 安全验收数据

只使用专门创建的可丢弃测试产品和测试图片，不修改真实业务产品，不手工伪造可指向其他
目录的有效fileID，不直接删除Storage文件。

### awaiting_upload

通过正常prepare流程创建测试资产但不完成绑定。确认记录包含
`cleanupState=pending`，且 `cleanupAfter=expiresAt`。仅对该测试记录把cleanupAfter调整到
过去后手动触发Worker，确认状态转rejected；有sourceUploadFileId时记录sourceDeletedAt。

### staged

通过正常prepare和confirm流程生成staged资产，但不要创建产品。把测试记录cleanupAfter
调整到过去，运行Worker。确认状态原子转rejected，sourceDeletedAt、verifiedDeletedAt和
cleanedAt已写入，Storage中的两个测试文件不再存在。

### bound source

用测试图片创建可丢弃产品，确认资产为bound。把cleanupAfter调整到过去后运行Worker。
确认sourceDeletedAt已写入、状态仍为bound、产品图片仍正常显示、verifiedDeletedAt为空，
verified文件仍存在。

### orphaned

给测试产品更换封面，使旧资产进入orphaned。确认products已经不引用旧assetKey/fileId，
再把旧资产cleanupAfter调整到过去并运行Worker。确认旧source和verified被清理，当前产品
新封面仍正常。

### 失败重试

只在专用测试资产中写入无法通过正式环境或目录校验的虚假fileID。运行Worker后确认没有
发生deleteFile调用，资产进入retry并写入脱敏错误码及下一次cleanupAfter。测试结束后删除
虚假值或停用该测试记录，不能把真实bound verified文件作为失败测试目标。

## 9. 回归验收

1. 创建文字、系统贴图和自定义图片产品，确认创建正常。
2. 库存首页、产品详情、搜索、筛选、分页和刷新保持正常。
3. 图片临时HTTPS链接仍可展示，响应不包含fileID或assetKey。
4. owner/admin仍可管理图片，viewer保持只读。
5. 初始库存、库存状态和既有stock_records不发生变化。
6. 重复手动运行Worker，已completed记录不重复删除。
7. 并发创建产品和运行Worker，确认只会“绑定成功”或“过期清理成功”二选一。

## 10. 查看日志

在云开发控制台进入 `product-image-cleanup-worker` 的日志页面，按workerRunId定位一次执行。
只查看摘要数量、耗时和业务错误码。不要把完整数据库记录、fileID或用户身份复制到工单、
群聊或代码仓库。

## 11. 回滚

1. 先在CloudBase控制台停用或删除每小时定时触发器。
2. 停止手动调用Worker。
3. 如需回退业务生命周期，重新部署上一个已验证版本的 `warehouse-api`。
4. 新增清理字段向后兼容，不需要删除字段、集合或索引。
5. 保留 `product_image_assets`审计记录，不执行批量数据库删除。

已经成功物理删除的到期临时文件和孤儿文件无法由Git回滚恢复。bound verified文件受代码
硬保护，不属于可删除目标。

## 12. 已知限制

- 每次最多处理20条，积压由后续每小时任务继续消化。
- 连续失败8次后停止自动调度，必须人工检查数据归属、路径和Storage状态。
- 部署前遗留且 `cleanupAfter=null` 的旧资产不会进入基于现有索引的到期查询；应先人工审计，
  再为确认安全的旧测试资产补写正确cleanupAfter，禁止批量猜测或直接删除。
- Worker不执行图片压缩、裁剪、内容审核、多图管理或资产审计记录删除。
- 本指南不代表已经完成真实CloudBase部署、定时器创建或物理删除验收。
