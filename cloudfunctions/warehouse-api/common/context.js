function buildContext(cloud) {
  const wxContext = cloud.getWXContext();

  return {
    openId: wxContext.OPENID || '',
    appId: wxContext.APPID || '',
    env: wxContext.ENV || ''
  };
}

module.exports = {
  buildContext
};
