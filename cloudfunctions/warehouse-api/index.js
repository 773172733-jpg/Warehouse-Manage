const cloud = require('wx-server-sdk');
const router = require('./router.js');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

exports.main = async (event = {}) => {
  return router.dispatch(event, cloud);
};
