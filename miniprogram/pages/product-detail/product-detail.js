var mock = require('../inventory/mock-data');

Page({
  data: {
    product: null,
    descExpanded: false,
    descNeedsExpand: false,
    loading: true,
    navStyle: '',
    showFullStock: false,
    stockLabel: '当前库存',
    stockSub: ''
  },

  onLoad: function (query) {
    this.calcNavStyle();
    var id = query.id || '';
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    var product = mock.getProductById(id);
    if (product) {
      var needsExpand = product.description && product.description.length > 80;
      var stockMeta = computeStockMeta(product);
      this.setData({
        product: product,
        descNeedsExpand: needsExpand,
        descExpanded: false,
        loading: false,
        stockLabel: stockMeta.label,
        stockSub: stockMeta.sub
      });
    } else {
      this.setData({ loading: false });
    }
  },

  calcNavStyle: function () {
    var system = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    var menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    var statusBar = system.statusBarHeight || 20;
    var navHeight = menu ? (menu.top - statusBar) * 2 + menu.height : 44;
    var right = menu ? Math.max(96, system.windowWidth - menu.left + 8) : 16;
    this.setData({
      navStyle: 'padding-top:' + statusBar + 'px;height:' + navHeight + 'px;padding-right:' + right + 'px'
    });
  },

  toggleDesc: function () {
    this.setData({ descExpanded: !this.data.descExpanded });
  },

  toggleStockDetail: function () {
    this.setData({ showFullStock: !this.data.showFullStock });
  },

  onInbound: function () {
    wx.showToast({ title: '入库功能将在后续阶段开放', icon: 'none', duration: 2000 });
  },

  onOutbound: function () {
    wx.showToast({ title: '出库功能将在后续阶段开放', icon: 'none', duration: 2000 });
  },

  onMore: function () {
    wx.showActionSheet({
      itemList: ['编辑产品', '调整库存', '移入回收站'],
      success: function (res) {
        if (res.tapIndex !== undefined) {
          wx.showToast({ title: '该功能将在后续阶段开放', icon: 'none', duration: 2000 });
        }
      }
    });
  },

  goToInventory: function () {
    wx.switchTab({ url: '/pages/inventory/inventory' });
  },

  onBack: function () {
    wx.navigateBack({ delta: 1 });
  }
});

function computeStockMeta(product) {
  if (!product) return { label: '当前库存', sub: '' };
  var status = product.status;
  var minStock = product.minStock || 0;
  if (status === 'out') return { label: '当前库存', sub: '无可用库存，需尽快补货' };
  if (status === 'low') {
    var gap = minStock - product.stock;
    return { label: '当前库存', sub: '低于安全库存' + gap + product.unit + '，建议补货' };
  }
  return { label: '当前库存', sub: '库存充足，无需补货' };
}
