const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES, ERROR_MESSAGES } = require('../../constants/errors.js');
const productService = require('../../services/product-service.js');
const stockService = require('../../services/stock-service.js');
const productView = require('../../utils/product-view.js');

const PAGE_SIZE = 20;
const TYPE_OPTIONS = Object.freeze([
  { value: 'all', label: '全部' },
  { value: 'initial', label: '初始库存' },
  { value: 'inbound', label: '入库' },
  { value: 'outbound', label: '出库' },
  { value: 'adjustment', label: '盘点调整' }
]);
const TYPE_META = Object.freeze({
  initial: { label: '初始库存', tone: 'initial' },
  inbound: { label: '入库', tone: 'inbound' },
  outbound: { label: '出库', tone: 'outbound' },
  adjustment: { label: '盘点调整', tone: 'adjustment' }
});

function formatDateTime(value) {
  if (!value) return '时间未知';
  const source = value && typeof value === 'object' && value.$date
    ? value.$date
    : value;
  const date = source instanceof Date ? source : new Date(source);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const pad = (part) => String(part).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' +
    pad(date.getMinutes());
}

function getRoleLabel(role) {
  if (role === 'owner') return '所有者';
  if (role === 'admin') return '管理员';
  return '操作成员';
}

function mapRecord(record, unit) {
  const type = TYPE_META[record && record.type]
    ? record.type
    : 'initial';
  const meta = TYPE_META[type];
  const delta = Number.isSafeInteger(record && record.delta)
    ? record.delta
    : 0;
  const reason = record && record.reason === 'initial_stock'
    ? '初始建档'
    : String((record && record.reason) || '');

  return {
    id: String((record && record.id) || ''),
    type,
    typeLabel: meta.label,
    tone: meta.tone,
    delta,
    deltaText: (delta > 0 ? '+' : '') + delta,
    beforeStock: Number.isSafeInteger(record && record.beforeStock)
      ? record.beforeStock
      : 0,
    afterStock: Number.isSafeInteger(record && record.afterStock)
      ? record.afterStock
      : 0,
    unit,
    reason,
    referenceNo: String((record && record.referenceNo) || ''),
    operatorDisplayName: String((record && record.operatorDisplayName) || ''),
    operatorRoleLabel: getRoleLabel(record && record.operatorRole),
    showOperatorName: Boolean(
      record &&
      record.operatorDisplayName &&
      record.operatorDisplayName !== getRoleLabel(record.operatorRole)
    ),
    createdAtText: formatDateTime(record && record.createdAt),
    stockVersionText: Number.isSafeInteger(record && record.stockVersionAfter)
      ? 'v' + record.stockVersionAfter
      : ''
  };
}

function getListErrorMessage(error) {
  if (error && error.code === ERROR_CODES.UNKNOWN_ACTION) {
    return '云函数还不是最新版本，请先重新部署 warehouse-api';
  }
  return ERROR_MESSAGES[error && error.code] ||
    (error && error.message) ||
    '库存流水加载失败，请稍后重试';
}

Page({
  data: {
    loading: true,
    loadingMore: false,
    error: '',
    product: null,
    activeType: 'all',
    typeOptions: TYPE_OPTIONS,
    records: [],
    nextCursor: '',
    hasMore: false,
    navStyle: '',
    navSideStyle: ''
  },

  onLoad(query) {
    this.pageActive = true;
    this.listVersion = 0;
    this.detailVersion = 0;
    this.calcNavStyle();
    this.warehouseProductId = productView.getWarehouseProductId(query);
    if (!this.warehouseProductId) {
      this.setData({
        loading: false,
        error: '产品标识无效，请返回产品详情重新进入'
      });
      return;
    }
    this.loadFirstPage();
  },

  onUnload() {
    this.pageActive = false;
    this.listVersion += 1;
    this.detailVersion += 1;
  },

  onReachBottom() {
    this.loadMore();
  },

  safeSetData(updates, callback) {
    if (this.pageActive) this.setData(updates, callback);
  },

  calcNavStyle() {
    const system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const menu = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : null;
    const statusBar = system.statusBarHeight || 20;
    const hasMenuRect = menu && menu.width > 0 && menu.height > 0 && menu.left > 0;
    const navHeight = hasMenuRect
      ? Math.max(44, (menu.top - statusBar) * 2 + menu.height)
      : 44;
    const sideWidth = hasMenuRect
      ? Math.max(48, system.windowWidth - menu.left + 8)
      : 48;
    this.safeSetData({
      navStyle: 'padding-top:' + statusBar + 'px;height:' + navHeight + 'px',
      navSideStyle: 'width:' + sideWidth + 'px'
    });
  },

  loadProductSummary() {
    const version = this.detailVersion + 1;
    this.detailVersion = version;
    return productService.getProductDetail({
      warehouseProductId: this.warehouseProductId
    }).then((response) => {
      if (!this.pageActive || version !== this.detailVersion) return;
      const detail = productView.mapProductDetail(response);
      this.safeSetData({
        product: {
          name: detail.product.name,
          code: detail.product.productCode,
          unit: detail.product.unit,
          stock: detail.warehouseProduct.stock,
          stockStatus: detail.warehouseProduct.stockStatus
        }
      });
    });
  },

  loadFirstPage() {
    const version = this.listVersion + 1;
    this.listVersion = version;
    this.safeSetData({
      loading: true,
      loadingMore: false,
      error: '',
      records: [],
      nextCursor: '',
      hasMore: false
    });

    return Promise.all([
      this.data.product ? Promise.resolve() : this.loadProductSummary(),
      this.fetchRecordPage('', version)
    ]).then((results) => {
      if (!this.pageActive || version !== this.listVersion) return;
      const page = results[1];
      const unit = this.data.product ? this.data.product.unit : '';
      this.safeSetData({
        loading: false,
        records: page.items.map((item) => mapRecord(item, unit)),
        nextCursor: page.nextCursor || '',
        hasMore: Boolean(page.hasMore)
      });
    }).catch((error) => {
      if (!this.pageActive || version !== this.listVersion) return;
      if (productView.isContextInvalid(error)) {
        this.recoverContext();
        return;
      }
      this.safeSetData({
        loading: false,
        loadingMore: false,
        error: getListErrorMessage(error)
      });
    });
  },

  fetchRecordPage(cursor, version) {
    return stockService.listStockRecords({
      warehouseProductId: this.warehouseProductId,
      type: this.data.activeType,
      cursor: cursor || undefined,
      pageSize: PAGE_SIZE
    }).then((response) => {
      if (!this.pageActive || version !== this.listVersion) {
        return { items: [], nextCursor: '', hasMore: false };
      }
      return {
        items: Array.isArray(response && response.items) ? response.items : [],
        nextCursor: response && response.nextCursor,
        hasMore: Boolean(response && response.hasMore)
      };
    });
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore ||
        !this.data.hasMore || !this.data.nextCursor) {
      return Promise.resolve();
    }
    const version = this.listVersion;
    this.safeSetData({ loadingMore: true });
    return this.fetchRecordPage(this.data.nextCursor, version)
      .then((page) => {
        if (!this.pageActive || version !== this.listVersion) return;
        const unit = this.data.product ? this.data.product.unit : '';
        const nextItems = page.items.map((item) => mapRecord(item, unit));
        this.safeSetData({
          loadingMore: false,
          records: this.data.records.concat(nextItems),
          nextCursor: page.nextCursor || '',
          hasMore: Boolean(page.hasMore)
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.listVersion) return;
        this.safeSetData({ loadingMore: false });
        wx.showToast({
          title: getListErrorMessage(error),
          icon: 'none',
          duration: 2600
        });
      });
  },

  onTypeTap(event) {
    const type = event.currentTarget.dataset.value;
    if (!TYPE_META[type] && type !== 'all') return;
    if (type === this.data.activeType) return;
    this.safeSetData({ activeType: type }, () => {
      this.loadFirstPage();
    });
  },

  handleRetry() {
    this.loadFirstPage();
  },

  recoverContext() {
    const app = getApp();
    this.listVersion += 1;
    this.detailVersion += 1;
    if (app.clearTeamContext) app.clearTeamContext();
    const refresh = app.bootstrap
      ? app.bootstrap({ forceRefresh: true })
      : Promise.resolve();
    return refresh.catch(() => null).then(() => {
      if (this.pageActive) wx.reLaunch({ url: ROUTES.STARTUP });
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

module.exports = {
  PAGE_SIZE,
  TYPE_OPTIONS,
  formatDateTime,
  mapRecord
};
