const { ApiError, ERROR_CODES, isApiError } = require('./errors.js');
const { COLLECTIONS, getDocument } = require('./database.js');
const { createUserId } = require('./idempotency.js');

function requireOpenId(context) {
  if (!context || !context.openId) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '无法确认当前微信身份。');
  }
  return context.openId;
}

async function requireUser(db, context) {
  const openId = requireOpenId(context);
  const userId = createUserId(openId);

  try {
    let user = await getDocument(db, COLLECTIONS.USERS, userId);

    if (!user) {
      const result = await db.collection(COLLECTIONS.USERS)
        .where({ openId })
        .limit(1)
        .get();
      user = result.data && result.data[0];
    }
    if (!user) {
      throw new ApiError(ERROR_CODES.USER_NOT_FOUND, '当前用户尚未初始化。');
    }
    if (user.status !== 'active') {
      throw new ApiError(ERROR_CODES.USER_DISABLED, '当前用户已停用。');
    }
    return user;
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw new ApiError(ERROR_CODES.DATABASE_ERROR, '用户状态读取失败，请稍后重试。');
  }
}

module.exports = {
  requireOpenId,
  requireUser
};
