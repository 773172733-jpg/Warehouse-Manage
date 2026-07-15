var TYPE_META = {
  initial: { label: '初始库存', shortLabel: '初始', className: 'initial' },
  inbound: { label: '入库', shortLabel: '入库', className: 'inbound' },
  outbound: { label: '出库', shortLabel: '出库', className: 'outbound' },
  adjustment: { label: '库存调整', shortLabel: '调整', className: 'adjustment' }
};

function parseLocalDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === 'number') {
    var timestampDate = new Date(value);
    return isNaN(timestampDate.getTime()) ? null : timestampDate;
  }
  if (typeof value !== 'string') return null;
  var match = value.trim().match(/^(\d{4})[-\/]([01]?\d)[-\/]([0-3]?\d)(?:[ T]([0-2]?\d):([0-5]?\d)(?::([0-5]?\d))?)?$/);
  if (!match) return null;
  var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

function startOfDay(date) {
  var result = new Date(date.getTime());
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, days) {
  var result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

function getDateRange(key, now) {
  var today = startOfDay(now || new Date());
  var tomorrow = addDays(today, 1);
  if (key === 'today') return { start: today, end: tomorrow };
  if (key === 'yesterday') return { start: addDays(today, -1), end: today };
  if (key === 'last7') return { start: addDays(today, -6), end: tomorrow };
  if (key === 'last30') return { start: addDays(today, -29), end: tomorrow };
  return null;
}

function formatRecordType(type, quantityDelta) {
  var meta = TYPE_META[type] || { label: '未知操作', shortLabel: '未知', className: 'unknown' };
  if (type !== 'adjustment') return meta;
  if (quantityDelta > 0) return { label: '调整增加', shortLabel: '调整', className: 'adjustment-up' };
  if (quantityDelta < 0) return { label: '调整减少', shortLabel: '调整', className: 'adjustment-down' };
  return { label: '无变化', shortLabel: '调整', className: 'adjustment-zero' };
}

function formatQuantityDelta(value) {
  var number = Number(value);
  if (!isFinite(number)) return '—';
  if (number > 0) return '+' + number;
  return String(number);
}

function formatDateTime(date) {
  if (!date) return '—';
  var pad = function (value) { return value < 10 ? '0' + value : String(value); };
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function dateKey(date) {
  var pad = function (value) { return value < 10 ? '0' + value : String(value); };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function groupTitle(date, now) {
  if (!date) return '时间未知';
  var today = startOfDay(now || new Date());
  var day = startOfDay(date);
  if (day.getTime() === today.getTime()) return '今天';
  if (day.getTime() === addDays(today, -1).getTime()) return '昨天';
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function decorateRecord(record) {
  var safe = record || {};
  var parsedDate = parseLocalDate(safe.createdAt);
  var delta = Number(safe.quantityDelta);
  var typeMeta = formatRecordType(safe.type, delta);
  var field = function (value) { return value === undefined || value === null || value === '' ? '—' : String(value); };
  return Object.assign({}, safe, {
    id: field(safe.id),
    productName: field(safe.productName),
    productCode: field(safe.productCode),
    operatorName: field(safe.operatorName),
    unit: field(safe.unit),
    typeLabel: typeMeta.label,
    typeShortLabel: typeMeta.shortLabel,
    typeClass: typeMeta.className,
    deltaText: formatQuantityDelta(safe.quantityDelta),
    stockBeforeText: field(safe.stockBefore),
    stockAfterText: field(safe.stockAfter),
    reasonText: field(safe.reason),
    remarkText: field(safe.remark),
    sourceText: field(safe.sourceOrDestination),
    dateValue: parsedDate ? parsedDate.getTime() : null,
    timeText: parsedDate ? (parsedDate.getHours() < 10 ? '0' : '') + parsedDate.getHours() + ':' + (parsedDate.getMinutes() < 10 ? '0' : '') + parsedDate.getMinutes() : '时间未知',
    dateTimeText: formatDateTime(parsedDate),
    hasRemark: Boolean(safe.remark),
    searchableText: [safe.productName, safe.productCode, safe.operatorName, safe.reason, safe.remark, safe.sourceOrDestination].join(' ').toLowerCase()
  });
}

function filterRecords(records, filters, now) {
  var keyword = String(filters.keyword || '').trim().toLowerCase();
  var range = getDateRange(filters.dateRange, now);
  return (records || []).map(decorateRecord).filter(function (record) {
    if (filters.type && filters.type !== 'all' && record.type !== filters.type) return false;
    if (filters.productId && String(record.productId) !== String(filters.productId)) return false;
    if (filters.operatorId && String(record.operatorId) !== String(filters.operatorId)) return false;
    if (keyword && record.searchableText.indexOf(keyword) === -1) return false;
    if (range) {
      if (record.dateValue === null) return false;
      if (record.dateValue < range.start.getTime() || record.dateValue >= range.end.getTime()) return false;
    }
    return true;
  });
}

function groupRecordsByDate(records, now) {
  var sorted = (records || []).slice().sort(function (a, b) {
    if (a.dateValue === null && b.dateValue === null) return 0;
    if (a.dateValue === null) return 1;
    if (b.dateValue === null) return -1;
    return b.dateValue - a.dateValue;
  });
  var groups = [];
  var groupMap = {};
  sorted.forEach(function (record) {
    var parsed = record.dateValue === null ? null : new Date(record.dateValue);
    var key = parsed ? dateKey(parsed) : 'unknown';
    if (!groupMap[key]) {
      groupMap[key] = { key: key, title: groupTitle(parsed, now), records: [] };
      groups.push(groupMap[key]);
    }
    groupMap[key].records.push(record);
  });
  return groups;
}

function getSummary(records, now) {
  var todayRange = getDateRange('today', now);
  var today = startOfDay(now || new Date());
  var day = today.getDay();
  var mondayOffset = day === 0 ? -6 : 1 - day;
  var weekStart = addDays(today, mondayOffset).getTime();
  var tomorrow = addDays(today, 1).getTime();
  var decorated = (records || []).map(decorateRecord);
  return decorated.reduce(function (summary, record) {
    if (record.dateValue !== null && record.dateValue >= todayRange.start.getTime() && record.dateValue < todayRange.end.getTime()) summary.today += 1;
    if (record.dateValue !== null && record.dateValue >= weekStart && record.dateValue < tomorrow) summary.week += 1;
    return summary;
  }, { today: 0, week: 0 });
}

module.exports = {
  parseLocalDate: parseLocalDate,
  getDateRange: getDateRange,
  formatRecordType: formatRecordType,
  formatQuantityDelta: formatQuantityDelta,
  decorateRecord: decorateRecord,
  filterRecords: filterRecords,
  groupRecordsByDate: groupRecordsByDate,
  getSummary: getSummary
};
