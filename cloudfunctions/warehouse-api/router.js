const crypto = require('crypto');
const systemPing = require('./modules/system/ping.js');
const userBootstrap = require('./modules/user/bootstrap.js');
const teamCreate = require('./modules/team/create.js');
const teamCurrent = require('./modules/team/current.js');
const teamInviteCurrent = require('./modules/team/invite-current.js');
const teamInviteRefresh = require('./modules/team/invite-refresh.js');
const teamJoinApply = require('./modules/team/join-apply.js');
const teamJoinStatus = require('./modules/team/join-status.js');
const teamMemberList = require('./modules/team/member-list.js');
const teamMemberReview = require('./modules/team/member-review.js');
const teamMemberRoleUpdate = require('./modules/team/member-role-update.js');
const teamMemberRemove = require('./modules/team/member-remove.js');
const teamLeave = require('./modules/team/leave.js');
const productCreate = require('./modules/product/create.js');
const productList = require('./modules/product/list.js');
const productDetail = require('./modules/product/detail.js');
const productUpdate = require('./modules/product/update.js');
const productRemoveFromWarehouse = require('./modules/product/remove-from-warehouse.js');
const productRemovedList = require('./modules/product/removed-list.js');
const productRestoreToWarehouse = require('./modules/product/restore-to-warehouse.js');
const productCatalogDelete = require('./modules/product/catalog-delete.js');
const productCatalogDeletedList = require('./modules/product/catalog-deleted-list.js');
const productCatalogRestore = require('./modules/product/catalog-restore.js');
const productImageStagePrepare = require('./modules/product/image-stage-prepare.js');
const productImageStageConfirm = require('./modules/product/image-stage-confirm.js');
const stockInbound = require('./modules/stock/inbound.js');
const stockOutbound = require('./modules/stock/outbound.js');
const stockAdjust = require('./modules/stock/adjust.js');
const { ok, fail } = require('./common/response.js');
const { ApiError, ERROR_CODES, isApiError } = require('./common/errors.js');
const { buildContext } = require('./common/context.js');

const ACTION_HANDLERS = {
  'system.ping': systemPing,
  'user.bootstrap': userBootstrap,
  'team.create': teamCreate,
  'team.current': teamCurrent,
  'team.invite.current': teamInviteCurrent,
  'team.invite.refresh': teamInviteRefresh,
  'team.join.apply': teamJoinApply,
  'team.join.status': teamJoinStatus,
  'team.member.list': teamMemberList,
  'team.member.review': teamMemberReview,
  'team.member.role.update': teamMemberRoleUpdate,
  'team.member.remove': teamMemberRemove,
  'team.leave': teamLeave,
  'product.create': productCreate,
  'product.list': productList,
  'product.detail': productDetail,
  'product.update': productUpdate,
  'product.removeFromWarehouse': productRemoveFromWarehouse,
  'product.removed.list': productRemovedList,
  'product.restoreToWarehouse': productRestoreToWarehouse,
  'product.catalog.delete': productCatalogDelete,
  'product.catalog.deleted.list': productCatalogDeletedList,
  'product.catalog.restore': productCatalogRestore,
  'product.image.stage.prepare': productImageStagePrepare,
  'product.image.stage.confirm': productImageStageConfirm,
  'stock.inbound': stockInbound,
  'stock.outbound': stockOutbound,
  'stock.adjust': stockAdjust
};

function createRequestId(candidate) {
  if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(candidate)) {
    return candidate;
  }
  return `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function dispatch(event, cloud) {
  const input = event && typeof event === 'object' ? event : {};
  const requestId = createRequestId(input.requestId);
  const action = input.action;

  try {
    const data = input.data && typeof input.data === 'object' ? input.data : {};
    const handler = ACTION_HANDLERS[action];

    if (!handler) {
      throw new ApiError(ERROR_CODES.UNKNOWN_ACTION, '未知接口动作。');
    }

    const context = buildContext(cloud);
    console.info('[warehouse-api]', requestId, action, 'started');
    const result = await handler({
      data,
      context,
      cloud
    });

    console.info('[warehouse-api]', requestId, action, 'succeeded');
    return ok(result, requestId);
  } catch (error) {
    if (isApiError(error)) {
      console.warn('[warehouse-api]', requestId, action || 'unknown', 'failed', error.code);
      return fail(error.code, error.message, requestId);
    }

    console.error('[warehouse-api]', requestId, action || 'unknown', 'failed unexpectedly');
    return fail(ERROR_CODES.INTERNAL_ERROR, '云函数处理异常。', requestId);
  }
}

module.exports = {
  ACTION_HANDLERS,
  createRequestId,
  dispatch
};
