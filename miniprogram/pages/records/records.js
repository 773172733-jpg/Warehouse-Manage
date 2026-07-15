var mockRecords = require('./mock-records').MOCK_RECORDS;
var recordUtils = require('./record-utils');
var productData = require('../inventory/mock-data');

var TYPE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'inbound', label: '入库' },
  { value: 'outbound', label: '出库' },
  { value: 'adjustment', label: '调整' }
];

var DATE_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'yesterday', label: '昨天' },
  { value: 'last7', label: '最近7天' },
  { value: 'last30', label: '最近30天' }
];

function optionLabel(options, value) {
  var found = options.filter(function (item) { return String(item.value) === String(value); })[0];
  return found ? found.label : '';
}

Page({
  data: {
    summary: { today: 0, week: 0 },
    searchText: '',
    activeType: 'all',
    typeOptions: TYPE_OPTIONS,
    productOptions: [],
    operatorOptions: [],
    dateOptions: DATE_OPTIONS,
    appliedProductId: '',
    appliedOperatorId: '',
    appliedDateRange: 'all',
    tempProductId: '',
    tempOperatorId: '',
    tempDateRange: 'all',
    filterTags: [],
    groups: [],
    resultCount: 0,
    hasAnyRecords: false,
    filterOpen: false,
    detailOpen: false,
    selectedRecord: null,
    detailRows: [],
    selectedHasProduct: false
  },

  onLoad: function () {
    var products = productData.getProducts();
    var operators = [];
    var seen = {};
    mockRecords.forEach(function (record) {
      if (!record.operatorId || seen[record.operatorId]) return;
      seen[record.operatorId] = true;
      operators.push({ value: record.operatorId, label: record.operatorName || '未知操作人' });
    });
    this.setData({
      productOptions: products.map(function (item) { return { value: item.id, label: item.name, subLabel: item.code }; }),
      operatorOptions: operators,
      summary: recordUtils.getSummary(mockRecords),
      hasAnyRecords: mockRecords.length > 0
    });
    this.refreshRecords();
  },

  onUnload: function () {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  refreshRecords: function () {
    var filtered = recordUtils.filterRecords(mockRecords, {
      keyword: this.data.searchText,
      type: this.data.activeType,
      productId: this.data.appliedProductId,
      operatorId: this.data.appliedOperatorId,
      dateRange: this.data.appliedDateRange
    });
    this.setData({
      groups: recordUtils.groupRecordsByDate(filtered),
      resultCount: filtered.length,
      filterTags: this.buildFilterTags()
    });
  },

  buildFilterTags: function () {
    var tags = [];
    if (this.data.appliedProductId) tags.push({ key: 'product', label: '产品：' + optionLabel(this.data.productOptions, this.data.appliedProductId) });
    if (this.data.appliedOperatorId) tags.push({ key: 'operator', label: '操作人：' + optionLabel(this.data.operatorOptions, this.data.appliedOperatorId) });
    if (this.data.appliedDateRange && this.data.appliedDateRange !== 'all') tags.push({ key: 'date', label: optionLabel(DATE_OPTIONS, this.data.appliedDateRange) });
    return tags;
  },

  onSearchInput: function (event) {
    var self = this;
    this.setData({ searchText: event.detail.value });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(function () {
      self.searchTimer = null;
      self.refreshRecords();
    }, 160);
  },

  onSearchClear: function () {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.setData({ searchText: '' });
    this.refreshRecords();
  },

  onTypeTap: function (event) {
    this.setData({ activeType: event.currentTarget.dataset.value });
    this.refreshRecords();
  },

  openFilter: function () {
    this.setData({
      filterOpen: true,
      tempProductId: this.data.appliedProductId,
      tempOperatorId: this.data.appliedOperatorId,
      tempDateRange: this.data.appliedDateRange
    });
  },

  closeFilter: function () { this.setData({ filterOpen: false }); },
  stopPropagation: function () {},

  onTempProductTap: function (event) { this.setData({ tempProductId: event.currentTarget.dataset.value }); },
  onTempOperatorTap: function (event) { this.setData({ tempOperatorId: event.currentTarget.dataset.value }); },
  onTempDateTap: function (event) { this.setData({ tempDateRange: event.currentTarget.dataset.value }); },

  resetTempFilters: function () {
    this.setData({ tempProductId: '', tempOperatorId: '', tempDateRange: 'all' });
  },

  applyFilters: function () {
    this.setData({
      filterOpen: false,
      appliedProductId: this.data.tempProductId,
      appliedOperatorId: this.data.tempOperatorId,
      appliedDateRange: this.data.tempDateRange
    });
    this.refreshRecords();
  },

  removeFilterTag: function (event) {
    var key = event.currentTarget.dataset.key;
    var changes = {};
    if (key === 'product') changes.appliedProductId = '';
    if (key === 'operator') changes.appliedOperatorId = '';
    if (key === 'date') changes.appliedDateRange = 'all';
    this.setData(changes);
    this.refreshRecords();
  },

  clearAllFilters: function () {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = null;
    this.setData({
      searchText: '',
      activeType: 'all',
      appliedProductId: '',
      appliedOperatorId: '',
      appliedDateRange: 'all'
    });
    this.refreshRecords();
  },

  openDetail: function (event) {
    var id = String(event.currentTarget.dataset.id);
    var selected = null;
    recordUtils.filterRecords(mockRecords, {}).some(function (item) {
      if (String(item.id) === id) { selected = item; return true; }
      return false;
    });
    if (!selected) return;
    var hasProduct = Boolean(productData.getProductById(selected.productId));
    this.setData({
      detailOpen: true,
      selectedRecord: selected,
      selectedHasProduct: hasProduct,
      detailRows: [
        { label: '记录类型', value: selected.typeLabel },
        { label: '产品名称', value: selected.productName },
        { label: '产品编号', value: selected.productCode },
        { label: '操作前库存', value: selected.stockBeforeText + ' ' + selected.unit },
        { label: '变动数量', value: selected.deltaText + ' ' + selected.unit, accent: true },
        { label: '操作后库存', value: selected.stockAfterText + ' ' + selected.unit },
        { label: '单位', value: selected.unit },
        { label: '操作人', value: selected.operatorName },
        { label: '操作时间', value: selected.dateTimeText },
        { label: '原因', value: selected.reasonText },
        { label: '来源或去向', value: selected.sourceText },
        { label: '备注', value: selected.remarkText },
        { label: '记录编号', value: selected.id }
      ]
    });
  },

  closeDetail: function () { this.setData({ detailOpen: false }); },

  viewProduct: function () {
    var selected = this.data.selectedRecord;
    if (!selected || !productData.getProductById(selected.productId)) return;
    this.setData({ detailOpen: false });
    wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + encodeURIComponent(String(selected.productId)) });
  }
});
