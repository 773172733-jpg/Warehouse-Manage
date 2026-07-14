function buildContext(cloud) {
  const wxContext = cloud.getWXContext();

  return {
    openId: wxContext.OPENID || '',
    appId: wxContext.APPID || '',
    unionId: wxContext.UNIONID || '',
    env: wxContext.ENV || ''
  };
}

module.exports = {
  buildContext
};
