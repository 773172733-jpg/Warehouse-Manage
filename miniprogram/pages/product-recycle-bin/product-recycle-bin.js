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
    this.deleteIntents = Object.create(null);
    this.deletingProducts = Object.create(null);
    this.verifyAccessAndLoad();
  },

  onUnload() {
    this.pageActive = false;
    this.queryVersion += 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.restoreIntents = Object.create(null);
    this.restoringProducts = Object.create(null);
    this.deleteIntents = Object.create(null);
    this.deletingProducts = Object.create(null);
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
      const role = app.globalData && app.globalData.currentRole;
      if (role !== 'owner' && role !== 'admin') {
        wx.showToast({ title: '你没有查看产品回收站的权限', icon: 'none' });
        wx.navigateBack({ fail: () => wx.switchTab({ url: ROUTES.INVENTORY }) });
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
      error: '',
      hasMore: false,
      nextCursor: null
    });
    return productService.listRemovedProducts(productView.buildRemovedListParams(this.data))
      .then((response) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        const result = productView.normalizeRemovedListResponse(response);
        this.safeSetData({
          items: result.items.map((item) => Object.assign({}, item, {
            restoring: Boolean(this.restoringProducts[item.warehouseProductId]),
            deletingCatalog: Boolean(this.deletingProducts[item.productId])
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
    return productService.listRemovedProducts(
      productView.buildRemovedListParams(this.data, this.data.nextCursor)
    ).then((response) => {
      if (!this.pageActive || version !== this.queryVersion) return;
      const result = productView.normalizeRemovedListResponse(response);
      const byId = new Map(this.data.items.map((item) => [item.warehouseProductId, item]));
      result.items.forEach((item) => byId.set(item.warehouseProductId, Object.assign({}, item, {
        restoring: Boolean(this.restoringProducts[item.warehouseProductId]),
        deletingCatalog: Boolean(this.deletingProducts[item.productId])
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
      wx.showToast({ title: '你没有查看产品回收站的权限', icon: 'none' });
      wx.navigateBack({ fail: () => wx.switchTab({ url: ROUTES.INVENTORY }) });
      return;
    }
    this.safeSetData({
      loading: false,
      refreshing: false,
      loadingMore: false,
      initialized: true,
      error: loadingMore ? '加载更多失败，点击重试' : '产品回收站加载失败，请稍后重试'
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
    const id = String(event.currentTarget.dataset.warehouseProductId || '').trim();
    const item = this.data.items.find((candidate) => candidate.warehouseProductId === id);
    if (!item || !item.canRestore || item.restoring || item.deletingCatalog) return;
    wx.showModal({
      title: '恢复产品',
      content: '确定将该产品恢复到当前仓库吗？恢复后库存为0。',
      confirmText: '确认恢复',
      success: (result) => {
        if (result.confirm) this.restoreItem(id);
      }
    });
  },

  restoreItem(warehouseProductId) {
    const current = this.data.items.find((item) => item.warehouseProductId === warehouseProductId);
    if (!current || current.restoring) return Promise.resolve();
    const requestKey = this.restoreIntents[warehouseProductId] || createRequestKey('product_restore');
    this.restoreIntents[warehouseProductId] = requestKey;
    this.restoringProducts[warehouseProductId] = true;
    this.safeSetData({
      items: this.data.items.map((item) => Object.assign({}, item, {
        restoring: item.warehouseProductId === warehouseProductId ? true : Boolean(item.restoring)
      }))
    });
    return productService.restoreProductToWarehouse({ warehouseProductId, requestKey })
      .then(() => {
        if (!this.pageActive) return;
        delete this.restoreIntents[warehouseProductId];
        delete this.restoringProducts[warehouseProductId];
        const app = getApp();
        if (app.globalData) app.globalData.inventoryRefreshRequired = true;
        this.safeSetData({
          items: this.data.items.filter((item) => item.warehouseProductId !== warehouseProductId)
        });
        wx.showToast({ title: '产品已恢复', icon: 'success' });
        return this.reload();
      }).catch((error) => {
        if (!this.pageActive) return;
        delete this.restoringProducts[warehouseProductId];
        this.safeSetData({
          items: this.data.items.map((item) => Object.assign({}, item, {
            restoring: item.warehouseProductId === warehouseProductId ? false : Boolean(item.restoring)
          }))
        });
        if (error && error.code === 'REQUEST_KEY_CONFLICT') delete this.restoreIntents[warehouseProductId];
        if (error && error.code === 'PRODUCT_ALREADY_ACTIVE') {
          delete this.restoreIntents[warehouseProductId];
          const app = getApp();
          if (app.globalData) app.globalData.inventoryRefreshRequired = true;
          wx.showToast({ title: '该产品已经恢复到当前仓库', icon: 'none' });
          this.reload();
          return;
        }
        const messages = {
          PRODUCT_CATALOG_DELETED: '共享产品目录已删除，暂时无法恢复',
          PRODUCT_HAS_STOCK: '回收站产品库存异常，无法恢复',
          FORBIDDEN: '你没有执行该操作的权限'
        };
        wx.showToast({ title: messages[error && error.code] || '恢复失败，请稍后重试', icon: 'none' });
      });
  },

  onDeleteCatalogTap(event) {
    const productId = String(event.currentTarget.dataset.productId || '').trim();
    const item = this.data.items.find((candidate) => candidate.productId === productId);
    if (!item || !item.canDeleteCatalog || item.deletingCatalog || item.restoring) return;
    wx.showModal({
      title: '从共享目录删除',
      content: '这会从整个团队的共享产品目录中删除该产品。所有仓库必须已移除该产品，历史库存流水仍会永久保留。',
      confirmText: '继续删除',
      confirmColor: '#D94A45',
      success: (result) => {
        if (result.confirm) this.askDeleteReason(item);
      }
    });
  },

  askDeleteReason(item) {
    wx.showModal({
      title: '删除原因（可选）',
      editable: true,
      placeholderText: '最多100个字符',
      confirmText: '确认删除',
      confirmColor: '#D94A45',
      success: (result) => {
        if (result.confirm) this.deleteCatalogItem(item, String(result.content || '').trim());
      }
    });
  },

  deleteCatalogItem(item, reason) {
    if (!item || !item.productId || item.deletingCatalog || !item.productVersion) {
      return Promise.resolve();
    }
    const intent = this.deleteIntents[item.productId] || {
      requestKey: createRequestKey('catalog_delete'),
      expectedVersion: item.productVersion,
      reason
    };
    this.deleteIntents[item.productId] = intent;
    this.deletingProducts[item.productId] = true;
    this.safeSetData({
      items: this.data.items.map((candidate) => Object.assign({}, candidate, {
        deletingCatalog: candidate.productId === item.productId
          ? true
          : Boolean(candidate.deletingCatalog)
      }))
    });
    return productService.deleteCatalogProduct({
      productId: item.productId,
      expectedVersion: intent.expectedVersion,
      reason: intent.reason,
      requestKey: intent.requestKey
    }).then(() => {
      if (!this.pageActive) return;
      delete this.deleteIntents[item.productId];
      delete this.deletingProducts[item.productId];
      wx.showToast({ title: '已从共享产品目录删除', icon: 'success' });
      return this.reload();
    }).catch((error) => {
      if (!this.pageActive) return;
      delete this.deletingProducts[item.productId];
      this.safeSetData({
        items: this.data.items.map((candidate) => Object.assign({}, candidate, {
          deletingCatalog: candidate.productId === item.productId
            ? false
            : Boolean(candidate.deletingCatalog)
        }))
      });
      const terminalCodes = [
        'REQUEST_KEY_CONFLICT',
        'PRODUCT_ALREADY_DELETED',
        'PRODUCT_VERSION_CONFLICT',
        'PRODUCT_STILL_IN_WAREHOUSE',
        'PRODUCT_WAREHOUSE_STATE_CONFLICT'
      ];
      if (terminalCodes.includes(error && error.code)) delete this.deleteIntents[item.productId];
      if (error && error.code === 'PRODUCT_ALREADY_DELETED') {
        wx.showToast({ title: '该共享产品目录已经删除', icon: 'none' });
        this.reload();
        return;
      }
      const messages = {
        PRODUCT_VERSION_CONFLICT: '产品状态已变化，正在刷新列表',
        PRODUCT_STILL_IN_WAREHOUSE: '该产品仍存在于仓库中，请先从所有仓库移除',
        PRODUCT_WAREHOUSE_STATE_CONFLICT: '产品仓库状态异常，请刷新后重试',
        INVALID_DELETE_REASON: '删除原因不能超过100个字符',
        FORBIDDEN: '只有团队创建者可以删除共享目录'
      };
      wx.showToast({ title: messages[error && error.code] || '删除失败，请稍后重试', icon: 'none' });
      if (error && error.code === 'PRODUCT_VERSION_CONFLICT') this.reload();
    });
  },

  onCoverImageError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.items[index]) return;
    const item = this.data.items[index];
    this.safeSetData({
      [`items[${index}].cover`]: productView.getCoverView(null, item.name)
    });
  }
});
