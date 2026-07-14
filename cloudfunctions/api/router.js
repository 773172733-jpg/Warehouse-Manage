const systemPing = require('./modules/system/ping');
const { ok, fail } = require('./common/response');
const { ApiError, ERROR_CODES } = require('./common/errors');
const { buildContext } = require('./common/context');

const ACTION_HANDLERS = {
  'system.ping': systemPing
};

async function dispatch(event, cloud) {
  const requestId = event.requestId || '';

  try {
    const action = event.action;
    const data = event.data || {};
    const handler = ACTION_HANDLERS[action];

    if (!handler) {
      throw new ApiError(ERROR_CODES.UNKNOWN_ACTION, '未知接口动作。');
    }

    const context = buildContext(cloud);
    const result = await handler({
      data,
      context,
      cloud
    });

    return ok(result, requestId);
  } catch (error) {
    if (error instanceof ApiError) {
      return fail(error.code, error.message, requestId);
    }

    return fail(ERROR_CODES.INTERNAL_ERROR, '云函数处理异常。', requestId);
  }
}

module.exports = {
  dispatch
};
