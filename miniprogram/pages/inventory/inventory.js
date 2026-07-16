var mock = require('./mock-data.js');

Page({
  data: {
    products: [],
    filteredList: [],
    searchText: '',
    activeCategory: '全部',
    activeStockFilter: '',
    summary: { total: 0, lowCount: 0, outCount: 0 },
    categories: mock.CATEGORIES,
    placeholder: '搜索产品名称、编号或关键词',
    searchFocused: false,
    canCreateProduct: false
  },

  onShow: function () {
    var app = getApp();
    var role = app.globalData && app.globalData.currentRole;
    var products = mock.getProducts();
    var summary = this.calcSummary(products);
    this.setData({
      products: products,
      summary: summary,
      canCreateProduct: role === 'owner' || role === 'admin'
    }, function () {
      this.applyFilters();
    }.bind(this));
    this.refreshCreatePermission(app);
  },

  refreshCreatePermission: function (app) {
    var self = this;
    if (!app.bootstrap || (app.globalData && app.globalData.bootstrapStatus === 'success')) return;
    app.bootstrap()
      .then(function () {
        var role = app.globalData && app.globalData.currentRole;
        self.setData({ canCreateProduct: role === 'owner' || role === 'admin' });
      })
      .catch(function () {
        self.setData({ canCreateProduct: false });
      });
  },

  calcSummary: function (products) {
    var total = products.length;
    var lowCount = 0;
    var outCount = 0;
    products.forEach(function (p) {
      if (p.status === 'low') lowCount += 1;
      if (p.status === 'out') outCount += 1;
    });
    return { total: total, lowCount: lowCount, outCount: outCount };
  },

  onSearchInput: function (e) {
    this.setData({ searchText: e.detail.value }, this.applyFilters);
  },

  onSearchClear: function () {
    this.setData({ searchText: '' }, this.applyFilters);
  },

  onSearchFocus: function () {
    this.setData({ searchFocused: true });
  },

  onSearchBlur: function () {
    this.setData({ searchFocused: false });
  },

  onCategoryTap: function (e) {
    this.setData({
      activeCategory: e.currentTarget.dataset.category,
      activeStockFilter: ''
    }, this.applyFilters);
  },

  onSummaryTap: function (e) {
    var key = e.currentTarget.dataset.key;
    if (key === this.data.activeStockFilter) {
      this.setData({ activeStockFilter: '', activeCategory: '全部' }, this.applyFilters);
    } else {
      this.setData({ activeStockFilter: key, activeCategory: '全部' }, this.applyFilters);
    }
  },

  onAddTap: function () {
    var app = getApp();
    var role = app.globalData && app.globalData.currentRole;
    if (role !== 'owner' && role !== 'admin') {
      wx.showToast({ title: '你没有创建产品的权限', icon: 'none', duration: 2000 });
      return;
    }
    wx.navigateTo({
      url: '/pages/product-edit/product-edit?mode=create'
    });
  },

  onCardTap: function (e) {
    var id = e.currentTarget.dataset.id;
    navigateToProduct(id);
  },

  onCardMenu: function (e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    wx.showActionSheet({
      itemList: ['查看详情', '入库', '出库'],
      success: function (res) {
        if (res.tapIndex === 0) {
          navigateToProduct(id);
        } else {
          wx.showToast({ title: '该功能将在后续阶段开放', icon: 'none', duration: 2000 });
        }
      }
    });
  },

  applyFilters: function () {
    var searchText = this.data.searchText.trim().toLowerCase();
    var activeCategory = this.data.activeCategory;
    var activeStockFilter = this.data.activeStockFilter;
    var list = this.data.products.slice();

    if (activeStockFilter === 'low') {
      list = list.filter(function (p) { return p.status === 'low'; });
    } else if (activeStockFilter === 'out') {
      list = list.filter(function (p) { return p.status === 'out'; });
    }

    if (activeCategory !== '全部') {
      list = list.filter(function (p) { return p.category === activeCategory; });
    }

    if (searchText) {
      list = list.filter(function (p) {
        if (p.name.toLowerCase().indexOf(searchText) > -1) return true;
        if (p.code.toLowerCase().indexOf(searchText) > -1) return true;
        if (p.keywords && p.keywords.some(function (kw) {
          return kw.toLowerCase().indexOf(searchText) > -1;
        })) return true;
        return false;
      });
    }

    this.setData({ filteredList: list });
  }
});

function navigateToProduct(id) {
  if (id === undefined || id === null || id === '') return;
  wx.navigateTo({
    url: '/pages/product-detail/product-detail?id=' + encodeURIComponent(String(id))
  });
}
