const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES } = require('../../constants/errors.js');
const teamService = require('../../services/team-service.js');
const utils = require('./team-utils.js');

const DEFAULT_INVITE_HOURS = 24;
const DEFAULT_INVITE_MAX_USES = 20;

Page({
  data: {
    pageStatus: 'loading',
    errorMessage: '',
    team: {
      name: '',
      warehouseName: '',
      roleLabel: ''
    },
    currentRole: '',
    permission: utils.getPagePermissionFlags(''),
    stats: { all: 0, owner: 0, admin: 0, viewer: 0, pending: 0 },
    roleOptions: utils.getRoleOptions(),
    keyword: '',
    activeRole: 'all',
    activeMembers: [],
    filteredMembers: [],
    pendingMembers: [],
    invite: utils.mapInviteResponse({ invite: null }),
    inviteLoading: false,
    inviteRefreshing: false,
    inviteError: '',
    reviewingMemberId: '',
    memberSheetOpen: false,
    selectedMember: null,
    memberOperation: { memberId: '', action: '' },
    noteEditorOpen: false,
    draftAdminNote: '',
    noteSaving: false,
    leaving: false
  },

  onLoad() {
    this.isActive = true;
    this.isNavigating = false;
    this.refreshSequence = 0;
    this.refreshPromise = null;
    this.inviteRefreshIntent = null;
    this.reviewIntent = null;
    this.memberRoleIntent = null;
    this.memberRemoveIntent = null;
    this.leaveIntent = null;
    this.setData({ noteEditorOpen: false, noteSaving: false });
  },

  onShow() {
    this.refreshPage({ forceBootstrap: true });
  },

  onUnload() {
    this.isActive = false;
    this.refreshSequence += 1;
    this.inviteRefreshIntent = null;
    this.reviewIntent = null;
    this.memberRoleIntent = null;
    this.memberRemoveIntent = null;
    this.leaveIntent = null;
  },

  onPullDownRefresh() {
    this.refreshPage({ forceBootstrap: true })
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  refreshPage(options = {}) {
    if (this.refreshPromise || this.isNavigating) {
      return this.refreshPromise || Promise.resolve();
    }

    const sequence = this.refreshSequence + 1;
    this.refreshSequence = sequence;
    if (this.data.pageStatus !== 'ready') {
      this.setData({ pageStatus: 'loading', errorMessage: '' });
    }

    const app = getApp();
    const currentPromise = app.bootstrap({ forceRefresh: Boolean(options.forceBootstrap) })
      .then((result) => {
        if (!this.isActive || sequence !== this.refreshSequence) {
          return null;
        }
        if (result.onboardingRequired || !result.team || !result.membership) {
          this.openStartup();
          return null;
        }

        const currentRole = result.membership.role;
        const permission = utils.getPagePermissionFlags(currentRole);
        this.setData({
          currentRole,
          permission,
          inviteLoading: permission.canManageInvites,
          team: {
            name: result.team.name || '未命名团队',
            warehouseName: result.warehouse ? result.warehouse.name : '默认仓库',
            roleLabel: utils.formatRole(currentRole).label
          }
        });

        const activeRequest = teamService.listMembers({ status: 'active' });
        const pendingRequest = permission.canViewPending
          ? teamService.listMembers({ status: 'pending' })
          : Promise.resolve({ members: [], total: 0 });
        const inviteRequest = permission.canManageInvites
          ? teamService.getCurrentInvite()
            .then((response) => ({ ok: true, response }))
            .catch((error) => ({ ok: false, error }))
          : Promise.resolve({ ok: true, response: { invite: null } });

        return Promise.all([activeRequest, pendingRequest, inviteRequest])
          .then(([activeResponse, pendingResponse, inviteResult]) => ({
            currentRole,
            permission,
            activeResponse,
            pendingResponse,
            inviteResult
          }));
      })
      .then((payload) => {
        if (!payload || !this.isActive || sequence !== this.refreshSequence) {
          return;
        }

        const activeMembers = utils.mapMemberResponse(payload.activeResponse, 'active');
        const pendingMembers = payload.permission.canViewPending
          ? utils.mapMemberResponse(payload.pendingResponse, 'pending')
          : [];
        const stats = utils.getMemberStatistics(
          activeMembers,
          pendingMembers,
          payload.permission.isOwner
        );
        const filteredMembers = utils.filterMembers(activeMembers, {
          keyword: this.data.keyword,
          role: this.data.activeRole
        });
        const invite = payload.permission.canManageInvites && payload.inviteResult.ok
          ? utils.mapInviteResponse(payload.inviteResult.response)
          : this.data.invite;
        const inviteError = payload.permission.canManageInvites && !payload.inviteResult.ok
          ? utils.getInviteErrorMessage(payload.inviteResult.error)
          : '';
        const selectedMember = this.data.memberSheetOpen && this.data.selectedMember
          ? activeMembers.find((item) => item.id === this.data.selectedMember.id)
          : null;
        const nextSelectedMember = selectedMember
          ? Object.assign(
            {},
            selectedMember,
            utils.getMemberDetailActions(payload.currentRole, selectedMember)
          )
          : null;

        this.setData({
          pageStatus: 'ready',
          errorMessage: '',
          activeMembers,
          filteredMembers,
          pendingMembers,
          stats,
          invite: payload.permission.canManageInvites
            ? invite
            : utils.mapInviteResponse({ invite: null }),
          inviteLoading: false,
          inviteError,
          memberSheetOpen: Boolean(nextSelectedMember),
          selectedMember: nextSelectedMember
        });
      })
      .catch((error) => {
        if (!this.isActive || sequence !== this.refreshSequence) {
          return;
        }
        if (utils.isMembershipContextInvalid(error)) {
          return this.recoverMembershipContext();
        }
        if (this.isActive && sequence === this.refreshSequence) {
          this.setData({
            pageStatus: 'error',
            errorMessage: utils.getTeamLoadErrorMessage(error),
            inviteLoading: false
          });
        }
      })
      .finally(() => {
        if (this.refreshPromise === currentPromise) {
          this.refreshPromise = null;
        }
      });

    this.refreshPromise = currentPromise;
    return currentPromise;
  },

  handleRetry() {
    this.refreshPage({ forceBootstrap: true });
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value || '' });
    this.applyMemberFilter();
  },

  clearSearch() {
    this.setData({ keyword: '' });
    this.applyMemberFilter();
  },

  onRoleTap(event) {
    this.setData({ activeRole: event.currentTarget.dataset.role || 'all' });
    this.applyMemberFilter();
  },

  clearFilters() {
    this.setData({ keyword: '', activeRole: 'all' });
    this.applyMemberFilter();
  },

  applyMemberFilter() {
    this.setData({
      filteredMembers: utils.filterMembers(this.data.activeMembers, {
        keyword: this.data.keyword,
        role: this.data.activeRole
      })
    });
  },

  handleMemberTap(event) {
    const memberId = String(event.currentTarget.dataset.id || '');
    const member = this.data.activeMembers.find((item) => item.id === memberId);
    if (!member) {
      wx.showToast({ title: '该成员已不在当前列表', icon: 'none' });
      return;
    }
    this.memberRoleIntent = null;
    this.memberRemoveIntent = null;
    this.setData({
      memberSheetOpen: true,
      selectedMember: Object.assign(
        {},
        member,
        utils.getMemberDetailActions(this.data.currentRole, member)
      )
    });
  },

  closeMemberSheet() {
    if (this.data.memberOperation.memberId || this.data.noteSaving) {
      return;
    }
    this.dismissMemberSheet();
    this.memberRoleIntent = null;
    this.memberRemoveIntent = null;
  },

  dismissMemberSheet() {
    if (this.isActive) {
      this.setData({ memberSheetOpen: false, selectedMember: null });
    }
  },

  stopPropagation() {},

  openAdminNoteEditor() {
    const member = this.data.selectedMember;
    if (!member || !member.canEditAdminNote || this.data.noteSaving) {
      return;
    }
    this.setData({
      noteEditorOpen: true,
      draftAdminNote: member.adminNote || ''
    });
  },

  closeAdminNoteEditor() {
    if (!this.data.noteSaving) {
      this.setData({ noteEditorOpen: false, draftAdminNote: '' });
    }
  },

  onAdminNoteInput(event) {
    this.setData({ draftAdminNote: event.detail.value || '' });
  },

  saveAdminNote() {
    const member = this.data.selectedMember;
    if (!member || !member.canEditAdminNote || this.data.noteSaving) {
      return;
    }
    this.setData({ noteSaving: true });
    teamService.updateAdminNote({
      targetMemberId: member.id,
      adminNote: this.data.draftAdminNote
    })
      .then(() => {
        if (!this.isActive) return;
        this.setData({ noteEditorOpen: false, draftAdminNote: '' });
        wx.showToast({ title: '管理备注已更新', icon: 'success' });
        return this.refreshPage({ forceBootstrap: false });
      })
      .catch((error) => {
        if (this.isActive) {
          wx.showToast({
            title: error && error.message ? error.message : '管理备注保存失败，请重试',
            icon: 'none'
          });
        }
      })
      .finally(() => {
        if (this.isActive) {
          this.setData({ noteSaving: false });
        }
      });
  },

  handleMemberRoleAction() {
    const member = this.data.selectedMember;
    if (!member || !member.canChangeRole || this.data.memberOperation.memberId) {
      return;
    }
    const promoting = member.targetRole === 'admin';
    wx.showModal({
      title: promoting ? '设为管理员' : '取消管理员',
      content: promoting
        ? `确认将“${member.name}”设为管理员？管理员将获得后续仓库管理权限。`
        : `确认取消“${member.name}”的管理员角色？该成员将恢复为普通成员。`,
      confirmText: promoting ? '确认设置' : '确认取消',
      confirmColor: '#078B4B',
      success: (result) => {
        if (result.confirm) {
          this.executeMemberRoleChange(member);
        } else {
          this.memberRoleIntent = null;
        }
      }
    });
  },

  executeMemberRoleChange(member) {
    if (this.data.memberOperation.memberId) {
      return;
    }
    const signature = `${member.id}:${member.targetRole}`;
    this.memberRoleIntent = utils.ensureActionIntent(
      signature,
      this.memberRoleIntent,
      'member-role'
    );
    this.setData({ memberOperation: { memberId: member.id, action: 'role' } });

    return teamService.updateMemberRole({
      memberId: member.id,
      role: member.targetRole,
      requestKey: this.memberRoleIntent.requestKey
    })
      .then(() => {
        if (!this.isActive) {
          return;
        }
        this.memberRoleIntent = null;
        this.setData({ memberOperation: { memberId: '', action: '' } });
        this.dismissMemberSheet();
        wx.showToast({
          title: member.targetRole === 'admin' ? '已设为管理员' : '已取消管理员',
          icon: 'success'
        });
        return this.refreshPage();
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        if (!utils.shouldReuseMembershipRequestKey(error)) {
          this.memberRoleIntent = null;
        }
        wx.showToast({
          title: utils.getMembershipActionErrorMessage('role', error),
          icon: 'none'
        });
        if (utils.shouldRefreshAfterMembershipActionError(error)) {
          return this.refreshPage({ forceBootstrap: true });
        }
      })
      .finally(() => {
        if (this.isActive) {
          this.setData({ memberOperation: { memberId: '', action: '' } });
        }
      });
  },

  handleRemoveMember() {
    const member = this.data.selectedMember;
    if (!member || !member.canRemove || this.data.memberOperation.memberId) {
      return;
    }
    wx.showModal({
      title: '移出团队',
      content: `确定将“${member.name}”移出团队吗？移出后，该成员将无法继续访问当前团队数据。`,
      confirmText: '确认移出',
      confirmColor: '#D94A45',
      success: (result) => {
        if (result.confirm) {
          this.executeRemoveMember(member);
        } else {
          this.memberRemoveIntent = null;
        }
      }
    });
  },

  executeRemoveMember(member) {
    if (this.data.memberOperation.memberId) {
      return;
    }
    this.memberRemoveIntent = utils.ensureActionIntent(
      member.id,
      this.memberRemoveIntent,
      'member-remove'
    );
    this.setData({ memberOperation: { memberId: member.id, action: 'remove' } });

    return teamService.removeMember({
      memberId: member.id,
      reason: '由团队创建者移出团队',
      requestKey: this.memberRemoveIntent.requestKey
    })
      .then(() => {
        if (!this.isActive) {
          return;
        }
        this.memberRemoveIntent = null;
        this.setData({ memberOperation: { memberId: '', action: '' } });
        this.dismissMemberSheet();
        wx.showToast({ title: '成员已移出团队', icon: 'success' });
        return this.refreshPage();
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        if (!utils.shouldReuseMembershipRequestKey(error)) {
          this.memberRemoveIntent = null;
        }
        wx.showToast({
          title: utils.getMembershipActionErrorMessage('remove', error),
          icon: 'none'
        });
        if (utils.shouldRefreshAfterMembershipActionError(error)) {
          return this.refreshPage({ forceBootstrap: true });
        }
      })
      .finally(() => {
        if (this.isActive) {
          this.setData({ memberOperation: { memberId: '', action: '' } });
        }
      });
  },

  handleLeaveTeam() {
    if (!this.data.permission.canLeaveTeam || this.data.leaving) {
      return;
    }
    wx.showModal({
      title: '退出团队',
      content: '确定退出当前团队吗？退出后将无法继续访问团队仓库和成员数据。',
      confirmText: '确认退出',
      confirmColor: '#D94A45',
      success: (result) => {
        if (result.confirm) {
          this.executeLeaveTeam();
        } else {
          this.leaveIntent = null;
        }
      }
    });
  },

  executeLeaveTeam() {
    if (this.data.leaving || !this.data.permission.canLeaveTeam) {
      return;
    }
    this.leaveIntent = utils.ensureActionIntent('leave-team', this.leaveIntent, 'team-leave');
    this.setData({ leaving: true });

    return teamService.leaveTeam({ requestKey: this.leaveIntent.requestKey })
      .then(() => {
        if (!this.isActive) {
          return;
        }
        this.leaveIntent = null;
        wx.showToast({ title: '已退出团队', icon: 'success' });
        return this.finishMembershipExit();
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        if (!utils.shouldReuseMembershipRequestKey(error)) {
          this.leaveIntent = null;
        }
        wx.showToast({
          title: utils.getMembershipActionErrorMessage('leave', error),
          icon: 'none'
        });
        if (utils.shouldRefreshAfterMembershipActionError(error)) {
          return this.reconcileLeaveState();
        }
      })
      .finally(() => {
        if (this.isActive) {
          this.setData({ leaving: false });
        }
      });
  },

  reconcileLeaveState() {
    return getApp().bootstrap({ forceRefresh: true })
      .then((result) => {
        if (this.isActive && result.onboardingRequired) {
          this.leaveIntent = null;
          this.openStartup();
        }
      })
      .catch(() => {
        // 保留原操作错误提示，由用户手动重试，不自动循环请求。
      });
  },

  finishMembershipExit() {
    const app = getApp();
    app.clearTeamContext();
    return app.bootstrap({ forceRefresh: true })
      .catch(() => null)
      .then(() => {
        if (this.isActive) {
          this.openStartup();
        }
      });
  },

  recoverMembershipContext() {
    const app = getApp();
    app.clearTeamContext();
    this.memberRoleIntent = null;
    this.memberRemoveIntent = null;
    this.leaveIntent = null;
    this.dismissMemberSheet();
    return app.bootstrap({ forceRefresh: true })
      .catch(() => null)
      .then(() => {
        if (this.isActive) {
          this.openStartup();
        }
      });
  },

  copyInviteCode() {
    if (!this.data.permission.canManageInvites || !this.data.invite.hasInvite) {
      return;
    }
    wx.setClipboardData({
      data: this.data.invite.code,
      success: () => {
        wx.showToast({ title: '邀请码已复制', icon: 'success' });
      },
      fail: () => {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      }
    });
  },

  handleInviteAction() {
    if (!this.data.permission.canManageInvites || this.data.inviteRefreshing) {
      return;
    }
    const hasInvite = this.data.invite.hasInvite;
    wx.showModal({
      title: hasInvite ? '刷新邀请码' : '生成邀请码',
      content: hasInvite
        ? '刷新后原邀请码将立即失效，是否继续？'
        : '将生成新的团队邀请码，是否继续？',
      confirmText: hasInvite ? '确认刷新' : '确认生成',
      confirmColor: '#078B4B',
      success: (result) => {
        if (result.confirm) {
          this.executeInviteRefresh();
        }
      }
    });
  },

  executeInviteRefresh() {
    if (this.data.inviteRefreshing) {
      return;
    }
    this.inviteRefreshIntent = utils.ensureActionIntent(
      'invite-refresh',
      this.inviteRefreshIntent,
      'invite'
    );
    this.setData({ inviteRefreshing: true, inviteError: '' });

    teamService.refreshInvite({
      requestKey: this.inviteRefreshIntent.requestKey,
      expiresInHours: DEFAULT_INVITE_HOURS,
      maxUses: DEFAULT_INVITE_MAX_USES
    })
      .then((response) => {
        if (!this.isActive) {
          return;
        }
        const invite = utils.mapInviteResponse(response);
        if (!invite.hasInvite) {
          const error = new Error('云端未返回有效邀请码。');
          error.code = ERROR_CODES.INTERNAL_ERROR;
          throw error;
        }
        this.inviteRefreshIntent = null;
        this.setData({ invite, inviteError: '' });
        wx.showToast({ title: '邀请码已更新', icon: 'success' });

        return teamService.getCurrentInvite()
          .then((confirmedResponse) => {
            if (!this.isActive) {
              return;
            }
            const confirmed = utils.mapInviteResponse(confirmedResponse);
            if (confirmed.hasInvite) {
              this.setData({ invite: confirmed, inviteError: '' });
            } else {
              this.setData({ inviteError: '邀请码已更新，但状态确认失败，请下拉刷新。' });
            }
          })
          .catch(() => {
            if (this.isActive) {
              this.setData({ inviteError: '邀请码已更新，但状态确认失败，请下拉刷新。' });
            }
          });
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        if (!utils.shouldReuseInviteRequestKey(error)) {
          this.inviteRefreshIntent = null;
        }
        this.setData({ inviteError: utils.getInviteErrorMessage(error) });
      })
      .finally(() => {
        if (this.isActive) {
          this.setData({ inviteRefreshing: false });
        }
      });
  },

  handleReview(event) {
    if (!this.data.permission.canReviewMembers || this.data.reviewingMemberId) {
      return;
    }
    const memberId = String(event.currentTarget.dataset.id || '');
    const decision = event.currentTarget.dataset.decision;
    const member = this.data.pendingMembers.find((item) => item.id === memberId);
    if (!member || !['approve', 'reject'].includes(decision)) {
      wx.showToast({ title: '该申请不存在或已被处理', icon: 'none' });
      return;
    }

    const approve = decision === 'approve';
    wx.showModal({
      title: approve ? '同意加入' : '拒绝申请',
      content: approve
        ? `确认允许“${member.name}”加入团队？`
        : `确认拒绝“${member.name}”的加入申请？`,
      confirmText: approve ? '同意' : '拒绝',
      confirmColor: approve ? '#078B4B' : '#D94A45',
      success: (result) => {
        if (result.confirm) {
          this.executeReview(member, decision);
        }
      }
    });
  },

  executeReview(member, decision) {
    if (this.data.reviewingMemberId) {
      return;
    }
    const signature = `${member.id}:${decision}`;
    this.reviewIntent = utils.ensureActionIntent(signature, this.reviewIntent, 'review');
    this.setData({ reviewingMemberId: member.id });

    teamService.reviewMember({
      memberId: member.id,
      decision,
      remark: '',
      requestKey: this.reviewIntent.requestKey
    })
      .then(() => {
        if (!this.isActive) {
          return;
        }
        this.reviewIntent = null;
        this.setData({
          pendingMembers: this.data.pendingMembers.filter((item) => item.id !== member.id)
        });
        wx.showToast({
          title: decision === 'approve' ? '已同意加入团队' : '已拒绝该申请',
          icon: 'success'
        });
        return this.refreshPage();
      })
      .catch((error) => {
        if (!this.isActive) {
          return;
        }
        wx.showToast({ title: utils.getReviewErrorMessage(error), icon: 'none' });
        if (!utils.shouldReuseReviewRequestKey(error)) {
          this.reviewIntent = null;
        }
        if (utils.shouldRefreshAfterReviewError(error)) {
          this.refreshPage();
        }
      })
      .finally(() => {
        if (this.isActive) {
          this.setData({ reviewingMemberId: '' });
        }
      });
  },

  openStartup() {
    if (this.isNavigating) {
      return;
    }
    this.isNavigating = true;
    wx.reLaunch({
      url: ROUTES.STARTUP,
      fail: () => {
        this.isNavigating = false;
        if (this.isActive) {
          this.setData({
            pageStatus: 'error',
            errorMessage: '身份状态跳转失败，请重新进入小程序。'
          });
        }
      }
    });
  }
});
