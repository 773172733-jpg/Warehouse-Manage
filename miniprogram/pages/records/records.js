const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES, ERROR_MESSAGES } = require('../../constants/errors.js');
const stockService = require('../../services/stock-service.js');
const productView = require('../../utils/product-view.js');

const PAGE_SIZE = 20;
const TYPE_OPTIONS = Object.freeze([
  { value: 'all', label: '全部' },
  { value: 'inbound', label: '入库' },
  { value: 'outbound', label: '出库' },
  { value: 'adjustment', label: '盘点' },
  { value: 'initial', label: '初始库存' }
]);
const DATE_OPTIONS = Object.freeze([
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'last7', label: '近7天' },
  { value: 'last30', label: '近30天' }
]);
const TYPE_META = Object.freeze({
  initial: { label: '初始库存', tone: 'initial' },
  inbound: { label: '入库', tone: 'inbound' },
  outbound: { label: '出库', tone: 'outbound' },
  adjustment: { label: '盘点', tone: 'adjustment' }
});

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(value) {
  if (!value) return '时间未知';
  const source = value && typeof value === 'object' && value.$date ? value.$date : value;
  const date = source instanceof Date ? source : new Date(source);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' +
    pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function formatDateGroup(value) {
  if (!value) return '时间未知';
  const source = value && typeof value === 'object' && value.$date ? value.$date : value;
  const date = source instanceof Date ? source : new Date(source);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function getDateRange(value) {
  if (value === 'all') return {};
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (value === 'last7') start.setDate(start.getDate() - 6);
  if (value === 'last30') start.setDate(start.getDate() - 29);
  return {
    startAt: start.toISOString(),
    endAt: now.toISOString()
  };
}

function getRoleLabel(role) {
  if (role === 'owner') return '所有者';
  if (role === 'admin') return '管理员';
  return '成员';
}

function getReasonText(record) {
  const reason = String((record && record.reason) || '').trim();
  if (reason === 'initial_stock') return '初始建档';
  return reason || '未填写原因';
}

function getReferenceText(record) {
  const referenceNo = String((record && record.referenceNo) || '').trim();
  return referenceNo || '无单据号';
}

function mapRecord(record) {
  const type = TYPE_META[record && record.type] ? record.type : 'initial';
  const meta = TYPE_META[type];
  const delta = Number.isSafeInteger(record && record.delta) ? record.delta : 0;
  const beforeStock = Number.isSafeInteger(record && record.beforeStock)
    ? record.beforeStock
    : 0;
  const afterStock = Number.isSafeInteger(record && record.afterStock)
    ? record.afterStock
    : beforeStock + delta;
  const unit = String((record && record.unit) || '');
  const cover = productView.getCoverView(record && record.cover, record && record.productName);
  cover.showImage = cover.type === 'image' && cover.imageAvailable;
  const productCode = String((record && record.productCode) || '');
  return {
    id: String((record && record.id) || ''),
    productId: String((record && record.productId) || ''),
    warehouseProductId: String((record && record.warehouseProductId) || ''),
    productName: String((record && record.productName) || '历史商品'),
    productCode,
    productCodeText: productCode || '无型号',
    cover,
    type,
    typeLabel: meta.label,
    typeClass: meta.tone,
    delta,
    deltaText: (delta > 0 ? '+' : '') + delta,
    beforeStock,
    afterStock,
    stockText: beforeStock + ' → ' + afterStock,
    unit,
    reasonText: getReasonText(record),
    referenceText: getReferenceText(record),
    operatorText: getRoleLabel(record && record.operatorRole),
    operatorName: String((record && record.operatorDisplayName) || ''),
    createdAtText: formatDateTime(record && record.createdAt),
    groupKey: formatDateGroup(record && record.createdAt),
    canNavigate: Boolean(record && record.canNavigate)
  };
}

function groupRecords(records) {
  const groups = [];
  const byKey = {};
  records.forEach((record) => {
    if (!byKey[record.groupKey]) {
      byKey[record.groupKey] = {
        key: record.groupKey,
        title: record.groupKey,
        records: []
      };
      groups.push(byKey[record.groupKey]);
    }
    byKey[record.groupKey].records.push(record);
  });
  return groups;
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
    summary: { loaded: 0, today: 0 },
    activeType: 'all',
    activeDateRange: 'all',
    typeOptions: TYPE_OPTIONS,
    dateOptions: DATE_OPTIONS,
    groups: [],
    records: [],
    nextCursor: '',
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: '',
    hasLoadedOnce: false
  },

  onLoad() {
    this.pageActive = true;
    this.listVersion = 0;
    this.firstPagePromise = null;
    this.pendingRefresh = false;
    this.hasShown = false;
    this.loadFirstPage();
  },

  onShow() {
    const shouldRefresh = this.consumeRefreshMarker();
    if (!this.hasShown) {
      this.hasShown = true;
      return;
    }
    if (shouldRefresh) {
      this.loadFirstPage({ queueIfLoading: true });
    }
  },

  onUnload() {
    this.pageActive = false;
    this.pendingRefresh = false;
    this.listVersion += 1;
  },

  onPullDownRefresh() {
    return this.loadFirstPage({ queueIfLoading: true }).finally(() => {
      if (wx.stopPullDownRefresh) wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    this.loadMore();
  },

  safeSetData(updates, callback) {
    if (this.pageActive) this.setData(updates, callback);
  },

  consumeRefreshMarker() {
    const app = getApp();
    const globalData = app && app.globalData;
    const marker = globalData && globalData.warehouseStockRecordsRefreshRequired;
    if (marker) globalData.warehouseStockRecordsRefreshRequired = false;
    return Boolean(marker);
  },

  buildPayload(cursor) {
    const range = getDateRange(this.data.activeDateRange);
    return Object.assign({
      type: this.data.activeType,
      cursor: cursor || undefined,
      pageSize: PAGE_SIZE
    }, range);
  },

  fetchPage(cursor, version) {
    return stockService.listWarehouseStockRecords(this.buildPayload(cursor))
      .then((response) => {
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

  loadFirstPage(options) {
    const settings = options || {};
    if (this.firstPagePromise) {
      if (settings.queueIfLoading) this.pendingRefresh = true;
      return this.firstPagePromise;
    }
    const version = this.listVersion + 1;
    this.listVersion = version;
    this.safeSetData({
      loading: true,
      loadingMore: false,
      error: '',
      records: [],
      groups: [],
      nextCursor: '',
      hasMore: false
    });
    const currentPromise = this.fetchPage('', version)
      .then((page) => {
        if (!this.pageActive || version !== this.listVersion) return;
        const records = page.items.map(mapRecord);
        this.safeSetData({
          loading: false,
          hasLoadedOnce: true,
          records,
          groups: groupRecords(records),
          nextCursor: page.nextCursor || '',
          hasMore: Boolean(page.hasMore),
          summary: this.buildSummary(records)
        });
      })
      .catch((error) => {
        if (!this.pageActive || version !== this.listVersion) return;
        if (productView.isContextInvalid(error)) {
          this.recoverContext();
          return;
        }
        this.safeSetData({
          loading: false,
          loadingMore: false,
          hasLoadedOnce: true,
          error: getListErrorMessage(error)
        });
      })
      .finally(() => {
        if (this.firstPagePromise === currentPromise) this.firstPagePromise = null;
        if (this.pageActive && this.pendingRefresh) {
          this.pendingRefresh = false;
          this.loadFirstPage();
        }
      });
    this.firstPagePromise = currentPromise;
    return currentPromise;
  },

  loadMore() {
    if (this.data.loading || this.data.loadingMore ||
        !this.data.hasMore || !this.data.nextCursor) {
      return Promise.resolve();
    }
    const version = this.listVersion;
    this.safeSetData({ loadingMore: true });
    return this.fetchPage(this.data.nextCursor, version)
      .then((page) => {
        if (!this.pageActive || version !== this.listVersion) return;
        const existingIds = this.data.records.reduce((map, record) => {
          map[record.id] = true;
          return map;
        }, {});
        const nextRecords = page.items.map(mapRecord).filter((record) => !existingIds[record.id]);
        const records = this.data.records.concat(nextRecords);
        this.safeSetData({
          loadingMore: false,
          records,
          groups: groupRecords(records),
          nextCursor: page.nextCursor || '',
          hasMore: Boolean(page.hasMore),
          summary: this.buildSummary(records)
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

  buildSummary(records) {
    const today = formatDateGroup(new Date());
    return {
      loaded: records.length,
      today: records.filter((record) => record.groupKey === today).length
    };
  },

  onTypeTap(event) {
    const value = event.currentTarget.dataset.value;
    if (value === this.data.activeType) return;
    if (!TYPE_OPTIONS.some((item) => item.value === value)) return;
    this.safeSetData({ activeType: value }, () => this.loadFirstPage());
  },

  onDateTap(event) {
    const value = event.currentTarget.dataset.value;
    if (value === this.data.activeDateRange) return;
    if (!DATE_OPTIONS.some((item) => item.value === value)) return;
    this.safeSetData({ activeDateRange: value }, () => this.loadFirstPage());
  },

  handleRetry() {
    this.loadFirstPage();
  },

  onRecordTap(event) {
    const id = event.currentTarget.dataset.id;
    const record = this.data.records.filter((item) => item.id === id)[0];
    if (!record) return;
    if (!record.canNavigate || !record.warehouseProductId) {
      wx.showToast({
        title: '该商品当前不可查看',
        icon: 'none',
        duration: 1800
      });
      return;
    }
    wx.navigateTo({
      url: ROUTES.PRODUCT_DETAIL
        ? ROUTES.PRODUCT_DETAIL + '?warehouseProductId=' + encodeURIComponent(record.warehouseProductId)
        : '/pages/product-detail/product-detail?warehouseProductId=' + encodeURIComponent(record.warehouseProductId)
    });
  },

  onCoverImageError(event) {
    const id = event.currentTarget.dataset.id;
    const records = this.data.records.map((record) => {
      if (record.id !== id) return record;
      return Object.assign({}, record, {
        cover: productView.getCoverView(null, record.productName)
      });
    });
    this.safeSetData({
      records,
      groups: groupRecords(records)
    });
  },

  recoverContext() {
    const app = getApp();
    this.listVersion += 1;
    if (app.clearTeamContext) app.clearTeamContext();
    const refresh = app.bootstrap
      ? app.bootstrap({ forceRefresh: true })
      : Promise.resolve();
    return refresh.catch(() => null).then(() => {
      if (this.pageActive) wx.reLaunch({ url: ROUTES.STARTUP });
    });
  }
});

module.exports = {
  PAGE_SIZE,
  TYPE_OPTIONS,
  DATE_OPTIONS,
  getDateRange,
  mapRecord,
  groupRecords
};
