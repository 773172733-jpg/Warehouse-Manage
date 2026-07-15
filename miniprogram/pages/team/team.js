var mock = require('./mock-members');
var utils = require('./team-utils');

var CURRENT_ROLE = 'owner';

Page({
  data: {
    team: mock.MOCK_TEAM,
    currentRole: CURRENT_ROLE,
    permission: utils.getPagePermissionFlags(CURRENT_ROLE),
    roleOptions: utils.getRoleOptions(),
    stats: {},
    keyword: '',
    activeRole: 'all',
    members: [],
    filteredMembers: [],
    resultCount: 0,
    hasMembers: true,
    detailOpen: false,
    inviteOpen: false,
    manageOpen: false,
    remarkOpen: false,
    selectedMember: null,
    remarkValue: '',
    remarkCount: 0,
    emptyTitle: '',
    emptyDescription: ''
  },

  onLoad: function () {
    this.refreshView();
  },

  refreshView: function () {
    var members = mock.MOCK_MEMBERS.map(function (member) {
      return utils.decorateMember(member, CURRENT_ROLE);
    });
    var filtered = utils.filterMembers(members, {
      keyword: this.data.keyword,
      role: this.data.activeRole
    });
    var empty = this.getEmptyState(filtered, members);

    this.setData({
      stats: utils.getMemberStatistics(members),
      members: members,
      filteredMembers: filtered,
      resultCount: filtered.length,
      hasMembers: members.length > 0,
      emptyTitle: empty.title,
      emptyDescription: empty.description
    });
  },

  getEmptyState: function (filtered, members) {
    if (!members.length) {
      return { title: '暂无团队成员', description: '邀请成员加入后会显示在这里' };
    }

    if (this.data.activeRole === 'pending') {
      return { title: '暂无待审核申请', description: '有成员申请加入团队时会显示在这里' };
    }

    if (!filtered.length) {
      return { title: '没有找到符合条件的成员', description: '尝试修改关键词或筛选条件' };
    }

    return { title: '', description: '' };
  },

  onSearchInput: function (event) {
    this.setData({ keyword: event.detail.value || '' });
    this.refreshView();
  },

  clearSearch: function () {
    this.setData({ keyword: '' });
    this.refreshView();
  },

  onRoleTap: function (event) {
    this.setData({ activeRole: event.currentTarget.dataset.role || 'all' });
    this.refreshView();
  },

  onStatTap: function (event) {
    this.setData({ activeRole: event.currentTarget.dataset.role || 'all' });
    this.refreshView();
  },

  clearFilters: function () {
    this.setData({ keyword: '', activeRole: 'all' });
    this.refreshView();
  },

  findMemberById: function (id) {
    var selected = null;
    this.data.members.some(function (member) {
      if (member.id === id) {
        selected = member;
        return true;
      }
      return false;
    });
    return selected;
  },

  openDetail: function (event) {
    var selected = this.findMemberById(event.currentTarget.dataset.id);
    if (!selected) {
      wx.showToast({ title: '成员不存在', icon: 'none' });
      return;
    }

    this.setData({
      selectedMember: selected,
      detailOpen: true,
      manageOpen: false,
      remarkOpen: false
    });
  },

  closeDetail: function () {
    this.setData({ detailOpen: false });
  },

  openManageMenu: function (event) {
    var selected = this.findMemberById(event.currentTarget.dataset.id);
    if (!selected) {
      wx.showToast({ title: '成员不存在', icon: 'none' });
      return;
    }

    this.setData({
      selectedMember: selected,
      manageOpen: true,
      detailOpen: false,
      remarkOpen: false
    });
  },

  closeManageMenu: function () {
    this.setData({ manageOpen: false });
  },

  openInvite: function () {
    if (!this.data.permission.canInviteMembers) return;
    this.setData({ inviteOpen: true });
  },

  closeInvite: function () {
    this.setData({ inviteOpen: false });
  },

  copyInviteCode: function () {
    wx.setClipboardData({
      data: this.data.team.inviteCode,
      success: function () {
        wx.showToast({ title: '邀请码已复制', icon: 'success' });
      },
      fail: function () {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      }
    });
  },

  shareInvite: function () {
    wx.showToast({ title: '分享能力将在后续团队接口接入后完成', icon: 'none' });
  },

  refreshInviteCode: function () {
    wx.showModal({
      title: '刷新邀请码',
      content: '确认刷新团队邀请码？',
      confirmColor: '#078B4B',
      success: function (res) {
        if (!res.confirm) return;
        wx.showToast({ title: '邀请码刷新功能将在后续接入', icon: 'none' });
      }
    });
  },

  confirmAction: function (event) {
    var action = event.currentTarget.dataset.action;
    var member = this.data.selectedMember;
    var config = this.getActionConfig(action, member);
    if (!config) return;

    wx.showModal({
      title: config.title,
      content: config.content,
      confirmText: config.confirmText,
      confirmColor: config.danger ? '#D94A45' : '#078B4B',
      success: function (res) {
        if (!res.confirm) return;
        wx.showToast({ title: '成员管理功能将在后续阶段接入，本次未真实修改数据', icon: 'none' });
      }
    });
  },

  getActionConfig: function (action, member) {
    if (!member) return null;

    var name = member.name;
    var map = {
      promote: { title: '设置管理员', content: '确认将“' + name + '”设置为管理员？该成员以后可以管理产品和库存。', confirmText: '确认', danger: false },
      demote: { title: '取消管理员', content: '确认取消“' + name + '”的管理员权限？该成员将变为普通成员。', confirmText: '确认', danger: false },
      remove: { title: '移除成员', content: '确认将“' + name + '”移出团队？该成员将无法继续查看团队库存。', confirmText: '移除', danger: true },
      approve: { title: '通过申请', content: '确认允许“' + name + '”加入团队？', confirmText: '通过', danger: false },
      reject: { title: '拒绝申请', content: '确认拒绝“' + name + '”的加入申请？', confirmText: '拒绝', danger: true }
    };

    return map[action] || null;
  },

  openRemarkEditor: function () {
    var member = this.data.selectedMember;
    if (!member || !member.canEditRemark) return;

    var value = member.rawRemark || '';
    this.setData({
      remarkOpen: true,
      manageOpen: false,
      detailOpen: false,
      remarkValue: value,
      remarkCount: value.length
    });
  },

  onRemarkInput: function (event) {
    var value = String(event.detail.value || '').slice(0, 20);
    this.setData({ remarkValue: value, remarkCount: value.length });
  },

  closeRemarkEditor: function () {
    this.setData({ remarkOpen: false });
  },

  submitRemark: function () {
    wx.showToast({ title: '备注修改将在后续阶段接入，本次未真实修改数据', icon: 'none' });
    this.closeRemarkEditor();
  },

  stopPropagation: function () {}
});
