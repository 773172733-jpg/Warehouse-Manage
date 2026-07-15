var COVER_COLORS = [
  { name: '浅绿', value: '#EAF6EF' },
  { name: '米黄', value: '#F7F2E8' },
  { name: '雾蓝', value: '#E9EDF5' },
  { name: '浅粉', value: '#F7EAEE' },
  { name: '灰紫', value: '#EDE8F2' },
  { name: '暖灰', value: '#EFEDE8' },
  { name: '鼠尾草', value: '#E6F0ED' },
  { name: '奶油', value: '#F3EFE6' }
];

var SYSTEM_ASSETS = [
  { key: 'box', label: '纸箱', emoji: '📦' },
  { key: 'tool', label: '工具', emoji: '🔧' },
  { key: 'tile', label: '瓷砖', emoji: '🧱' },
  { key: 'hardware', label: '五金', emoji: '🔩' },
  { key: 'consumable', label: '耗材', emoji: '🪣' },
  { key: 'office', label: '办公', emoji: '📎' }
];

var CATEGORIES = ['瓷砖', '工具', '五金', '耗材', '办公用品', '其他'];

var UNITS = ['个', '件', '台', '套', '箱', '盒', '包', '卷', '片', '米', '平方米', '其他'];

var STOCK_MAX = 999999999;

function getAssetByKey(key) {
  for (var i = 0; i < SYSTEM_ASSETS.length; i++) {
    if (SYSTEM_ASSETS[i].key === key) return SYSTEM_ASSETS[i];
  }
  return null;
}

function getAssetLabel(key) {
  for (var i = 0; i < SYSTEM_ASSETS.length; i++) {
    if (SYSTEM_ASSETS[i].key === key) return SYSTEM_ASSETS[i].label;
  }
  return '';
}

function sanitizeInteger(value, fallback) {
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
    currentStep: 1,
    form: {
      coverMode: 'text',
      displayText: '',
      coverColor: '#EAF6EF',
      coverTextEdited: false,
      systemAssetKey: '',
      systemAssetLabel: '',
      systemAssetEmoji: '',
      localImagePath: '',
      name: '',
      code: '',
      category: '',
      unit: '',
      customUnit: '',
      specification: '',
      brand: '',
      description: '',
      keywords: '',
      stock: 0,
      minStock: 0,
      lowStockEnabled: true
    },
    fieldErrors: {
      name: '',
      category: '',
      unit: '',
      displayText: '',
      systemAssetKey: '',
      image: '',
      stock: ''
    },
    stockStatus: null,
    coverColors: COVER_COLORS,
    systemAssets: SYSTEM_ASSETS,
    navStyle: '',
    navSideStyle: ''
  },

  onLoad: function (query) {
    if (query && query.mode !== 'create') {
      wx.showToast({ title: '当前仅支持新增模式', icon: 'none', duration: 2000 });
    }
    this.calcNavStyle();
    this.computeStockStatus();
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

  /* ====== 步骤导航 ====== */

  onNextStep: function () {
    if (this.data.currentStep === 1) {
      if (!this.validateStep1()) return;
    } else if (this.data.currentStep === 2) {
      if (!this.validateStep2()) return;
    }
    if (this.data.currentStep < 3) {
      this.setData({ currentStep: this.data.currentStep + 1 });
    }
  },

  onPrevStep: function () {
    if (this.data.currentStep > 1) {
      this.setData({ currentStep: this.data.currentStep - 1 });
    }
  },

  /* ====== 封面模式 ====== */

  onCoverModeTap: function (e) {
    var mode = e.currentTarget.dataset.mode;
    var updates = { 'form.coverMode': mode };
    if (mode === 'text') {
      updates['fieldErrors.displayText'] = '';
    } else if (mode === 'system') {
      updates['fieldErrors.systemAssetKey'] = '';
    } else if (mode === 'custom') {
      updates['fieldErrors.image'] = '';
    }
    this.setData(updates);
  },

  /* ====== 文字封面 ====== */

  onDisplayTextInput: function (e) {
    this.setData({
      'form.displayText': e.detail.value,
      'form.coverTextEdited': true,
      'fieldErrors.displayText': ''
    });
  },

  onCoverColorTap: function (e) {
    this.setData({ 'form.coverColor': e.currentTarget.dataset.color });
  },

  /* ====== 系统贴图 ====== */

  onSystemAssetTap: function (e) {
    var key = e.currentTarget.dataset.key;
    var asset = getAssetByKey(key);
    this.setData({
      'form.systemAssetKey': key,
      'form.systemAssetLabel': asset ? asset.label : '',
      'form.systemAssetEmoji': asset ? asset.emoji : '',
      'fieldErrors.systemAssetKey': ''
    });
  },

  /* ====== 上传图片 ====== */

  onChooseImage: function () {
    var self = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        if (res.tempFiles && res.tempFiles.length > 0) {
          self.setData({
            'form.localImagePath': res.tempFiles[0].tempFilePath,
            'fieldErrors.image': ''
          });
        }
      },
      fail: function (err) {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) {
          return;
        }
        wx.showToast({ title: '选择图片失败，请检查权限后重试', icon: 'none', duration: 2000 });
      }
    });
  },

  onClearImage: function () {
    this.setData({ 'form.localImagePath': '' });
  },

  /* ====== 产品名称（自动填充封面文字）====== */

  onNameInput: function (e) {
    var value = e.detail.value;
    var updates = { 'form.name': value };
    if (!this.data.form.coverTextEdited) {
      updates['form.displayText'] = value.substring(0, 4);
    }
    if (value.trim()) {
      updates['fieldErrors.name'] = '';
    }
    this.setData(updates);
  },

  /* ====== 产品编号 ====== */

  onCodeInput: function (e) {
    this.setData({ 'form.code': e.detail.value });
  },

  /* ====== 分类（ActionSheet）====== */

  onCategoryTap: function () {
    var self = this;
    wx.showActionSheet({
      itemList: CATEGORIES,
      success: function (res) {
        self.setData({
          'form.category': CATEGORIES[res.tapIndex],
          'fieldErrors.category': ''
        });
      }
    });
  },

  /* ====== 单位（ActionSheet + 自定义）====== */

  onUnitTap: function () {
    var self = this;
    wx.showActionSheet({
      itemList: UNITS,
      success: function (res) {
        var unit = UNITS[res.tapIndex];
        var updates = { 'form.unit': unit, 'fieldErrors.unit': '' };
        if (unit !== '其他') {
          updates['form.customUnit'] = '';
        }
        self.setData(updates);
      }
    });
  },

  onCustomUnitInput: function (e) {
    this.setData({
      'form.customUnit': e.detail.value,
      'fieldErrors.unit': ''
    });
  },

  /* ====== 规格 ====== */

  onSpecInput: function (e) {
    this.setData({ 'form.specification': e.detail.value });
  },

  /* ====== 品牌 ====== */

  onBrandInput: function (e) {
    this.setData({ 'form.brand': e.detail.value });
  },

  /* ====== 产品介绍 ====== */

  onDescInput: function (e) {
    this.setData({ 'form.description': e.detail.value });
  },

  /* ====== 搜索关键词 ====== */

  onKeywordsInput: function (e) {
    this.setData({ 'form.keywords': e.detail.value });
  },

  /* ====== 库存设置 ====== */

  onStockInput: function (e) {
    var val = sanitizeInteger(e.detail.value, 0);
    this.setData({ 'form.stock': val, 'fieldErrors.stock': '' });
    this.computeStockStatus();
  },

  onMinStockInput: function (e) {
    var val = sanitizeInteger(e.detail.value, 0);
    this.setData({ 'form.minStock': val });
    this.computeStockStatus();
  },

  onStockDecrease: function () {
    var val = this.data.form.stock;
    if (val > 0) {
      val = val - 1;
      this.setData({ 'form.stock': val, 'fieldErrors.stock': '' });
      this.computeStockStatus();
    }
  },

  onStockIncrease: function () {
    var val = this.data.form.stock;
    if (val < STOCK_MAX) {
      val = val + 1;
      this.setData({ 'form.stock': val, 'fieldErrors.stock': '' });
      this.computeStockStatus();
    }
  },

  onMinStockDecrease: function () {
    var val = this.data.form.minStock;
    if (val > 0) {
      this.setData({ 'form.minStock': val - 1 });
      this.computeStockStatus();
    }
  },

  onMinStockIncrease: function () {
    var val = this.data.form.minStock;
    if (val < STOCK_MAX) {
      this.setData({ 'form.minStock': val + 1 });
      this.computeStockStatus();
    }
  },

  onLowStockToggle: function () {
    this.setData({ 'form.lowStockEnabled': !this.data.form.lowStockEnabled });
  },

  computeStockStatus: function () {
    var stock = Number(this.data.form.stock) || 0;
    var minStock = Number(this.data.form.minStock) || 0;
    this.setData({ stockStatus: computeStockStatus(stock, minStock) });
  },

  /* ====== 校验 ====== */

  validateStep1: function () {
    var form = this.data.form;
    var errors = {
      name: '',
      category: '',
      unit: '',
      displayText: '',
      systemAssetKey: '',
      image: '',
      stock: ''
    };
    var valid = true;

    if (!form.name || !form.name.trim()) {
      errors.name = '请输入产品名称';
      valid = false;
    }
    if (!form.category) {
      errors.category = '请选择分类';
      valid = false;
    }
    if (!form.unit) {
      errors.unit = '请选择单位';
      valid = false;
    }
    if (form.unit === '其他' && (!form.customUnit || !form.customUnit.trim())) {
      errors.unit = '请输入自定义单位';
      valid = false;
    }
    if (form.coverMode === 'text' && (!form.displayText || !form.displayText.trim())) {
      errors.displayText = '请输入封面文字';
      valid = false;
    }
    if (form.coverMode === 'system' && !form.systemAssetKey) {
      errors.systemAssetKey = '请选择系统贴图';
      valid = false;
    }
    if (form.coverMode === 'custom' && !form.localImagePath) {
      errors.image = '请选择图片';
      valid = false;
    }

    this.setData({ fieldErrors: errors });

    if (!valid) {
      var messages = [];
      if (errors.name) messages.push(errors.name);
      if (errors.category) messages.push(errors.category);
      if (errors.unit) messages.push(errors.unit);
      if (errors.displayText) messages.push(errors.displayText);
      if (errors.systemAssetKey) messages.push(errors.systemAssetKey);
      if (errors.image) messages.push(errors.image);
      wx.showToast({ title: messages[0], icon: 'none', duration: 2000 });
    }

    return valid;
  },

  validateStep2: function () {
    var form = this.data.form;
    var stock = form.stock;
    if (stock === null || stock === undefined || isNaN(Number(stock)) || Number(stock) < 0) {
      this.setData({ 'fieldErrors.stock': '请输入有效的初始库存' });
      wx.showToast({ title: '请输入有效的初始库存', icon: 'none', duration: 2000 });
      return false;
    }
    var min = form.minStock;
    if (min === null || min === undefined || isNaN(Number(min)) || Number(min) < 0) {
      wx.showToast({ title: '请输入有效的最低库存', icon: 'none', duration: 2000 });
      return false;
    }
    return true;
  },

  /* ====== 完成 ====== */

  onComplete: function () {
    var self = this;
    wx.showModal({
      title: '提示',
      content: '产品保存功能将在后续阶段接入',
      showCancel: false,
      confirmText: '知道了',
      success: function (res) {
        if (res.confirm) {
          wx.navigateBack({
            delta: 1,
            fail: function () {
              wx.switchTab({ url: '/pages/inventory/inventory' });
            }
          });
        }
      }
    });
  },

  /* ====== 导航返回 ====== */

  onBack: function () {
    if (this.data.currentStep > 1) {
      this.onPrevStep();
    } else {
      wx.navigateBack({
        delta: 1,
        fail: function () {
          wx.switchTab({ url: '/pages/inventory/inventory' });
        }
      });
    }
  }
});
