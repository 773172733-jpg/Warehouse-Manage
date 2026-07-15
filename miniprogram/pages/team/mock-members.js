var MOCK_TEAM = {
  id: 'team-local-001',
  name: '轻仓设计团队',
  warehouseName: '默认仓库',
  memberCount: 8,
  createdAt: '2026-07-01',
  ownerName: '官明基',
  inviteCode: 'QW2026',
  inviteExpireAt: '24小时',
  displayCode: 'LW-001'
};

var MOCK_MEMBERS = [
  { id: 'member-owner-001', name: '官明基', avatarText: '官', avatarColor: '#078B4B', role: 'owner', status: 'active', joinedAt: '2026-07-01', lastActiveAt: '刚刚', remark: '团队创建者', isCurrentUser: true },
  { id: 'member-admin-001', name: '林晓', avatarText: '林', avatarColor: '#2E8F65', role: 'admin', status: 'active', joinedAt: '2026-07-02', lastActiveAt: '10分钟前', remark: '负责入库复核', isCurrentUser: false },
  { id: 'member-admin-002', name: '周亦', avatarText: '周', avatarColor: '#4A9470', role: 'admin', status: 'active', joinedAt: '2026-07-03', lastActiveAt: '今天 09:30', remark: '库存盘点负责人', isCurrentUser: false },
  { id: 'member-viewer-001', name: '张三', avatarText: '张', avatarColor: '#8A9690', role: 'viewer', status: 'active', joinedAt: '2026-07-04', lastActiveAt: '昨天', remark: '只查看办公用品', isCurrentUser: false },
  { id: 'member-viewer-002', name: '陈静', avatarText: '陈', avatarColor: '#89978C', role: 'viewer', status: 'active', joinedAt: '2026-07-06', lastActiveAt: '2天前', remark: '设计物料领取', isCurrentUser: false },
  { id: 'member-viewer-003', name: '王北', avatarText: '王', avatarColor: '#7F8A86', role: 'viewer', status: 'active', joinedAt: '2026-07-08', lastActiveAt: '本周', remark: '', isCurrentUser: false },
  { id: 'member-viewer-004', name: '赵晴', avatarText: '赵', avatarColor: '#808C88', role: 'viewer', status: 'active', joinedAt: '2026-07-09', lastActiveAt: '3天前', remark: '外出物资登记', isCurrentUser: false },
  { id: 'member-pending-001', name: '许愿', avatarText: '许', avatarColor: '#E59A23', role: 'viewer', status: 'pending', joinedAt: '2026-07-15', lastActiveAt: '待审核', remark: '申请加入团队', isCurrentUser: false }
];

module.exports = {
  MOCK_TEAM: MOCK_TEAM,
  MOCK_MEMBERS: MOCK_MEMBERS
};
