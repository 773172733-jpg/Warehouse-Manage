const ROUTES = require('../../constants/routes.js');
const productService = require('../../services/product-service.js');
const productView = require('../../utils/product-view.js');
const { createRequestKey } = require('../../utils/request-key.js');

Page({
  data: {
    items: [],
    keyword: '',
    searchFocused: false,
    selectedCategory: '全部',
    categories: productView.PRODUCT_CATEGORIES,
    loading: true,
    refreshing: false,
    loadingMore: false,
    initialized: false,
    error: '',
    hasMore: false,
    nextCursor: null
  },

  onLoad() {
    this.pageActive = true;
    this.queryVersion = 0;
    this.searchTimer = null;
    this.restoreIntents = Object.create(null);
    this.restoringProducts = Object.create(null);
    this.verifyAccessAndLoad();
  },

  onUnload() {
    this.pageActive = false;
    this.queryVersion += 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.restoreIntents = Object.create(null);
    this.restoringProducts = Object.create(null);
  },

  safeSetData(updates, callback) {
    if (this.pageActive) this.setData(updates, callback);
  },

  verifyAccessAndLoad() {
    const app = getApp();
    const ensure = app.globalData && app.globalData.bootstrapStatus === 'success'
      ? Promise.resolve()
      : (app.bootstrap ? app.bootstrap() : Promise.resolve());
    return ensure.then(() => {
      if (!this.pageActive) return;
      if (!app.globalData || app.globalData.currentRole !== 'owner') {
        wx.showToast({ title: '只有团队创建者可以查看共享目录回收站', icon: 'none' });
        wx.navigateBack({ fail: () => wx.switchTab({ url: ROUTES.PROFILE }) });
        return;
      }
      return this.reload();
    }).catch(() => {
      if (!this.pageActive) return;
      this.safeSetData({ loading: false, initialized: true, error: '团队状态读取失败，请稍后重试' });
    });
  },

  reload(options = {}) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    const version = this.queryVersion + 1;
    this.queryVersion = version;
    const refreshing = Boolean(options.refreshing);
    this.safeSetData({
      items: [],
      loading: !refreshing,
      refreshing,
      loadingMore: false,
      initialized: false,
      error: '',
      hasMore: false,
      nextCursor: null
    });
    return productService.listDeletedCatalogProducts(
      productView.buildDeletedCatalogListParams(this.data)
    ).then((response) => {
      if (!this.pageActive || version !== this.queryVersion) return;
      const result = productView.normalizeDeletedCatalogListResponse(response);
      this.safeSetData({
        items: result.items.map((item) => Object.assign({}, item, {
          restoring: Boolean(this.restoringProducts[item.productId])
        })),
        loading: false,
        refreshing: false,
        initialized: true,
        hasMore: result.hasMore && Boolean(result.nextCursor),
        nextCursor: result.nextCursor,
        error: ''
      });
    }).catch((error) => this.handleLoadError(error, version));
  },

  loadMore() {
    if (!this.pageActive || this.data.loading || this.data.loadingMore ||
        !this.data.hasMore || !this.data.nextCursor) return Promise.resolve();
    const version = this.queryVersion;
    this.safeSetData({ loadingMore: true, error: '' });
    return productService.listDeletedCatalogProducts(
      productView.buildDeletedCatalogListParams(this.data, this.data.nextCursor)
    ).then((response) => {
      if (!this.pageActive || version !== this.queryVersion) return;
      const result = productView.normalizeDeletedCatalogListResponse(response);
      const byId = new Map(this.data.items.map((item) => [item.productId, item]));
      result.items.forEach((item) => byId.set(item.productId, Object.assign({}, item, {
        restoring: Boolean(this.restoringProducts[item.productId])
      })));
      this.safeSetData({
        items: Array.from(byId.values()),
        loadingMore: false,
        hasMore: result.hasMore && Boolean(result.nextCursor),
        nextCursor: result.nextCursor
      });
    }).catch((error) => this.handleLoadError(error, version, true));
  },

  handleLoadError(error, version, loadingMore) {
    if (!this.pageActive || version !== this.queryVersion) return;
    if (productView.isContextInvalid(error)) {
      wx.reLaunch({ url: ROUTES.STARTUP });
      return;
    }
    if (error && error.code === 'FORBIDDEN') {
      wx.showToast({ title: '只有团队创建者可以查看共享目录回收站', icon: 'none' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: ROUTES.PROFILE }) });
      return;
    }
    this.safeSetData({
      loading: false,
      refreshing: false,
      loadingMore: false,
      initialized: true,
      error: loadingMore ? '加载更多失败，点击重试' : '共享目录回收站加载失败，请稍后重试'
    });
  },

  onPullDownRefresh() {
    return this.reload({ refreshing: true }).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  onSearchInput(event) {
    this.safeSetData({ keyword: event.detail.value || '' });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      if (this.pageActive) this.reload();
    }, productView.SEARCH_DEBOUNCE_MS);
  },

  onSearchClear() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.safeSetData({ keyword: '' }, () => this.reload());
  },

  onSearchFocus() { this.safeSetData({ searchFocused: true }); },
  onSearchBlur() { this.safeSetData({ searchFocused: false }); },

  onCategoryTap(event) {
    const category = String(event.currentTarget.dataset.category || '').trim();
    if (!productView.PRODUCT_CATEGORIES.includes(category) || category === this.data.selectedCategory) return;
    this.safeSetData({ selectedCategory: category }, () => this.reload());
  },

  handleRetry() {
    return this.data.items.length && this.data.hasMore ? this.loadMore() : this.reload();
  },

  onRestoreTap(event) {
    const productId = String(event.currentTarget.dataset.productId || '').trim();
    const item = this.data.items.find((candidate) => candidate.productId === productId);
    if (!item || !item.canRestore || item.restoring || !item.version) return;
    wx.showModal({
      title: '恢复共享产品目录',
      content: '确定恢复该共享产品目录吗？恢复后产品仍不会自动回到库存列表。',
      confirmText: '确认恢复',
      success: (result) => {
        if (result.confirm) this.restoreItem(item);
      }
    });
  },

  restoreItem(item) {
    const existingIntent = this.restoreIntents[item.productId];
    const intent = existingIntent || {
      requestKey: createRequestKey('catalog_restore'),
      expectedVersion: item.version
    };
    this.restoreIntents[item.productId] = intent;
    this.restoringProducts[item.productId] = true;
    this.safeSetData({
      items: this.data.items.map((candidate) => Object.assign({}, candidate, {
        restoring: candidate.productId === item.productId ? true : Boolean(candidate.restoring)
      }))
    });
    return productService.restoreCatalogProduct({
      productId: item.productId,
      expectedVersion: intent.expectedVersion,
      requestKey: intent.requestKey
    }).then(() => {
      if (!this.pageActive) return;
      delete this.restoreIntents[item.productId];
      delete this.restoringProducts[item.productId];
      this.safeSetData({
        items: this.data.items.filter((candidate) => candidate.productId !== item.productId)
      });
      wx.showModal({
        title: '共享产品目录已恢复',
        content: '产品不会自动回到库存列表。请前往产品回收站恢复仓库实例。',
        showCancel: false,
        confirmText: '我知道了'
      });
    }).catch((error) => {
      if (!this.pageActive) return;
      delete this.restoringProducts[item.productId];
      this.safeSetData({
        items: this.data.items.map((candidate) => Object.assign({}, candidate, {
          restoring: candidate.productId === item.productId ? false : Boolean(candidate.restoring)
        }))
      });
      const terminalCodes = [
        'REQUEST_KEY_CONFLICT',
        'PRODUCT_ALREADY_ACTIVE',
        'PRODUCT_VERSION_CONFLICT',
        'PRODUCT_WAREHOUSE_STATE_CONFLICT',
        'PRODUCT_LIMIT_REACHED'
      ];
      if (terminalCodes.includes(error && error.code)) delete this.restoreIntents[item.productId];
      if (error && error.code === 'PRODUCT_ALREADY_ACTIVE') {
        wx.showToast({ title: '该共享产品目录已经恢复', icon: 'none' });
        this.reload();
        return;
      }
      const messages = {
        PRODUCT_VERSION_CONFLICT: '产品状态已变化，正在刷新列表',
        PRODUCT_WAREHOUSE_STATE_CONFLICT: '产品仓库状态异常，请刷新后重试',
        PRODUCT_LIMIT_REACHED: '团队产品数量已达上限，暂时无法恢复',
        FORBIDDEN: '只有团队创建者可以恢复共享目录'
      };
      wx.showToast({ title: messages[error && error.code] || '恢复失败，请稍后重试', icon: 'none' });
      if (error && error.code === 'PRODUCT_VERSION_CONFLICT') this.reload();
    });
  }
});
