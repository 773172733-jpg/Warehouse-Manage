const ROUTES = require('../../constants/routes.js');
const productService = require('../../services/product-service.js');
const productView = require('../../utils/product-view.js');

const ALERT_FILTERS = [
  { value: 'low', label: '低库存' },
  { value: 'out', label: '已缺货' }
];

function normalizeAlertType(value) {
  return value === 'out' ? 'out' : 'low';
}

function decorateAlertItem(item) {
  const minStock = Number.isSafeInteger(item.minStock) ? item.minStock : 0;
  const stock = Number.isSafeInteger(item.stock) ? item.stock : 0;
  const recommendedQuantity = Math.max(minStock - stock, 0);
  let replenishmentText = '';
  if (item.stockStatus === 'out') {
    replenishmentText = minStock > 0
      ? '建议补货 ' + recommendedQuantity + (item.unit || '')
      : '最低库存未设置，请手动评估';
  } else if (recommendedQuantity > 0) {
    replenishmentText = '还差 ' + recommendedQuantity + (item.unit || '') + ' 达到安全库存';
  } else {
    replenishmentText = '已达到最低库存线，建议补货';
  }
  return Object.assign({}, item, {
    recommendedQuantity,
    replenishmentText
  });
}

Page({
  data: {
    items: [],
    loading: true,
    refreshing: false,
    loadingMore: false,
    initialized: false,
    error: '',
    hasMore: false,
    nextCursor: null,
    alertType: 'low',
    selectedStockStatus: 'low',
    keyword: '',
    selectedCategory: '全部',
    searchFocused: false,
    categories: productView.PRODUCT_CATEGORIES,
    alertFilters: ALERT_FILTERS,
    warehouseName: '当前仓库',
    canOperateStock: false,
    overviewCount: 0,
    queryVersion: 0
  },

  onLoad(query) {
    this.pageActive = true;
    this.queryVersion = 0;
    this.searchTimer = null;
    this.preparingPromise = null;
    this.awaitingStockReturn = false;
    this.navigatingToStartup = false;
    const alertType = normalizeAlertType(query && query.alertType);
    this.setData({
      alertType,
      selectedStockStatus: alertType
    });
  },

  onShow() {
    const app = getApp();
    this.applyCurrentContext();
    const refreshRequired = Boolean(
      app.globalData && app.globalData.stockAlertsRefreshRequired
    );
    if (refreshRequired && app.globalData) {
      app.globalData.stockAlertsRefreshRequired = false;
    }
    if (!this.data.initialized || refreshRequired || this.awaitingStockReturn) {
      this.awaitingStockReturn = false;
      this.prepareAndReload();
    }
  },

  onUnload() {
    this.pageActive = false;
    this.queryVersion += 1;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  onPullDownRefresh() {
    return this.prepareAndReload({ refreshing: true, forceBootstrap: true })
      .finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  safeSetData(updates, callback) {
    if (this.pageActive) this.setData(updates, callback);
  },

  applyCurrentContext() {
    const app = getApp();
    const role = app.globalData && app.globalData.currentRole;
    const warehouse = app.globalData && app.globalData.currentWarehouse;
    this.safeSetData({
      canOperateStock: role === 'owner' || role === 'admin',
      warehouseName: warehouse && warehouse.name ? warehouse.name : '当前仓库'
    });
  },

  prepareAndReload(options = {}) {
    if (this.preparingPromise) return this.preparingPromise;
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
        if (!result || result.onboardingRequired || !result.membership ||
            !result.team || !result.warehouse) {
          this.openStartup();
          return null;
        }
        this.applyCurrentContext();
        return this.reload({ refreshing: Boolean(options.refreshing) });
      })
      .catch((error) => {
        if (!this.pageActive) return;
        if (productView.isContextInvalid(error)) return this.recoverContext();
        this.safeSetData({
          loading: false,
          refreshing: false,
          initialized: true,
          error: productView.getLoadErrorMessage(error)
        });
      })
      .finally(() => {
        if (this.preparingPromise === currentPromise) this.preparingPromise = null;
      });
    this.preparingPromise = currentPromise;
    return currentPromise;
  },

  buildListParams(cursor) {
    return productView.buildListParams({
      keyword: this.data.keyword,
      selectedCategory: this.data.selectedCategory,
      selectedStockStatus: this.data.alertType
    }, cursor);
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
      nextCursor: null,
      overviewCount: 0,
      queryVersion: version
    });
    return productService.listProducts(this.buildListParams())
      .then((response) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        const normalized = productView.normalizeListResponse(response);
        const items = productView.mergeInventoryItems(
          [],
          normalized.items.map(decorateAlertItem)
        );
        const summary = normalized.summary;
        this.safeSetData({
          items,
          loading: false,
          refreshing: false,
          initialized: true,
          error: '',
          hasMore: normalized.hasMore && Boolean(normalized.nextCursor),
          nextCursor: normalized.nextCursor,
          overviewCount: summary
            ? (this.data.alertType === 'out' ? summary.outCount : summary.lowCount)
            : items.length
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        if (productView.isContextInvalid(error)) return this.recoverContext();
        this.safeSetData({
          items: [],
          loading: false,
          refreshing: false,
          initialized: true,
          error: productView.getLoadErrorMessage(error),
          hasMore: false,
          nextCursor: null
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
    return productService.listProducts(this.buildListParams(cursor))
      .then((response) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        const normalized = productView.normalizeListResponse(response);
        const items = productView.mergeInventoryItems(
          this.data.items,
          normalized.items.map(decorateAlertItem)
        );
        this.safeSetData({
          items,
          loadingMore: false,
          error: '',
          hasMore: normalized.hasMore && Boolean(normalized.nextCursor),
          nextCursor: normalized.nextCursor
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.queryVersion) return;
        if (error && error.code === 'INVALID_CURSOR') {
          wx.showToast({ title: '筛选已变化，正在重新加载', icon: 'none' });
          return this.reload();
        }
        if (productView.isContextInvalid(error)) return this.recoverContext();
        this.safeSetData({
          loadingMore: false,
          error: productView.getLoadErrorMessage(error)
        });
      });
  },

  onAlertTypeTap(event) {
    const alertType = String(event.currentTarget.dataset.alertType || '').trim();
    if (!ALERT_FILTERS.some((item) => item.value === alertType) ||
        alertType === this.data.alertType) {
      return;
    }
    this.safeSetData({
      alertType,
      selectedStockStatus: alertType
    }, () => this.reload());
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

  onSearchFocus() {
    this.safeSetData({ searchFocused: true });
  },

  onSearchBlur() {
    this.safeSetData({ searchFocused: false });
  },

  onCategoryTap(event) {
    const category = String(event.currentTarget.dataset.category || '').trim();
    if (!productView.PRODUCT_CATEGORIES.includes(category) ||
        category === this.data.selectedCategory) {
      return;
    }
    this.safeSetData({ selectedCategory: category }, () => this.reload());
  },

  handleRetry() {
    return this.data.items.length && this.data.hasMore ? this.loadMore() : this.prepareAndReload();
  },

  onCardTap(event) {
    const id = String(event.currentTarget.dataset.warehouseProductId || '').trim();
    if (!id) return;
    wx.navigateTo({
      url: ROUTES.PRODUCT_DETAIL + '?warehouseProductId=' + encodeURIComponent(id)
    });
  },

  onInboundTap(event) {
    if (!this.data.canOperateStock) return;
    const id = String(event.currentTarget.dataset.warehouseProductId || '').trim();
    if (!id) return;
    this.awaitingStockReturn = true;
    wx.navigateTo({
      url: '/pages/stock-operation/stock-operation?mode=inbound&warehouseProductId=' +
        encodeURIComponent(id),
      fail: () => {
        this.awaitingStockReturn = false;
      }
    });
  },

  onCoverImageError(event) {
    const id = String(event.currentTarget.dataset.warehouseProductId || '').trim();
    const index = this.data.items.findIndex((item) => item.warehouseProductId === id);
    if (index < 0) return;
    this.safeSetData({
      ['items[' + index + '].cover']: productView.markCoverImageFailed(
        this.data.items[index].cover,
        this.data.items[index].name
      )
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
      initialized: false,
      error: '',
      hasMore: false,
      nextCursor: null
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
