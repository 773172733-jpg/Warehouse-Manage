const ROUTES = require('../../constants/routes.js');
const productService = require('../../services/product-service.js');
const productView = require('../../utils/product-view.js');

const STOCK_FILTERS = [
  { value: '', label: '全部' },
  { value: 'normal', label: '正常' },
  { value: 'low', label: '低库存' },
  { value: 'out', label: '缺货' }
];

Page({
  data: {
    items: [],
    loading: true,
    refreshing: false,
    loadingMore: false,
    error: '',
    hasMore: false,
    nextCursor: null,
    keyword: '',
    selectedCategory: '全部',
    selectedStockStatus: '',
    queryVersion: 0,
    initialized: false,
    categories: productView.PRODUCT_CATEGORIES,
    stockFilters: STOCK_FILTERS,
    summary: { total: 0, lowCount: 0, outCount: 0 },
    warehouseName: '当前仓库',
    placeholder: '搜索产品名称、型号或编号',
    searchFocused: false,
    canCreateProduct: false
  },

  onLoad() {
    this.pageActive = true;
    this.searchTimer = null;
    this.queryVersion = 0;
    this.preparingPromise = null;
    this.awaitingCreateReturn = false;
    this.navigatingToStartup = false;
  },

  onShow() {
    const app = getApp();
    this.applyCurrentRole();
    const needsRefresh = Boolean(app.globalData && app.globalData.inventoryRefreshRequired);
    if (needsRefresh && app.globalData) app.globalData.inventoryRefreshRequired = false;
    if (!this.data.initialized || this.awaitingCreateReturn || needsRefresh) {
      this.awaitingCreateReturn = false;
      this.prepareAndReload();
    }
  },

  onUnload() {
    this.pageActive = false;
    this.queryVersion += 1;
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  },

  onPullDownRefresh() {
    return this.prepareAndReload({ refreshing: true, forceBootstrap: true })
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  onReachBottom() {
    this.loadMore();
  },

  safeSetData(updates, callback) {
    if (this.pageActive) {
      this.setData(updates, callback);
    }
  },

  applyCurrentRole() {
    const app = getApp();
    const role = app.globalData && app.globalData.currentRole;
    const warehouse = app.globalData && app.globalData.currentWarehouse;
    this.safeSetData({
      canCreateProduct: role === 'owner' || role === 'admin',
      warehouseName: warehouse && warehouse.name ? warehouse.name : '当前仓库'
    });
  },

  prepareAndReload(options = {}) {
    if (this.preparingPromise) {
      return this.preparingPromise;
    }
    const app = getApp();
    const needsBootstrap = options.forceBootstrap ||
      !app.globalData || app.globalData.bootstrapStatus !== 'success';
    const bootstrap = needsBootstrap && app.bootstrap
      ? app.bootstrap({ forceRefresh: Boolean(options.forceBootstrap) })
      : Promise.resolve({
        membership: app.globalData && app.globalData.currentMembership,
        team: app.globalData && app.globalData.currentTeam,
        warehouse: app.globalData && app.globalData.currentWarehouse,
        onboardingRequired: !(app.globalData && app.globalData.currentTeam)
      });

    const currentPromise = bootstrap
      .then((result) => {
        if (!this.pageActive) return null;
        if (!result || result.onboardingRequired || !result.membership || !result.team || !result.warehouse) {
          this.openStartup();
          return null;
        }
        this.applyCurrentRole();
        return this.reloadInventory({ refreshing: Boolean(options.refreshing) });
      })
      .catch((error) => {
        if (!this.pageActive) return;
        if (productView.isContextInvalid(error)) {
          return this.recoverContext();
        }
        this.safeSetData({
          loading: false,
          refreshing: false,
          initialized: true,
          error: productView.getLoadErrorMessage(error)
        });
      })
      .finally(() => {
        if (this.preparingPromise === currentPromise) {
          this.preparingPromise = null;
        }
      });
    this.preparingPromise = currentPromise;
    return currentPromise;
  },

  reloadInventory(options = {}) {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
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
      nextCursor: null,
      queryVersion: version,
      summary: { total: 0, lowCount: 0, outCount: 0 }
    });

    const params = productView.buildListParams(this.data);
    return productService.listProducts(params)
      .then((response) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        const normalized = productView.normalizeListResponse(response);
        const items = productView.mergeInventoryItems([], normalized.items);
        this.safeSetData({
          items,
          loading: false,
          refreshing: false,
          error: '',
          hasMore: normalized.hasMore && Boolean(normalized.nextCursor),
          nextCursor: normalized.nextCursor,
          initialized: true,
          summary: productView.getLoadedSummary(items)
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        if (productView.isContextInvalid(error)) {
          return this.recoverContext();
        }
        this.safeSetData({
          items: [],
          loading: false,
          refreshing: false,
          error: productView.getLoadErrorMessage(error),
          hasMore: false,
          nextCursor: null,
          initialized: true,
          summary: { total: 0, lowCount: 0, outCount: 0 }
        });
      });
  },

  loadMore() {
    if (!this.pageActive || this.data.loading || this.data.refreshing ||
        this.data.loadingMore || !this.data.hasMore || !this.data.nextCursor) {
      return Promise.resolve();
    }
    const version = this.queryVersion;
    const cursor = this.data.nextCursor;
    this.safeSetData({ loadingMore: true, error: '' });
    const params = productView.buildListParams(this.data, cursor);
    return productService.listProducts(params)
      .then((response) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        const normalized = productView.normalizeListResponse(response);
        const items = productView.mergeInventoryItems(this.data.items, normalized.items);
        this.safeSetData({
          items,
          loadingMore: false,
          error: '',
          hasMore: normalized.hasMore && Boolean(normalized.nextCursor),
          nextCursor: normalized.nextCursor,
          summary: productView.getLoadedSummary(items)
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        if (error && error.code === 'INVALID_CURSOR') {
          wx.showToast({ title: '列表状态已失效，正在重新加载', icon: 'none' });
          return this.reloadInventory();
        }
        if (productView.isContextInvalid(error)) {
          return this.recoverContext();
        }
        this.safeSetData({
          loadingMore: false,
          error: productView.getLoadErrorMessage(error)
        });
      });
  },

  handleRetry() {
    if (this.data.items.length && this.data.hasMore && this.data.nextCursor) {
      return this.loadMore();
    }
    return this.prepareAndReload();
  },

  onSearchInput(event) {
    const keyword = event.detail.value || '';
    this.safeSetData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      if (this.pageActive) this.reloadInventory();
    }, productView.SEARCH_DEBOUNCE_MS);
  },

  onSearchClear() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.safeSetData({ keyword: '' }, () => this.reloadInventory());
  },

  onSearchFocus() {
    this.safeSetData({ searchFocused: true });
  },

  onSearchBlur() {
    this.safeSetData({ searchFocused: false });
  },

  onCategoryTap(event) {
    const category = String(event.currentTarget.dataset.category || '').trim();
    if (!productView.PRODUCT_CATEGORIES.includes(category) || category === this.data.selectedCategory) {
      return;
    }
    this.safeSetData({ selectedCategory: category }, () => this.reloadInventory());
  },

  onStockStatusTap(event) {
    const stockStatus = String(event.currentTarget.dataset.status || '').trim();
    const allowed = STOCK_FILTERS.some((item) => item.value === stockStatus);
    if (!allowed || stockStatus === this.data.selectedStockStatus) return;
    this.safeSetData({ selectedStockStatus: stockStatus }, () => this.reloadInventory());
  },

  onAddTap() {
    const app = getApp();
    const role = app.globalData && app.globalData.currentRole;
    if (role !== 'owner' && role !== 'admin') {
      wx.showToast({ title: '你没有创建产品的权限', icon: 'none', duration: 2000 });
      return;
    }
    this.awaitingCreateReturn = true;
    wx.navigateTo({
      url: '/pages/product-edit/product-edit?mode=create',
      fail: () => {
        this.awaitingCreateReturn = false;
      }
    });
  },

  onCardTap(event) {
    this.openProduct(event.currentTarget.dataset.warehouseProductId);
  },

  onCoverImageError(event) {
    const warehouseProductId = event.currentTarget.dataset.warehouseProductId;
    if (!warehouseProductId) return;
    const match = this.data.items.find(item => item.warehouseProductId === warehouseProductId);
    if (!match || !match.cover || match.cover.type !== 'image') return;
    const path = 'items[' + this.data.items.indexOf(match) + '].cover';
    this.safeSetData({ [path]: productView.markCoverImageFailed(match.cover, match.name) });
  },

  onCardMenu(event) {
    const warehouseProductId = event.currentTarget.dataset.warehouseProductId;
    if (!warehouseProductId) return;
    if (!this.data.canCreateProduct) {
      this.openProduct(warehouseProductId);
      return;
    }
    wx.showActionSheet({
      itemList: ['查看详情', '入库', '出库'],
      success: (result) => {
        if (result.tapIndex === 0) {
          this.openProduct(warehouseProductId);
        } else {
          this.openStockOperation(warehouseProductId, result.tapIndex === 1 ? 'inbound' : 'outbound');
        }
      }
    });
  },

  openStockOperation(warehouseProductId, mode) {
    const id = String(warehouseProductId || '').trim();
    if (!id) {
      wx.showToast({ title: '产品标识无效，请刷新后重试', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/stock-operation/stock-operation?mode=' + encodeURIComponent(mode) +
        '&warehouseProductId=' + encodeURIComponent(id)
    });
  },

  openProduct(warehouseProductId) {
    const id = String(warehouseProductId || '').trim();
    if (!id) {
      wx.showToast({ title: '产品标识无效，请刷新后重试', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: '/pages/product-detail/product-detail?warehouseProductId=' + encodeURIComponent(id)
    });
  },

  recoverContext() {
    const app = getApp();
    this.queryVersion += 1;
    this.safeSetData({
      items: [],
      loading: false,
      refreshing: false,
      loadingMore: false,
      error: '',
      hasMore: false,
      nextCursor: null,
      initialized: false,
      summary: { total: 0, lowCount: 0, outCount: 0 }
    });
    if (app.clearTeamContext) app.clearTeamContext();
    const refresh = app.bootstrap ? app.bootstrap({ forceRefresh: true }) : Promise.resolve();
    return refresh.catch(() => null).then(() => {
      if (this.pageActive) this.openStartup();
    });
  },

  openStartup() {
    if (this.navigatingToStartup) return;
    this.navigatingToStartup = true;
    wx.reLaunch({
      url: ROUTES.STARTUP,
      fail: () => {
        this.navigatingToStartup = false;
      }
    });
  }
});
