var mock = require('./mock-data');

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
    searchFocused: false
  },

  onShow: function () {
    var products = mock.getProducts();
    var summary = this.calcSummary(products);
    this.setData({ products: products, summary: summary }, function () {
      this.applyFilters();
    }.bind(this));
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
    wx.showToast({ title: '新增产品功能将在后续阶段开放', icon: 'none', duration: 2000 });
  },

  onCardTap: function (e) {
    var id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + id });
    }
  },

  onCardMenu: function (e) {
    var id = e.currentTarget.dataset.id;
    var self = this;
    wx.showActionSheet({
      itemList: ['查看详情', '入库', '出库'],
      success: function (res) {
        if (res.tapIndex === 0) {
          if (id) wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + id });
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
