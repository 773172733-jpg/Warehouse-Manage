const ROLES = require('../constants/roles.js');

// 仅用于页面展示控制。真实权限必须由云函数基于可信身份和 team_members 查询验证。
function isOwner(role) {
  return role === ROLES.OWNER;
}

function isAdmin(role) {
  return role === ROLES.ADMIN || isOwner(role);
}

function canWriteInventory(role) {
  return isAdmin(role);
}

function canManageMembers(role) {
  return isOwner(role);
}

module.exports = {
  isOwner,
  isAdmin,
  canWriteInventory,
  canManageMembers
};
