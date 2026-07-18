var productService = require('../../services/product-service.js');
var productImageService = require('../../services/product-image-service.js');
var ROUTES = require('../../constants/routes.js');
var createUtils = require('./product-create-utils.js');
var productView = require('../../utils/product-view.js');
var SYSTEM_ASSETS = require('../../constants/product-cover-assets.js').SYSTEM_ASSETS;

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

var CATEGORIES = ['瓷砖', '工具', '五金', '耗材', '办公用品', '其他'];

var UNITS = ['个', '件', '台', '套', '箱', '盒', '包', '卷', '片', '米', '平方米', '其他'];

var STOCK_MAX = createUtils.STOCK_MAX;

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

function getValidQuantity(value) {
  var text = String(value === undefined || value === null ? '' : value).trim();
  if (!/^\d+$/.test(text)) return null;
  var number = Number(text);
  if (!Number.isSafeInteger(number) || number < 0 || number > STOCK_MAX) return null;
  return number;
}

function computeStockStatus(stock, minStock) {
  if (stock <= 0) return { status: 'out', label: '缺货', color: 'danger' };
  if (stock <= (minStock || 0)) return { status: 'low', label: '低库存', color: 'warning' };
  return { status: 'normal', label: '正常', color: 'primary' };
}

function logImageFlowError(action, stage, error) {
  console.warn('[LightWarehouse] Product image flow failed.', {
    action: action || '',
    stage: stage || '',
    code: error && error.code ? error.code : 'UNKNOWN',
    requestId: error && error.requestId ? error.requestId : ''
  });
}

Page({
  data: {
    mode: 'create',
    pageTitle: '新增产品',
    currentStep: 1,
    form: {
      coverMode: 'text',
      displayText: '',
      coverColor: '#EAF6EF',
      coverTextEdited: false,
      systemAssetKey: '',
      systemAssetLabel: '',
      systemAssetEmoji: '',
      legacyFallback: false,
      localImagePath: '',
      coverAssetKey: '',
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
    navSideStyle: '',
    pickerVisible: false,
    pickerTitle: '',
    pickerItems: [],
    pickerTarget: '',
    accessChecking: true,
    accessDenied: false,
    detailLoading: false,
    detailError: '',
    saving: false,
    uploading: false,
    saveError: '',
    imageSizeBytes: 0,
    imageExtension: '',
    stageRequestKey: '',
    confirmRequestKey: '',
    stagedAssetKey: '',
    stagedLocalPath: '',
    imageFlowStage: '',
    createRequestKey: '',
    updateRequestKey: '',
    submittedPayloadHash: '',
    createdProduct: null,
    productId: '',
    warehouseProductId: '',
    productVersion: null,
    originalCover: null,
    existingImageFailed: false
  },

  onLoad: function (query) {
    this.pageActive = true;
    this.createCompleted = false;
    var mode = query && query.mode === 'edit' ? 'edit' : 'create';
    var warehouseProductId = mode === 'edit' ? productView.getWarehouseProductId(query) : '';
    this.setData({
      mode: mode,
      pageTitle: mode === 'edit' ? '编辑产品' : '新增产品',
      warehouseProductId: warehouseProductId
    });
    this.calcNavStyle();
    this.computeStockStatus();
    this.verifyCreateAccess();
  },

  onUnload: function () {
    this.pageActive = false;
  },

  safeSetData: function (updates, callback) {
    if (!this.pageActive) return;
    this.setData(updates, callback);
  },

  verifyCreateAccess: function () {
    var self = this;
    var app = getApp();

    function applyRole() {
      if (!self.pageActive) return;
      var role = app.globalData && app.globalData.currentRole;
      if (createUtils.isCreateAllowed(role)) {
        self.safeSetData({ accessChecking: false, accessDenied: false });
        if (self.data.mode === 'edit') self.loadEditProduct();
        return;
      }
      self.safeSetData({ accessChecking: false, accessDenied: true });
      wx.showToast({ title: self.data.mode === 'edit' ? '你没有编辑产品的权限' : '你没有创建产品的权限', icon: 'none', duration: 2000 });
      wx.navigateBack({ fail: function () { wx.switchTab({ url: ROUTES.INVENTORY }); } });
    }

    if (app.globalData && app.globalData.bootstrapStatus === 'success') {
      applyRole();
      return;
    }
    if (!app.bootstrap) {
      applyRole();
      return;
    }
    app.bootstrap()
      .then(applyRole)
      .catch(function () {
        if (!self.pageActive) return;
        self.safeSetData({ accessChecking: false, accessDenied: true });
        wx.showToast({ title: '当前团队状态不可用，请重新进入小程序', icon: 'none', duration: 2000 });
        wx.reLaunch({ url: ROUTES.STARTUP });
      });
  },

  loadEditProduct: function () {
    var self = this;
    if (this.data.mode !== 'edit' || this.data.detailLoading) return Promise.resolve();
    if (!this.data.warehouseProductId) {
      this.safeSetData({ detailError: '产品标识无效，请返回库存页重新选择' });
      return Promise.resolve();
    }
    this.safeSetData({ detailLoading: true, detailError: '', saveError: '' });
    return productService.getProductDetail({ warehouseProductId: this.data.warehouseProductId })
      .then(function (response) {
        var detail = productView.mapProductDetail(response);
        if (!detail.permissions.canEdit || !detail.product.version) {
          var denied = new Error('产品不可编辑');
          denied.code = detail.permissions.canEdit ? 'INVALID_PRODUCT_VERSION' : 'FORBIDDEN';
          throw denied;
        }
        var cover = response.product.cover || {};
        var coverMode = cover.type === 'emoji' ? 'system' : cover.type;
        if (cover.type === 'image') coverMode = 'existing-image';
        if (['none', 'text', 'system', 'existing-image'].indexOf(coverMode) === -1) coverMode = 'none';
        var asset = coverMode === 'system' ? SYSTEM_ASSETS.find(function (item) {
          return item.emoji === cover.emoji;
        }) : null;
        var legacyEmoji = coverMode === 'system' && !asset ? cover.emoji || '' : '';
        var legacyFallback = coverMode === 'system' && !asset;
        var unit = detail.product.unit;
        var knownUnit = UNITS.indexOf(unit) > -1;
        self.safeSetData({
          detailLoading: false,
          detailError: '',
          productId: detail.product.id,
          productVersion: detail.product.version,
          originalCover: cover,
          existingImageFailed: false,
          currentStep: 1,
          updateRequestKey: '',
          submittedPayloadHash: '',
          form: Object.assign({}, self.data.form, {
            coverMode: coverMode,
            displayText: cover.text || '',
            coverColor: cover.background || '#EAF6EF',
            coverTextEdited: true,
            systemAssetKey: asset ? asset.key : '',
            systemAssetLabel: asset ? asset.label : '',
            systemAssetEmoji: cover.emoji || '',
            legacyFallback: legacyFallback,
            localImagePath: cover.type === 'image' ? (cover.imageUrl || '') : '',
            coverAssetKey: '',
            name: detail.product.name,
            code: detail.product.productCode,
            category: detail.product.category,
            unit: knownUnit ? unit : '其他',
            customUnit: knownUnit ? '' : unit,
            specification: detail.product.specification,
            brand: detail.product.brand,
            description: detail.product.description,
            stock: detail.warehouseProduct.stock === null ? 0 : detail.warehouseProduct.stock,
            minStock: detail.warehouseProduct.minStock === null ? 0 : detail.warehouseProduct.minStock,
            lowStockEnabled: true
          })
        }, self.computeStockStatus.bind(self));
      })
      .catch(function (error) {
        if (!self.pageActive) return;
        var message = createUtils.getUpdateErrorMessage(error);
        self.safeSetData({ detailLoading: false, detailError: message });
      });
  },

  onRetryDetail: function () {
    return this.loadEditProduct();
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
    if (this.data.saving || this.data.accessChecking || this.data.accessDenied) return;
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
    if (this.data.saving) return;
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
      if (this.data.form.coverMode === 'existing-image') {
        updates['form.localImagePath'] = '';
        updates['form.coverAssetKey'] = '';
        updates.imageSizeBytes = 0;
        updates.imageExtension = '';
        updates.stageRequestKey = '';
        updates.confirmRequestKey = '';
        updates.stagedAssetKey = '';
        updates.stagedLocalPath = '';
      }
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
          var tempFile = res.tempFiles[0];
          productImageService.inspectLocalImage({
            filePath: tempFile.tempFilePath,
            sizeBytes: tempFile.size,
            fileType: tempFile.fileType
          }).then(function (selected) {
            self.safeSetData({
              'form.coverMode': 'custom',
              'form.localImagePath': selected.filePath,
              'form.coverAssetKey': '',
              'fieldErrors.image': '',
              imageSizeBytes: selected.sizeBytes,
              imageExtension: selected.extension,
              stageRequestKey: '',
              confirmRequestKey: '',
              stagedAssetKey: '',
              stagedLocalPath: '',
              imageFlowStage: ''
            });
          }).catch(function (error) {
            var message = error && error.message ? error.message : '请选择有效图片';
            logImageFlowError('product.image.select', 'select', error);
            self.safeSetData({ 'fieldErrors.image': message });
            wx.showToast({ title: message, icon: 'none', duration: 2200 });
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
    this.setData({
      'form.localImagePath': '',
      'form.coverAssetKey': '',
      imageSizeBytes: 0,
      imageExtension: '',
      stageRequestKey: '',
      confirmRequestKey: '',
      stagedAssetKey: '',
      stagedLocalPath: '',
      imageFlowStage: ''
    });
  },

  onSelectedImageError: function () {
    this.onClearImage();
    this.safeSetData({ 'fieldErrors.image': '图片预览失败，请重新选择' });
    wx.showToast({ title: '图片预览失败，请重新选择', icon: 'none', duration: 2200 });
  },

  onExistingImageError: function () {
    this.safeSetData({ existingImageFailed: true });
  },

  ensureImageStaged: function () {
    var self = this;
    var form = this.data.form;
    if (form.coverMode !== 'custom') return Promise.resolve('');
    if (this.data.stagedAssetKey && this.data.stagedLocalPath === form.localImagePath) {
      return Promise.resolve(this.data.stagedAssetKey);
    }
    var keys = productImageService.createStageRequestKeys({
      stageRequestKey: this.data.stageRequestKey,
      confirmRequestKey: this.data.confirmRequestKey
    });
    this.safeSetData({
      uploading: true,
      stageRequestKey: keys.stageRequestKey,
      confirmRequestKey: keys.confirmRequestKey
    });
    return productImageService.stageProductImage({
      filePath: form.localImagePath,
      sizeBytes: this.data.imageSizeBytes,
      extension: this.data.imageExtension,
      stageRequestKey: keys.stageRequestKey,
      confirmRequestKey: keys.confirmRequestKey,
      onStageChange: function (stage) {
        self.safeSetData({ imageFlowStage: stage });
      }
    }).then(function (result) {
      if (!self.pageActive) return '';
      self.safeSetData({
        uploading: false,
        stagedAssetKey: result.assetKey,
        stagedLocalPath: form.localImagePath,
        imageFlowStage: 'complete',
        'form.coverAssetKey': result.assetKey
      });
      return result.assetKey;
    }).catch(function (error) {
      logImageFlowError('product.image.stage', error && error.stage, error);
      if (self.pageActive) {
        self.safeSetData({
          uploading: false,
          imageFlowStage: error && error.stage ? error.stage : self.data.imageFlowStage
        });
      }
      throw error;
    });
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

  /* ====== 分类（本地选择器）====== */

  onCategoryTap: function () {
    this.setData({
      pickerVisible: true,
      pickerTitle: '选择分类',
      pickerItems: CATEGORIES,
      pickerTarget: 'category'
    });
  },

  /* ====== 单位（本地选择器 + 自定义）====== */

  onUnitTap: function () {
    this.setData({
      pickerVisible: true,
      pickerTitle: '选择单位',
      pickerItems: UNITS,
      pickerTarget: 'unit'
    });
  },

  onPickerSelect: function (e) {
    var value = e.currentTarget.dataset.value;
    var target = this.data.pickerTarget;
    if (target === 'category') {
      this.setData({
        'form.category': value,
        'fieldErrors.category': '',
        pickerVisible: false
      });
    } else if (target === 'unit') {
      var updates = { 'form.unit': value, 'fieldErrors.unit': '', pickerVisible: false };
      if (value !== '其他') {
        updates['form.customUnit'] = '';
      }
      this.setData(updates);
    }
  },

  onPickerClose: function () {
    this.setData({ pickerVisible: false });
  },

  noop: function () {},

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
    this.setData({ 'form.stock': e.detail.value, 'fieldErrors.stock': '' });
    this.computeStockStatus();
  },

  onMinStockInput: function (e) {
    this.setData({ 'form.minStock': e.detail.value });
    this.computeStockStatus();
  },

  onStockDecrease: function () {
    var val = getValidQuantity(this.data.form.stock);
    if (val === null) return;
    if (val > 0) {
      val = val - 1;
      this.setData({ 'form.stock': val, 'fieldErrors.stock': '' });
      this.computeStockStatus();
    }
  },

  onStockIncrease: function () {
    var val = getValidQuantity(this.data.form.stock);
    if (val === null) return;
    if (val < STOCK_MAX) {
      val = val + 1;
      this.setData({ 'form.stock': val, 'fieldErrors.stock': '' });
      this.computeStockStatus();
    }
  },

  onMinStockDecrease: function () {
    var val = getValidQuantity(this.data.form.minStock);
    if (val === null) return;
    if (val > 0) {
      this.setData({ 'form.minStock': val - 1 });
      this.computeStockStatus();
    }
  },

  onMinStockIncrease: function () {
    var val = getValidQuantity(this.data.form.minStock);
    if (val === null) return;
    if (val < STOCK_MAX) {
      this.setData({ 'form.minStock': val + 1 });
      this.computeStockStatus();
    }
  },

  onLowStockToggle: function () {
    this.setData({
      'form.lowStockEnabled': !this.data.form.lowStockEnabled
    }, this.computeStockStatus.bind(this));
  },

  computeStockStatus: function () {
    var stock = getValidQuantity(this.data.form.stock);
    var minStock = this.data.form.lowStockEnabled
      ? getValidQuantity(this.data.form.minStock)
      : 0;
    stock = stock === null ? 0 : stock;
    minStock = minStock === null ? 0 : minStock;
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
    var preservingLegacyCover = this.data.mode === 'edit' && form.legacyFallback &&
      createUtils.isCoverUnchanged(form, this.data.originalCover);
    if (form.coverMode === 'system' && !form.systemAssetKey && !preservingLegacyCover) {
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
    if (this.data.mode !== 'edit' && getValidQuantity(form.stock) === null) {
      this.setData({ 'fieldErrors.stock': '请输入有效的初始库存' });
      wx.showToast({ title: '请输入有效的初始库存', icon: 'none', duration: 2000 });
      return false;
    }
    if (form.lowStockEnabled && getValidQuantity(form.minStock) === null) {
      wx.showToast({ title: '请输入有效的最低库存', icon: 'none', duration: 2000 });
      return false;
    }
    return true;
  },

  /* ====== 完成 ====== */

  onComplete: function () {
    var self = this;
    if (this.data.saving || this.createCompleted || this.data.accessChecking) return;
    if (this.data.mode === 'edit') {
      this.completeUpdate();
      return;
    }
    var app = getApp();
    var role = app.globalData && app.globalData.currentRole;
    if (this.data.accessDenied || !createUtils.isCreateAllowed(role)) {
      wx.showToast({ title: '你没有创建产品的权限', icon: 'none', duration: 2000 });
      return;
    }
    if (!this.validateStep1()) {
      this.setData({ currentStep: 1 });
      return;
    }
    if (!this.validateStep2()) {
      this.setData({ currentStep: 2 });
      return;
    }
    this.safeSetData({ saving: true, saveError: '' });
    this.ensureImageStaged()
      .then(function (assetKey) {
        if (!self.pageActive) return;
        self.submitCreateProduct(app, assetKey);
      })
      .catch(function (error) {
        if (!self.pageActive) return;
        var message = createUtils.getCreateErrorMessage(error);
        self.safeSetData({ saving: false, uploading: false, saveError: message });
        wx.showToast({ title: message, icon: 'none', duration: 2500 });
      });
  },

  submitCreateProduct: function (app, assetKey) {
    var self = this;
    var basePayload;
    try {
      var saveForm = assetKey
        ? Object.assign({}, this.data.form, { coverAssetKey: assetKey })
        : this.data.form;
      basePayload = createUtils.buildCreateProductPayload(saveForm);
    } catch (error) {
      var localMessage = createUtils.getCreateErrorMessage(error);
      this.safeSetData({ saving: false, saveError: localMessage });
      wx.showToast({ title: localMessage, icon: 'none', duration: 2500 });
      return;
    }

    var intent = createUtils.resolveCreateIntent(basePayload, {
      createRequestKey: this.data.createRequestKey,
      submittedPayloadHash: this.data.submittedPayloadHash
    });
    var payload = Object.assign({}, basePayload, { requestKey: intent.requestKey });
    this.safeSetData({
      saveError: '',
      createRequestKey: intent.requestKey,
      submittedPayloadHash: intent.signature,
      imageFlowStage: 'create'
    });

    productService.createProduct(payload)
      .then(function (result) {
        createUtils.validateCreateResult(result, basePayload.initialStock);
        if (!self.pageActive) return;
        self.createCompleted = true;
        if (app.globalData) {
          app.globalData.inventoryRefreshRequired = true;
          app.globalData.stockAlertsRefreshRequired = true;
          if (result.initialRecord) {
            app.globalData.warehouseStockRecordsRefreshRequired = true;
          }
        }
        self.safeSetData({
          saving: false,
          saveError: '',
          createRequestKey: '',
          submittedPayloadHash: '',
          imageFlowStage: 'complete',
          createdProduct: result.product
        });
        wx.showToast({ title: '产品创建成功', icon: 'success', duration: 1500 });
        wx.switchTab({ url: ROUTES.INVENTORY });
      })
      .catch(function (error) {
        if (!self.pageActive) return;
        var handledError = Object.assign({}, error, {
          code: error && error.code,
          message: error && error.message,
          stage: error && error.stage ? error.stage : 'create'
        });
        logImageFlowError('product.create', 'create', handledError);
        var message = createUtils.getCreateErrorMessage(handledError);
        var updates = { saving: false, saveError: message };
        if (handledError.code === 'REQUEST_KEY_CONFLICT') {
          updates.createRequestKey = '';
          updates.submittedPayloadHash = '';
        }
        self.safeSetData(updates);
        wx.showToast({ title: message, icon: 'none', duration: 2500 });
        if (createUtils.shouldRestartStartup(handledError.code)) {
          self.restartStartup();
        }
      });
  },

  completeUpdate: function () {
    var self = this;
    var app = getApp();
    var role = app.globalData && app.globalData.currentRole;
    if (this.data.saving || this.data.detailLoading || this.data.accessDenied ||
        !createUtils.isCreateAllowed(role)) {
      return;
    }
    if (!this.validateStep1()) {
      this.safeSetData({ currentStep: 1 });
      return;
    }
    if (!this.validateStep2()) {
      this.safeSetData({ currentStep: 2 });
      return;
    }
    this.safeSetData({ saving: true, saveError: '' });
    this.ensureImageStaged()
      .then(function (assetKey) {
        if (!self.pageActive) return;
        self.submitProductUpdate(app, assetKey);
      })
      .catch(function (error) {
        if (!self.pageActive) return;
        var message = createUtils.getUpdateErrorMessage(error);
        self.safeSetData({ saving: false, uploading: false, saveError: message });
        wx.showToast({ title: message, icon: 'none', duration: 2500 });
      });
  },

  submitProductUpdate: function (app, assetKey) {
    var self = this;
    var basePayload;
    try {
      var saveForm = assetKey
        ? Object.assign({}, this.data.form, { coverAssetKey: assetKey })
        : this.data.form;
      basePayload = createUtils.buildUpdateProductPayload(saveForm, {
        productId: this.data.productId,
        expectedVersion: this.data.productVersion,
        originalCover: this.data.originalCover
      });
    } catch (error) {
      var localMessage = createUtils.getUpdateErrorMessage(error);
      this.safeSetData({ saving: false, saveError: localMessage });
      wx.showToast({ title: localMessage, icon: 'none', duration: 2500 });
      return;
    }
    var intent = createUtils.resolveUpdateIntent(basePayload, {
      updateRequestKey: this.data.updateRequestKey,
      submittedPayloadHash: this.data.submittedPayloadHash
    });
    var payload = Object.assign({}, basePayload, { requestKey: intent.requestKey });
    this.safeSetData({
      saveError: '',
      updateRequestKey: intent.requestKey,
      submittedPayloadHash: intent.signature
    });
    productService.updateProduct(payload)
      .then(function (result) {
        if (!self.pageActive || !result || !result.product || !result.product.version) return;
        self.safeSetData({
          saving: false,
          saveError: '',
          productVersion: result.product.version,
          updateRequestKey: '',
          submittedPayloadHash: ''
        });
        if (app.globalData) {
          app.globalData.inventoryRefreshRequired = true;
          app.globalData.stockAlertsRefreshRequired = true;
        }
        wx.showToast({ title: '产品信息已更新', icon: 'success', duration: 1400 });
        wx.navigateBack({ delta: 1 });
      })
      .catch(function (error) {
        if (!self.pageActive) return;
        var message = createUtils.getUpdateErrorMessage(error);
        var updates = { saving: false, saveError: message };
        if (error && error.code === 'REQUEST_KEY_CONFLICT') {
          updates.updateRequestKey = '';
          updates.submittedPayloadHash = '';
        }
        self.safeSetData(updates);
        if (error && error.code === 'PRODUCT_VERSION_CONFLICT') {
          self.showVersionConflict();
          return;
        }
        wx.showToast({ title: message, icon: 'none', duration: 2500 });
      });
  },

  showVersionConflict: function () {
    var self = this;
    wx.showModal({
      title: '产品信息已变化',
      content: '产品已被其他成员修改，请刷新后重新编辑',
      confirmText: '重新加载',
      cancelText: '取消返回',
      success: function (result) {
        self.safeSetData({ updateRequestKey: '', submittedPayloadHash: '' });
        if (result.confirm) {
          self.loadEditProduct();
        } else {
          wx.navigateBack({ delta: 1, fail: function () { wx.switchTab({ url: ROUTES.INVENTORY }); } });
        }
      }
    });
  },

  restartStartup: function () {
    var self = this;
    var app = getApp();
    var refresh = app.bootstrap ? app.bootstrap({ forceRefresh: true }) : Promise.resolve();
    refresh.catch(function () {
      // startup 页面负责展示新的初始化结果。
    }).finally(function () {
      if (self.pageActive) {
        wx.reLaunch({ url: ROUTES.STARTUP });
      }
    });
  },

  /* ====== 导航返回 ====== */

  onBack: function () {
    if (this.data.saving) return;
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
