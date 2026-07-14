module.exports = async function ping({ context }) {
  return {
    status: 'ok',
    serverTime: Date.now(),
    hasOpenId: Boolean(context.openId)
  };
};
