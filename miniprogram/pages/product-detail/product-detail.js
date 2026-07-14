var mock = require('../inventory/mock-data');

Page({
  data: {
    product: null,
    descExpanded: false,
    descNeedsExpand: false,
    loading: true
  },

  onLoad: function (query) {
    var id = query.id || '';
    if (!id) {
      this.setData({ loading: false });
      return;
    }
    var product = mock.getProductById(id);
    if (product && product.description && product.description.length > 80) {
      this.setData({ descNeedsExpand: true });
    }
    this.setData({ product: product || null, loading: false });
  },

  toggleDesc: function () {
    this.setData({ descExpanded: !this.data.descExpanded });
  },

  onInbound: function () {
    wx.showToast({ title: '入库功能将在后续阶段开放', icon: 'none', duration: 2000 });
  },

  onOutbound: function () {
    wx.showToast({ title: '出库功能将在后续阶段开放', icon: 'none', duration: 2000 });
  },

  onMore: function () {
    var self = this;
    wx.showActionSheet({
      itemList: ['编辑产品', '调整库存', '移入回收站'],
      success: function () {
        wx.showToast({ title: '该功能将在后续阶段开放', icon: 'none', duration: 2000 });
      }
    });
  },

  goToInventory: function () {
    wx.switchTab({ url: '/pages/inventory/inventory' });
  }
});
