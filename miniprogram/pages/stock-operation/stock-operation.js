const ROUTES = require('../../constants/routes.js');
const { ERROR_CODES, ERROR_MESSAGES } = require('../../constants/errors.js');
const productService = require('../../services/product-service.js');
const stockService = require('../../services/stock-service.js');
const productView = require('../../utils/product-view.js');
const { createRequestKey } = require('../../utils/request-key.js');

const STOCK_MAX = 999999999;
const REMARK_MAX = 100;

const MODE_CONFIG = {
  inbound: { title: '产品入库', btnText: '确认入库', qtyLabel: '入库数量', srcLabel: '入库来源', srcPlaceholder: '供应商补货、退货入库、盘点补录', remarkPlaceholder: '填写供应商、入库批次或其他说明' },
  outbound: { title: '产品出库', btnText: '确认出库', qtyLabel: '出库数量', srcLabel: '去向/领用人', srcPlaceholder: '施工一组、张三领用、客户订单', remarkPlaceholder: '填写领用人、去向或其他说明' },
  adjustment: { title: '调整库存', btnText: '确认调整', qtyLabel: '', srcLabel: '', srcPlaceholder: '', remarkPlaceholder: '填写本次盘点或调整的补充说明' }
};

const ADJUST_REASONS = ['盘点修正', '损耗报废', '登记错误', '退货修正', '其他'];

function sanitizePosInt(value, fallback) {
  if (fallback === undefined) fallback = 0;
  if (value === '' || value === undefined || value === null) return fallback;
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 1) return fallback;
  if (num > STOCK_MAX) return STOCK_MAX;
  return num;
}

function sanitizeNonNegInt(value, fallback) {
  if (fallback === undefined) fallback = 0;
  if (value === '' || value === undefined || value === null) return fallback;
  const num = parseInt(value, 10);
  if (Number.isNaN(num) || num < 0) return fallback;
  if (num > STOCK_MAX) return STOCK_MAX;
  return num;
}

function trimText(value) {
  return String(value || '').trim();
}

function computeStockStatus(stock, minStock) {
  if (stock <= 0) return { status: 'out', label: '缺货', color: 'danger' };
  if (stock <= (minStock || 0)) return { status: 'low', label: '低库存', color: 'warning' };
  return { status: 'normal', label: '正常', color: 'primary' };
}

function getDisplayText(product) {
  const cover = product && product.cover;
  if (cover && cover.type === 'emoji' && cover.emoji) return cover.emoji;
  if (cover && cover.content) return cover.content;
  const name = trimText(product && product.name) || '仓';
  return Array.from(name)[0] || '仓';
}

function createOperationProduct(detail) {
  const product = detail.product;
  const warehouseProduct = detail.warehouseProduct;
  return {
    id: warehouseProduct.id,
    productId: product.id,
    name: product.name,
    code: product.productCode,
    category: product.category,
    unit: product.unit,
    minStock: warehouseProduct.minStock || 0,
    stock: warehouseProduct.stock || 0,
    stockVersion: warehouseProduct.stockVersion || 1,
    status: warehouseProduct.stockStatus,
    displayText: getDisplayText(product)
  };
}

function getStockErrorMessage(error) {
  if (!error) return '库存操作失败，请稍后重试';
  if (error.code === ERROR_CODES.UNKNOWN_ACTION) {
    return '云函数还不是最新版本，请先重新部署 warehouse-api';
  }
  return ERROR_MESSAGES[error.code] || error.message || '库存操作失败，请稍后重试';
}

Page({
  data: {
    product: null,
    mode: '',
    pageTitle: '',
    modeConfig: null,
    invalidPage: false,
    invalidDesc: '产品或操作类型不存在',
    loading: true,
    remarkMax: REMARK_MAX,

    stockBefore: 0,
    stockAfter: 0,
    stockStatus: null,
    stockVersion: 1,

    quantity: '',
    sourceOrDestination: '',

    targetStock: '',
    quantityDelta: 0,
    reason: '',
    customReason: '',
    adjustReasons: ADJUST_REASONS,

    remark: '',
    remarkLength: 0,

    submitting: false,
    confirmDisabled: false,
    validationErrors: {},

    navStyle: '',
    navSideStyle: ''
  },

  onLoad(query) {
    this.pageActive = true;
    this.loadingVersion = 0;
    this.mutationRequestKey = '';
    this.mutationRequestSignature = '';
    this.calcNavStyle();

    const mode = query && query.mode;
    const warehouseProductId = productView.getWarehouseProductId(query);

    if (!mode || !MODE_CONFIG[mode]) {
      this.setData({
        invalidPage: true,
        loading: false,
        invalidDesc: '库存操作类型不存在'
      });
      return;
    }
    if (!warehouseProductId) {
      this.setData({
        invalidPage: true,
        loading: false,
        mode,
        modeConfig: MODE_CONFIG[mode],
        pageTitle: MODE_CONFIG[mode].title,
        invalidDesc: '产品标识无效，请返回库存页重新选择'
      });
      return;
    }

    this.warehouseProductId = warehouseProductId;
    this.setData({
      mode,
      pageTitle: MODE_CONFIG[mode].title,
      modeConfig: MODE_CONFIG[mode],
      loading: true,
      invalidPage: false,
      invalidDesc: ''
    });
    this.loadProduct();
  },

  onUnload() {
    this.pageActive = false;
    this.loadingVersion += 1;
  },

  safeSetData(updates, callback) {
    if (this.pageActive) this.setData(updates, callback);
  },

  loadProduct() {
    const version = this.loadingVersion + 1;
    this.loadingVersion = version;
    return productService.getProductDetail({
      warehouseProductId: this.warehouseProductId
    }).then((response) => {
      if (!this.pageActive || version !== this.loadingVersion) return;
      const detail = productView.mapProductDetail(response);
      const product = createOperationProduct(detail);
      this.safeSetData({
        product,
        loading: false,
        invalidPage: false,
        stockBefore: product.stock,
        stockAfter: product.stock,
        stockVersion: product.stockVersion,
        targetStock: this.data.mode === 'adjustment' ? product.stock : '',
        quantityDelta: 0,
        stockStatus: computeStockStatus(product.stock, product.minStock),
        confirmDisabled: this.data.mode === 'outbound' && product.stock <= 0
      });
      this.updateConfirmState();
    }).catch((error) => {
      if (!this.pageActive || version !== this.loadingVersion) return;
      if (productView.isContextInvalid(error)) {
        this.recoverContext();
        return;
      }
      this.safeSetData({
        loading: false,
        invalidPage: true,
        invalidDesc: getStockErrorMessage(error)
      });
    });
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

  resetMutationKey() {
    this.mutationRequestKey = '';
    this.mutationRequestSignature = '';
  },

  onQuantityInput(e) {
    const raw = e.detail.value;
    const val = sanitizePosInt(raw, raw === '' ? '' : this.data.quantity);
    this.resetMutationKey();
    this.setData({ quantity: val, 'validationErrors.quantity': '' });
    this.computeStockAfter();
    this.computeStockStatus();
    this.updateConfirmState();
  },

  onQuantityDecrease() {
    let val = Number(this.data.quantity) || 0;
    if (val > 1) {
      val -= 1;
      this.resetMutationKey();
      this.setData({ quantity: val, 'validationErrors.quantity': '' });
      this.computeStockAfter();
      this.computeStockStatus();
      this.updateConfirmState();
    }
  },

  onQuantityIncrease() {
    let val = Number(this.data.quantity) || 0;
    if (val < STOCK_MAX) {
      val += 1;
      this.resetMutationKey();
      this.setData({ quantity: val, 'validationErrors.quantity': '' });
      this.computeStockAfter();
      this.computeStockStatus();
      this.updateConfirmState();
    }
  },

  onSourceInput(e) {
    this.resetMutationKey();
    this.setData({ sourceOrDestination: e.detail.value });
  },

  onTargetStockInput(e) {
    const raw = e.detail.value;
    const val = sanitizeNonNegInt(raw, raw === '' ? '' : this.data.targetStock);
    this.resetMutationKey();
    this.setData({ targetStock: val, 'validationErrors.targetStock': '' });
    this.computeStockAfter();
    this.computeStockStatus();
    this.updateConfirmState();
  },

  onTargetStockDecrease() {
    let val = Number(this.data.targetStock) || 0;
    if (val > 0) {
      val -= 1;
      this.resetMutationKey();
      this.setData({ targetStock: val, 'validationErrors.targetStock': '' });
      this.computeStockAfter();
      this.computeStockStatus();
      this.updateConfirmState();
    }
  },

  onTargetStockIncrease() {
    let val = Number(this.data.targetStock) || 0;
    if (val < STOCK_MAX) {
      val += 1;
      this.resetMutationKey();
      this.setData({ targetStock: val, 'validationErrors.targetStock': '' });
      this.computeStockAfter();
      this.computeStockStatus();
      this.updateConfirmState();
    }
  },

  onReasonTap(e) {
    this.resetMutationKey();
    this.setData({ reason: e.currentTarget.dataset.value, 'validationErrors.reason': '' });
  },

  onCustomReasonInput(e) {
    this.resetMutationKey();
    this.setData({ customReason: e.detail.value, 'validationErrors.reason': '' });
  },

  onRemarkInput(e) {
    this.resetMutationKey();
    const value = String(e.detail.value || '').slice(0, REMARK_MAX);
    this.setData({ remark: value, remarkLength: value.length });
  },

  computeStockAfter() {
    const mode = this.data.mode;
    const stockBefore = this.data.stockBefore;
    let stockAfter = stockBefore;

    if (mode === 'inbound' || mode === 'outbound') {
      const qty = Number(this.data.quantity) || 0;
      stockAfter = mode === 'inbound' ? stockBefore + qty : stockBefore - qty;
      this.setData({ stockAfter });
    } else if (mode === 'adjustment') {
      const target = this.data.targetStock;
      if (target === '' || target === null || target === undefined) {
        this.setData({ stockAfter: stockBefore, quantityDelta: 0 });
      } else {
        const nextStock = Number(target) || 0;
        this.setData({ stockAfter: nextStock, quantityDelta: nextStock - stockBefore });
      }
    }
  },

  computeStockStatus() {
    let stockAfter = Number(this.data.stockAfter);
    if (Number.isNaN(stockAfter)) stockAfter = Number(this.data.stockBefore) || 0;
    const minStock = this.data.product ? (this.data.product.minStock || 0) : 0;
    this.setData({ stockStatus: computeStockStatus(stockAfter, minStock) });
  },

  updateConfirmState() {
    const mode = this.data.mode;
    let disabled = false;

    if (this.data.loading || !this.data.product) disabled = true;
    if (mode === 'outbound' && this.data.stockBefore <= 0) disabled = true;
    if (mode === 'adjustment') {
      const targetStock = Number(this.data.targetStock);
      if (targetStock === this.data.stockBefore) disabled = true;
    }

    this.setData({ confirmDisabled: disabled });
  },

  validate() {
    const mode = this.data.mode;
    const errors = {};
    let valid = true;

    if (!this.data.product || !this.warehouseProductId) {
      wx.showToast({ title: '产品信息未加载，请刷新后重试', icon: 'none' });
      return false;
    }

    if (!Number.isSafeInteger(this.data.stockVersion) || this.data.stockVersion < 1) {
      wx.showToast({ title: '库存版本异常，请刷新后重试', icon: 'none' });
      return false;
    }

    if (mode === 'inbound' || mode === 'outbound') {
      const qty = this.data.quantity;
      if (qty === '' || qty === null || qty === undefined || Number(qty) < 1) {
        errors.quantity = '请输入有效的' + (mode === 'inbound' ? '入库' : '出库') + '数量';
        valid = false;
      }
      if (mode === 'outbound' && Number(qty) > this.data.stockBefore) {
        errors.quantity = '出库数量不能大于当前库存';
        valid = false;
      }
    }

    if (mode === 'adjustment') {
      const target = this.data.targetStock;
      if (target === '' || target === null || target === undefined || Number.isNaN(Number(target)) || Number(target) < 0) {
        errors.targetStock = '请输入有效的实际库存';
        valid = false;
      }

      const reason = this.data.reason;
      if (!reason) {
        errors.reason = '请选择调整原因';
        valid = false;
      }
      if (reason === '其他' && (!this.data.customReason || !this.data.customReason.trim())) {
        errors.reason = '请输入自定义调整原因';
        valid = false;
      }
    }

    if (trimText(this.data.sourceOrDestination).length > 50) {
      errors.sourceOrDestination = '来源或去向不能超过50字';
      valid = false;
    }

    this.setData({ validationErrors: errors });
    return valid;
  },

  buildMutationPayload() {
    const mode = this.data.mode;
    const payload = {
      warehouseProductId: this.warehouseProductId,
      expectedStockVersion: this.data.stockVersion,
      referenceNo: trimText(this.data.sourceOrDestination)
    };

    if (mode === 'inbound' || mode === 'outbound') {
      payload.quantity = Number(this.data.quantity);
      payload.reason = trimText(this.data.remark);
    } else {
      payload.targetStock = Number(this.data.targetStock);
      payload.reason = this.data.reason === '其他'
        ? trimText(this.data.customReason)
        : trimText(this.data.reason);
    }

    const signature = JSON.stringify({
      mode,
      warehouseProductId: payload.warehouseProductId,
      quantity: payload.quantity,
      targetStock: payload.targetStock,
      expectedStockVersion: payload.expectedStockVersion,
      reason: payload.reason,
      referenceNo: payload.referenceNo
    });
    if (!this.mutationRequestKey || this.mutationRequestSignature !== signature) {
      this.mutationRequestKey = createRequestKey('stock_' + mode);
      this.mutationRequestSignature = signature;
    }
    payload.requestKey = this.mutationRequestKey;
    return payload;
  },

  onConfirm() {
    if (this.data.submitting || this.data.confirmDisabled) return;
    if (!this.validate()) return;

    this.setData({ submitting: true });

    const mode = this.data.mode;
    const product = this.data.product;
    const unit = product ? (product.unit || '') : '';
    let content = '';

    if (mode === 'inbound' || mode === 'outbound') {
      const qty = Number(this.data.quantity) || 0;
      content = '确认' + (mode === 'inbound' ? '入库' : '出库') + qty + unit + '？\n库存将由' +
        this.data.stockBefore + unit + '变为' + this.data.stockAfter + unit + '。';
    } else if (mode === 'adjustment') {
      const targetStock = Number(this.data.targetStock) || 0;
      const delta = this.data.quantityDelta;
      const sign = delta >= 0 ? '+' : '';
      content = '确认将库存从' + this.data.stockBefore + unit + '调整为' + targetStock + unit +
        '？\n库存差异为' + sign + delta + unit + '。';
    }

    wx.showModal({
      title: '确认操作',
      content,
      cancelText: '取消',
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) {
          this.submitMutation();
          return;
        }
        this.setData({ submitting: false });
      },
      fail: () => {
        this.setData({ submitting: false });
      }
    });
  },

  submitMutation() {
    const mode = this.data.mode;
    const payload = this.buildMutationPayload();
    const action = mode === 'inbound'
      ? stockService.inboundStock
      : (mode === 'outbound' ? stockService.outboundStock : stockService.adjustStock);

    return action(payload).then((result) => {
      if (!this.pageActive) return;
      this.mutationRequestKey = '';
      this.mutationRequestSignature = '';
      const app = getApp();
      if (app.globalData) app.globalData.inventoryRefreshRequired = true;
      this.safeSetData({ submitting: false });
      wx.showToast({
        title: result && result.idempotent ? '库存已同步' : '库存已更新',
        icon: 'success',
        duration: 1400
      });
      setTimeout(() => {
        this.onBack();
      }, 900);
    }).catch((error) => {
      if (!this.pageActive) return;
      if (error && error.code === ERROR_CODES.REQUEST_KEY_CONFLICT) {
        this.mutationRequestKey = '';
        this.mutationRequestSignature = '';
      }
      this.safeSetData({ submitting: false });
      wx.showToast({
        title: getStockErrorMessage(error),
        icon: 'none',
        duration: 2600
      });
      if (error && error.code === ERROR_CODES.STOCK_VERSION_CONFLICT) {
        this.loadProduct();
      }
    });
  },

  recoverContext() {
    const app = getApp();
    this.loadingVersion += 1;
    this.safeSetData({ loading: false, invalidPage: true, invalidDesc: '团队或仓库状态已变化，请重新进入小程序' });
    if (app.clearTeamContext) app.clearTeamContext();
    const refresh = app.bootstrap ? app.bootstrap({ forceRefresh: true }) : Promise.resolve();
    return refresh.catch(() => null).then(() => {
      if (this.pageActive) {
        wx.reLaunch({ url: ROUTES.STARTUP });
      }
    });
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.switchTab({ url: ROUTES.INVENTORY });
      }
    });
  },

  goHome() {
    wx.switchTab({ url: ROUTES.INVENTORY });
  }
});
