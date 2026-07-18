const ROUTES = require('../../constants/routes.js');
const productService = require('../../services/product-service.js');
const productView = require('../../utils/product-view.js');
const { createRequestKey } = require('../../utils/request-key.js');

Page({
  data: {
    loading: true,
    error: '',
    errorTitle: '产品加载失败',
    canRetry: true,
    loaded: false,
    product: null,
    warehouseProduct: null,
    permissions: { canEdit: false, canOperateStock: false, canRemove: false },
    descExpanded: false,
    descNeedsExpand: false,
    navStyle: '',
    navSideStyle: '',
    stockLabel: '当前库存',
    stockSub: '',
    removing: false
  },

  onLoad(query) {
    this.pageActive = true;
    this.requestVersion = 0;
    this.detailPromise = null;
    this.navigatingToStartup = false;
    this.awaitingEditReturn = false;
    this.removeRequestKey = '';
    this.calcNavStyle();
    this.warehouseProductId = productView.getWarehouseProductId(query);
    if (!this.warehouseProductId) {
      this.safeSetData({
        loading: false,
        loaded: true,
        errorTitle: '无法打开产品',
        error: '产品标识无效，请返回库存页重新选择',
        canRetry: false
      });
      return;
    }
    this.loadDetail();
  },

  onUnload() {
    this.pageActive = false;
    this.requestVersion += 1;
  },

  onShow() {
    if (this.awaitingEditReturn || this.awaitingStockReturn) {
      this.awaitingEditReturn = false;
      this.awaitingStockReturn = false;
      this.loadDetail();
    }
  },

  safeSetData(updates, callback) {
    if (this.pageActive) this.setData(updates, callback);
  },

  loadDetail() {
    if (!this.warehouseProductId || this.detailPromise) {
      return this.detailPromise || Promise.resolve();
    }
    const version = this.requestVersion + 1;
    this.requestVersion = version;
    this.safeSetData({ loading: true, error: '', canRetry: true });
    const currentPromise = productService.getProductDetail({
      warehouseProductId: this.warehouseProductId
    })
      .then((response) => {
        if (!this.pageActive || version !== this.requestVersion) return;
        const detail = productView.mapProductDetail(response);
        const stockMeta = computeStockMeta(detail.warehouseProduct, detail.product.unit);
        this.safeSetData({
          loading: false,
          loaded: true,
          error: '',
          errorTitle: '产品加载失败',
          canRetry: true,
          product: detail.product,
          warehouseProduct: detail.warehouseProduct,
          permissions: detail.permissions,
          descExpanded: false,
          descNeedsExpand: detail.product.description.length > 80,
          stockLabel: stockMeta.label,
          stockSub: stockMeta.sub
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.requestVersion) return;
        if (productView.isContextInvalid(error)) {
          return this.recoverContext();
        }
        const missing = error && [
          'PRODUCT_NOT_FOUND',
          'PRODUCT_NOT_ACTIVE',
          'PRODUCT_NOT_IN_WAREHOUSE'
        ].includes(error.code);
        this.safeSetData({
          loading: false,
          loaded: true,
          product: null,
          warehouseProduct: null,
          permissions: { canEdit: false, canOperateStock: false, canRemove: false },
          errorTitle: missing ? '产品不可用' : '产品加载失败',
          error: productView.getLoadErrorMessage(error),
          canRetry: !missing
        });
      })
      .finally(() => {
        if (this.detailPromise === currentPromise) {
          this.detailPromise = null;
        }
      });
    this.detailPromise = currentPromise;
    return currentPromise;
  },

  handleRetry() {
    return this.loadDetail();
  },

  calcNavStyle() {
    const system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    const statusBar = system.statusBarHeight || 20;
    const hasMenuRect = menu && menu.width > 0 && menu.height > 0 && menu.left > 0;
    const navHeight = hasMenuRect ? Math.max(44, (menu.top - statusBar) * 2 + menu.height) : 44;
    const sideWidth = hasMenuRect ? Math.max(48, system.windowWidth - menu.left + 8) : 48;
    this.safeSetData({
      navStyle: 'padding-top:' + statusBar + 'px;height:' + navHeight + 'px',
      navSideStyle: 'width:' + sideWidth + 'px'
    });
  },

  toggleDesc() {
    this.safeSetData({ descExpanded: !this.data.descExpanded });
  },

  onInbound() {
    if (!this.data.permissions.canOperateStock) return;
    this.openStockOperation('inbound');
  },

  onOutbound() {
    if (!this.data.permissions.canOperateStock) return;
    this.openStockOperation('outbound');
  },

  onAdjust() {
    if (!this.data.permissions.canOperateStock) return;
    this.openStockOperation('adjustment');
  },

  openStockRecords() {
    if (!this.warehouseProductId) {
      wx.showToast({ title: '产品标识无效，请刷新后重试', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: ROUTES.STOCK_RECORDS + '?warehouseProductId=' +
        encodeURIComponent(this.warehouseProductId)
    });
  },

  onMore() {
    if (this.data.removing) return;
    const actions = [];
    if (this.data.permissions.canEdit) actions.push({ label: '编辑产品', type: 'edit' });
    if (this.data.permissions.canOperateStock) actions.push({ label: '盘点调整', type: 'stock' });
    if (this.data.permissions.canRemove) actions.push({ label: '移出当前仓库', type: 'remove' });
    if (!actions.length) return;
    wx.showActionSheet({
      itemList: actions.map((item) => item.label),
      success: (result) => {
        const action = actions[result.tapIndex];
        if (!action) return;
        if (action.type === 'edit') {
          this.openEdit();
        } else if (action.type === 'remove') {
          this.confirmRemove();
        } else {
          this.openStockOperation('adjustment');
        }
      }
    });
  },

  openStockOperation(mode) {
    if (!this.warehouseProductId) {
      wx.showToast({ title: '产品标识无效，请刷新后重试', icon: 'none' });
      return;
    }
    this.awaitingStockReturn = true;
    wx.navigateTo({
      url: '/pages/stock-operation/stock-operation?mode=' + encodeURIComponent(mode) +
        '&warehouseProductId=' + encodeURIComponent(this.warehouseProductId),
      fail: () => {
        this.awaitingStockReturn = false;
      }
    });
  },

  openEdit() {
    if (!this.data.permissions.canEdit || !this.warehouseProductId) return;
    this.awaitingEditReturn = true;
    wx.navigateTo({
      url: '/pages/product-edit/product-edit?mode=edit&warehouseProductId=' +
        encodeURIComponent(this.warehouseProductId),
      fail: () => {
        this.awaitingEditReturn = false;
      }
    });
  },

  confirmRemove() {
    if (!this.data.permissions.canRemove || this.data.removing || !this.data.warehouseProduct) return;
    if (this.data.warehouseProduct.stock !== 0) {
      wx.showModal({
        title: '暂时无法移除',
        content: '当前库存不为0，请先完成出库或库存调整',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    wx.showModal({
      title: '从当前仓库移除',
      content: '移除后产品将从当前仓库列表隐藏，历史库存流水仍会保留。',
      confirmText: '确认移除',
      confirmColor: '#D94A45',
      success: (result) => {
        if (result.confirm) this.removeFromWarehouse();
      }
    });
  },

  removeFromWarehouse() {
    if (this.data.removing || !this.warehouseProductId) return Promise.resolve();
    const app = getApp();
    const requestKey = this.removeRequestKey || createRequestKey('product_remove');
    this.removeRequestKey = requestKey;
    this.safeSetData({ removing: true });
    return productService.removeProductFromWarehouse({
      warehouseProductId: this.warehouseProductId,
      reason: '',
      requestKey
    }).then(() => {
      if (!this.pageActive) return;
      this.removeRequestKey = '';
      this.safeSetData({ removing: false });
      if (app.globalData) app.globalData.inventoryRefreshRequired = true;
      wx.showToast({ title: '已从当前仓库移除', icon: 'success', duration: 1500 });
      wx.switchTab({ url: ROUTES.INVENTORY });
    }).catch((error) => {
      if (!this.pageActive) return;
      this.safeSetData({ removing: false });
      if (error && error.code === 'REQUEST_KEY_CONFLICT') this.removeRequestKey = '';
      if (error && error.code === 'PRODUCT_ALREADY_REMOVED') {
        this.removeRequestKey = '';
        if (app.globalData) app.globalData.inventoryRefreshRequired = true;
        wx.showToast({ title: '该产品已经从当前仓库移除', icon: 'none' });
        wx.switchTab({ url: ROUTES.INVENTORY });
        return;
      }
      if (productView.isContextInvalid(error)) {
        this.recoverContext();
        return;
      }
      const message = error && error.code === 'PRODUCT_HAS_STOCK'
        ? '当前库存不为0，请先完成出库或库存调整'
        : (error && error.code === 'FORBIDDEN' ? '你没有执行该操作的权限' : '移除失败，请稍后重试');
      wx.showToast({ title: message, icon: 'none', duration: 2500 });
    });
  },

  recoverContext() {
    const app = getApp();
    this.requestVersion += 1;
    this.safeSetData({
      loading: false,
      loaded: false,
      error: '',
      product: null,
      warehouseProduct: null,
      permissions: { canEdit: false, canOperateStock: false, canRemove: false }
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
  },

  goToInventory() {
    wx.switchTab({ url: ROUTES.INVENTORY });
  },

  onCoverImageError() {
    if (!this.data.product) return;
    this.safeSetData({
      'product.cover': productView.getCoverView(null, this.data.product.name)
    });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: ROUTES.INVENTORY });
      }
    });
  }
});

function computeStockMeta(warehouseProduct, unit) {
  if (!warehouseProduct) return { label: '当前库存', sub: '' };
  const status = warehouseProduct.stockStatus;
  const stock = warehouseProduct.stock;
  const minStock = warehouseProduct.minStock;
  if (status === 'out') return { label: '当前库存', sub: '无可用库存，需尽快补货' };
  if (status === 'low' && stock !== null && minStock !== null) {
    const gap = Math.max(0, minStock - stock);
    return {
      label: '当前库存',
      sub: gap > 0 ? '低于安全库存' + gap + (unit || '') + '，建议补货' : '已达到安全库存下限，建议补货'
    };
  }
  if (status === 'normal') return { label: '当前库存', sub: '库存充足，无需补货' };
  return { label: '当前库存', sub: '库存状态暂不可用，请刷新确认' };
}
