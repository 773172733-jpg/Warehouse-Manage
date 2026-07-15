var mock = require('../inventory/mock-data');

var STOCK_MAX = 999999999;
var REMARK_MAX = 200;

var MODE_CONFIG = {
  inbound:       { title: '产品入库', btnText: '确认入库',     qtyLabel: '入库数量', srcLabel: '入库来源', srcPlaceholder: '供应商补货、退货入库、盘点补录', remarkPlaceholder: '填写供应商、入库批次或其他说明' },
  outbound:      { title: '产品出库', btnText: '确认出库',     qtyLabel: '出库数量', srcLabel: '去向/领用人', srcPlaceholder: '施工一组、张三领用、客户订单', remarkPlaceholder: '填写领用人、去向或其他说明' },
  adjustment:    { title: '调整库存', btnText: '确认调整',     qtyLabel: '',          srcLabel: '',          srcPlaceholder: '', remarkPlaceholder: '填写本次盘点或调整的补充说明' }
};

var ADJUST_REASONS = ['盘点修正', '损耗报废', '登记错误', '退货修正', '其他'];

function sanitizePosInt(value, fallback) {
  if (fallback === undefined) fallback = 0;
  if (value === '' || value === undefined || value === null) return fallback;
  var num = parseInt(value, 10);
  if (isNaN(num) || num < 1) return fallback;
  if (num > STOCK_MAX) return STOCK_MAX;
  return num;
}

function sanitizeNonNegInt(value, fallback) {
  if (fallback === undefined) fallback = 0;
  if (value === '' || value === undefined || value === null) return fallback;
  var num = parseInt(value, 10);
  if (isNaN(num) || num < 0) return fallback;
  if (num > STOCK_MAX) return STOCK_MAX;
  return num;
}

function computeStockStatus(stock, minStock) {
  if (stock <= 0) return { status: 'out', label: '缺货', color: 'danger' };
  if (stock <= (minStock || 0)) return { status: 'low', label: '低库存', color: 'warning' };
  return { status: 'normal', label: '正常', color: 'primary' };
}

Page({
  data: {
    product: null,
    mode: '',
    pageTitle: '',
    modeConfig: null,
    invalidPage: false,

    // stock
    stockBefore: 0,
    stockAfter: 0,
    stockStatus: null,

    // inbound / outbound
    quantity: '',
    sourceOrDestination: '',

    // adjustment
    targetStock: '',
    quantityDelta: 0,
    reason: '',
    customReason: '',
    adjustReasons: ADJUST_REASONS,

    // common
    remark: '',
    remarkLength: 0,

    // interaction
    submitting: false,
    confirmDisabled: false,
    validationErrors: {},

    // nav
    navStyle: '',
    navSideStyle: ''
  },

  onLoad: function (query) {
    this.calcNavStyle();

    var id = query && query.id;
    var mode = query && query.mode;

    // Validate mode
    if (!mode || !MODE_CONFIG[mode]) {
      this.setData({ invalidPage: true });
      return;
    }

    // Validate product
    if (!id) {
      this.setData({ invalidPage: true, mode: mode, modeConfig: MODE_CONFIG[mode] });
      return;
    }

    var product = mock.getProductById(decodeURIComponent(String(id)));
    if (!product) {
      this.setData({ invalidPage: true, mode: mode, modeConfig: MODE_CONFIG[mode] });
      return;
    }

    var config = MODE_CONFIG[mode];
    this.setData({
      product: product,
      mode: mode,
      pageTitle: config.title,
      modeConfig: config,
      stockBefore: product.stock || 0,
      stockAfter: product.stock || 0
    });
    this.computeStockStatus();
    this.updateConfirmState();
  },

  calcNavStyle: function () {
    var system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    var menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    var statusBar = system.statusBarHeight || 20;
    var hasMenuRect = menu && menu.width > 0 && menu.height > 0 && menu.left > 0;
    var navHeight = hasMenuRect ? Math.max(44, (menu.top - statusBar) * 2 + menu.height) : 44;
    var sideWidth = hasMenuRect ? Math.max(48, system.windowWidth - menu.left + 8) : 48;
    this.setData({
      navStyle: 'padding-top:' + statusBar + 'px;height:' + navHeight + 'px',
      navSideStyle: 'width:' + sideWidth + 'px'
    });
  },

  /* ====== 入库/出库：数量 ====== */

  onQuantityInput: function (e) {
    var raw = e.detail.value;
    var val = sanitizePosInt(raw, raw === '' ? '' : this.data.quantity);
    this.setData({ quantity: val, 'validationErrors.quantity': '' });
    this.computeStockAfter();
    this.computeStockStatus();
    this.updateConfirmState();
  },

  onQuantityDecrease: function () {
    var val = Number(this.data.quantity) || 0;
    if (val > 1) {
      val = val - 1;
      this.setData({ quantity: val, 'validationErrors.quantity': '' });
      this.computeStockAfter();
      this.computeStockStatus();
    }
  },

  onQuantityIncrease: function () {
    var val = Number(this.data.quantity) || 0;
    if (val < STOCK_MAX) {
      val = val + 1;
      this.setData({ quantity: val, 'validationErrors.quantity': '' });
      this.computeStockAfter();
      this.computeStockStatus();
    }
  },

  /* ====== 入库/出库：来源/去向 ====== */

  onSourceInput: function (e) {
    this.setData({ sourceOrDestination: e.detail.value });
  },

  /* ====== 调整：目标库存 ====== */

  onTargetStockInput: function (e) {
    var raw = e.detail.value;
    var val = sanitizeNonNegInt(raw, raw === '' ? '' : this.data.targetStock);
    this.setData({ targetStock: val, 'validationErrors.targetStock': '' });
    this.computeStockAfter();
    this.computeStockStatus();
    this.updateConfirmState();
  },

  onTargetStockDecrease: function () {
    var val = Number(this.data.targetStock) || 0;
    if (val > 0) {
      val = val - 1;
      this.setData({ targetStock: val, 'validationErrors.targetStock': '' });
      this.computeStockAfter();
      this.computeStockStatus();
    }
  },

  onTargetStockIncrease: function () {
    var val = Number(this.data.targetStock) || 0;
    if (val < STOCK_MAX) {
      val = val + 1;
      this.setData({ targetStock: val, 'validationErrors.targetStock': '' });
      this.computeStockAfter();
      this.computeStockStatus();
    }
  },

  /* ====== 调整：原因 ====== */

  onReasonTap: function (e) {
    this.setData({ reason: e.currentTarget.dataset.value, 'validationErrors.reason': '' });
  },

  onCustomReasonInput: function (e) {
    this.setData({ customReason: e.detail.value, 'validationErrors.reason': '' });
  },

  /* ====== 备注 ====== */

  onRemarkInput: function (e) {
    this.setData({ remark: e.detail.value, remarkLength: String(e.detail.value).length });
  },

  /* ====== 计算 ====== */

  computeStockAfter: function () {
    var mode = this.data.mode;
    var stockBefore = this.data.stockBefore;
    var stockAfter = stockBefore;

    if (mode === 'inbound' || mode === 'outbound') {
      var qty = Number(this.data.quantity) || 0;
      stockAfter = mode === 'inbound' ? stockBefore + qty : stockBefore - qty;
      this.setData({ stockAfter: stockAfter });
    } else if (mode === 'adjustment') {
      var target = this.data.targetStock;
      if (target === '' || target === null || target === undefined) {
        this.setData({ stockAfter: stockBefore, quantityDelta: 0 });
      } else {
        var t = Number(target) || 0;
        this.setData({ stockAfter: t, quantityDelta: t - stockBefore });
      }
    }
  },

  computeStockStatus: function () {
    var stockAfter = Number(this.data.stockAfter);
    if (isNaN(stockAfter)) stockAfter = Number(this.data.stockBefore) || 0;
    var minStock = this.data.product ? (this.data.product.minStock || 0) : 0;
    this.setData({ stockStatus: computeStockStatus(stockAfter, minStock) });
  },

  /* ====== 确认按钮禁用判断 ====== */

  updateConfirmState: function () {
    var mode = this.data.mode;
    var disabled = false;

    if (mode === 'outbound') {
      if (this.data.stockBefore <= 0) disabled = true;
    }
    if (mode === 'adjustment') {
      var t = Number(this.data.targetStock);
      if (t === this.data.stockBefore) disabled = true;
    }

    this.setData({ confirmDisabled: disabled });
  },

  /* ====== 校验 ====== */

  validate: function () {
    var mode = this.data.mode;
    var errors = {};
    var valid = true;

    if (mode === 'inbound' || mode === 'outbound') {
      var qty = this.data.quantity;
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
      var target = this.data.targetStock;
      if (target === '' || target === null || target === undefined || isNaN(Number(target)) || Number(target) < 0) {
        errors.targetStock = '请输入有效的实际库存';
        valid = false;
      }

      var reason = this.data.reason;
      if (!reason) {
        errors.reason = '请选择调整原因';
        valid = false;
      }
      if (reason === '其他') {
        if (!this.data.customReason || !this.data.customReason.trim()) {
          errors.reason = '请输入自定义调整原因';
          valid = false;
        }
      }
    }

    this.setData({ validationErrors: errors });
    return valid;
  },

  /* ====== 确认 ====== */

  onConfirm: function () {
    if (this.data.submitting || this.data.confirmDisabled) return;
    if (!this.validate()) return;

    var self = this;
    this.setData({ submitting: true });

    var mode = this.data.mode;
    var product = this.data.product;
    var unit = product ? (product.unit || '') : '';
    var content = '';

    if (mode === 'inbound' || mode === 'outbound') {
      var qty = Number(this.data.quantity) || 0;
      var stockBefore = this.data.stockBefore;
      var stockAfter = this.data.stockAfter;
      content = '确认' + (mode === 'inbound' ? '入库' : '出库') + qty + unit + '？\n库存将由' + stockBefore + unit + '变为' + stockAfter + unit + '。';
    } else if (mode === 'adjustment') {
      var tgt = Number(this.data.targetStock) || 0;
      var delta = this.data.quantityDelta;
      var sign = delta >= 0 ? '+' : '';
      content = '确认将库存从' + this.data.stockBefore + unit + '调整为' + tgt + unit + '？\n库存差异为' + sign + delta + unit + '。';
    }

    wx.showModal({
      title: '确认操作',
      content: content,
      cancelText: '取消',
      confirmText: '确认',
      success: function (res) {
        if (res.confirm) {
          wx.showToast({
            title: '库存保存功能将在后续阶段接入，本次未真实修改库存',
            icon: 'none',
            duration: 2500
          });
          setTimeout(function () {
            wx.navigateBack({
              delta: 1,
              fail: function () {
                wx.switchTab({ url: '/pages/inventory/inventory' });
              }
            });
          }, 1500);
        }
        self.setData({ submitting: false });
      },
      fail: function () {
        self.setData({ submitting: false });
      }
    });
  },

  /* ====== 导航 ====== */

  onBack: function () {
    wx.navigateBack({
      delta: 1,
      fail: function () {
        wx.switchTab({ url: '/pages/inventory/inventory' });
      }
    });
  },

  goHome: function () {
    wx.switchTab({ url: '/pages/inventory/inventory' });
  }
});
