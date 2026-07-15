var products = require('../inventory/mock-data').MOCK_PRODUCTS;

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

function localDateTime(daysAgo, time) {
  var date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-') + ' ' + time;
}

function product(id) {
  var match = products.filter(function (item) { return item.id === id; })[0];
  return match || { id: id, name: '未知产品', code: '—', unit: '件' };
}

function record(id, productId, type, delta, before, daysAgo, time, operatorId, operatorName, extra) {
  var item = product(productId);
  return Object.assign({
    id: id,
    productId: productId,
    productName: item.name,
    productCode: item.code,
    type: type,
    quantityDelta: delta,
    stockBefore: before,
    stockAfter: before + delta,
    unit: item.unit,
    reason: '',
    remark: '',
    sourceOrDestination: '',
    operatorId: operatorId,
    operatorName: operatorName,
    createdAt: localDateTime(daysAgo, time)
  }, extra || {});
}

var MOCK_RECORDS = [
  record('REC-20260715-001', 'p001', 'inbound', 20, 106, 0, '14:32', 'u002', '张三', { reason: '采购入库', remark: '供应商补货', sourceOrDestination: '佛山冠珠仓库' }),
  record('REC-20260715-002', 'p003', 'outbound', -3, 11, 0, '11:08', 'u001', '官明基', { reason: '施工领用', sourceOrDestination: '滨江项目部' }),
  record('REC-20260715-003', 'p005', 'adjustment', 12, 348, 0, '09:26', 'u003', '李四', { reason: '盘点差异', remark: '补录未登记到货' }),
  record('REC-20260714-001', 'p002', 'outbound', -5, 90, 1, '17:45', 'u004', '王师傅', { reason: '项目领用', remark: '卫生间样板间施工', sourceOrDestination: '城南样板间' }),
  record('REC-20260714-002', 'p007', 'inbound', 5, 0, 1, '13:20', 'u002', '张三', { reason: '紧急补货', sourceOrDestination: '德高经销商' }),
  record('REC-20260714-003', 'p006', 'adjustment', -2, 24, 1, '08:55', 'u001', '官明基', { reason: '盘点差异', remark: '两把工具损坏报废' }),
  record('REC-20260713-001', 'p010', 'outbound', -30, 480, 2, '16:12', 'u003', '李四', { reason: '施工领用', sourceOrDestination: '西区工地' }),
  record('REC-20260713-002', 'p012', 'inbound', 10, 31, 2, '10:05', 'u004', '王师傅', { reason: '采购入库', remark: '雨虹瓷砖胶到货', sourceOrDestination: '雨虹供应商' }),
  record('REC-20260712-001', 'p011', 'adjustment', -1, 15, 3, '15:40', 'u002', '张三', { reason: '盘点差异' }),
  record('REC-20260711-001', 'p008', 'initial', 2, 0, 4, '09:10', 'u001', '官明基', { reason: '初始化产品库存' }),
  record('REC-20260710-001', 'p004', 'outbound', -1, 1, 5, '18:02', 'u004', '王师傅', { reason: '维修领用', sourceOrDestination: '维修班组' }),
  record('REC-20260709-001', 'p009', 'inbound', 20, 0, 6, '11:30', 'u003', '李四', { reason: '办公采购', sourceOrDestination: '办公用品供应商' }),
  record('REC-20260708-001', 'p001', 'adjustment', 0, 126, 7, '14:18', 'u001', '官明基', { reason: '例行盘点', remark: '账实一致' }),
  record('REC-20260705-001', 'p003', 'inbound', 12, 0, 10, '10:42', 'u002', '张三', { reason: '采购入库', sourceOrDestination: '3M经销商' }),
  record('REC-20260628-001', 'p005', 'outbound', -40, 400, 17, '09:35', 'u004', '王师傅', { reason: '施工领用', remark: '用于门窗安装', sourceOrDestination: '北区工地' }),
  record('REC-UNKNOWN-001', 'missing-product', 'unexpected', 1, 0, 24, '12:00', 'u003', '李四', { productName: '历史迁移产品', productCode: 'OLD-001', reason: '历史数据迁移', createdAt: 'invalid-date' })
];

module.exports = {
  MOCK_RECORDS: MOCK_RECORDS
};
