const cloud = require('wx-server-sdk');
const {
  FORMAL_ENV_ID,
  runCleanupWorker
} = require('./cleanup-worker.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  return runCleanupWorker({
    cloud,
    db: cloud.database(),
    envId: FORMAL_ENV_ID,
    logger: console
  });
};
