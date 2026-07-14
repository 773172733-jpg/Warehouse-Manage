/**
 * 库存首页 — 本地模拟数据
 * 阶段1A/1B：仅用于静态UI开发和交互验证，不连接云数据库
 */
var MOCK_PRODUCTS = [
  {
    id: 'p001',
    name: '800×800浅灰柔光砖',
    code: 'GZ-800-H',
    category: '瓷砖',
    unit: '箱',
    stock: 126,
    minStock: 30,
    keywords: ['柔光', '浅灰', '800', '地砖', '瓷砖'],
    coverMode: 'text',
    displayText: '800×800',
    status: 'normal',
    brand: '冠珠',
    specification: '800×800mm',
    description: '800×800mm浅灰色柔光砖，防滑耐磨，适用于客厅、卧室、厨房等多种空间。表面采用哑光柔光工艺，触感细腻，不反光。',
    creatorName: '张三',
    createdAt: '2026-05-14 09:32',
    stockRecords: [
      { type: 'inbound', quantity: 20, createdAt: '2026-07-14 14:32', operatorName: '张三' },
      { type: 'inbound', quantity: 50, createdAt: '2026-06-02 09:15', operatorName: '李四' }
    ]
  },
  {
    id: 'p002',
    name: '600×600白色亮面砖',
    code: 'GZ-600-W',
    category: '瓷砖',
    unit: '箱',
    stock: 85,
    minStock: 20,
    keywords: ['白色', '亮面', '600', '墙砖', '瓷砖'],
    coverMode: 'text',
    displayText: '600×600',
    status: 'normal',
    brand: '东鹏',
    specification: '600×600mm',
    description: '600×600mm白色亮面墙砖，釉面光滑，易清洁，适合厨房和卫生间墙面。',
    creatorName: '张三',
    createdAt: '2026-05-18 14:00',
    stockRecords: [
      { type: 'inbound', quantity: 30, createdAt: '2026-07-10 10:00', operatorName: '张三' }
    ]
  },
  {
    id: 'p003',
    name: '美纹纸胶带',
    code: 'MT-025',
    category: '耗材',
    unit: '卷',
    stock: 8,
    minStock: 15,
    keywords: ['胶带', '美纹纸', '遮蔽', '耗材'],
    coverMode: 'text',
    displayText: 'MT',
    status: 'low',
    brand: '3M',
    specification: '25mm×50m',
    description: '3M美纹纸胶带，耐高温、不留残胶，适用于装修遮蔽和喷漆保护。',
    creatorName: '李四',
    createdAt: '2026-04-22 11:10',
    stockRecords: [
      { type: 'inbound', quantity: 20, createdAt: '2026-04-22 11:10', operatorName: '李四' },
      { type: 'outbound', quantity: -12, createdAt: '2026-07-01 08:30', operatorName: '张三' }
    ]
  },
  {
    id: 'p004',
    name: '手持电钻',
    code: 'TL-009',
    category: '工具',
    unit: '台',
    stock: 0,
    minStock: 5,
    keywords: ['电钻', '手持', '电动', '工具'],
    coverMode: 'text',
    displayText: '电钻',
    status: 'out',
    brand: '博世',
    specification: 'GSR 120-LI',
    description: '博世手持锂电钻，双速机械调速，LED照明，适用于木材、金属钻孔和螺丝紧固。',
    creatorName: '张三',
    createdAt: '2026-03-05 16:20',
    stockRecords: [
      { type: 'inbound', quantity: 3, createdAt: '2026-03-05 16:20', operatorName: '张三' },
      { type: 'outbound', quantity: -3, createdAt: '2026-06-28 15:00', operatorName: '李四' }
    ]
  },
  {
    id: 'p005',
    name: '不锈钢螺丝',
    code: 'HW-304',
    category: '五金',
    unit: '盒',
    stock: 360,
    minStock: 50,
    keywords: ['螺丝', '不锈钢', '五金', '304'],
    coverMode: 'text',
    displayText: '304',
    status: 'normal',
    brand: '晋亿',
    specification: 'M4×20mm',
    description: '304不锈钢十字沉头螺丝，耐腐蚀不生锈，适用于室内外装修和家具安装。',
    creatorName: '李四',
    createdAt: '2026-02-18 08:45',
    stockRecords: [
      { type: 'inbound', quantity: 200, createdAt: '2026-02-18 08:45', operatorName: '李四' },
      { type: 'inbound', quantity: 160, createdAt: '2026-06-10 13:20', operatorName: '张三' }
    ]
  },
  {
    id: 'p006',
    name: '十字螺丝刀',
    code: 'TL-012',
    category: '工具',
    unit: '把',
    stock: 22,
    minStock: 10,
    keywords: ['螺丝刀', '十字', '工具', '手动'],
    coverMode: 'text',
    displayText: '螺丝刀',
    status: 'normal',
    brand: '世达',
    specification: 'PH2×150mm',
    description: '世达十字螺丝刀，铬钒钢刀杆，双色手柄，握感舒适。',
    creatorName: '张三',
    createdAt: '2026-06-01 10:00',
    stockRecords: [
      { type: 'inbound', quantity: 30, createdAt: '2026-06-01 10:00', operatorName: '张三' },
      { type: 'outbound', quantity: -8, createdAt: '2026-07-05 09:00', operatorName: '李四' }
    ]
  },
  {
    id: 'p007',
    name: '防水涂料5L',
    code: 'TL-020',
    category: '耗材',
    unit: '桶',
    stock: 3,
    minStock: 5,
    keywords: ['防水', '涂料', '耗材', '5L'],
    coverMode: 'text',
    displayText: '5L',
    status: 'low',
    brand: '德高',
    specification: '5L/桶',
    description: '德高K11防水涂料，双组份聚合物水泥基防水浆料，适用于厨卫阳台防水。',
    creatorName: '李四',
    createdAt: '2026-06-12 14:30',
    stockRecords: [
      { type: 'inbound', quantity: 10, createdAt: '2026-06-12 14:30', operatorName: '李四' },
      { type: 'outbound', quantity: -7, createdAt: '2026-07-08 16:00', operatorName: '张三' }
    ]
  },
  {
    id: 'p008',
    name: '水准仪',
    code: 'TL-015',
    category: '工具',
    unit: '台',
    stock: 2,
    minStock: 2,
    keywords: ['水准仪', '测量', '工具'],
    coverMode: 'text',
    displayText: '水准仪',
    status: 'normal',
    brand: '苏州一光',
    specification: 'DSZ2',
    description: '苏州一光自动安平水准仪，32倍放大，补偿器精度±0.3″，适用于建筑工程水准测量。',
    creatorName: '张三',
    createdAt: '2026-01-20 11:00',
    stockRecords: []
  },
  {
    id: 'p009',
    name: 'A4打印纸',
    code: 'BG-A4',
    category: '办公用品',
    unit: '包',
    stock: 0,
    minStock: 10,
    keywords: ['打印纸', 'A4', '办公', '纸张'],
    coverMode: 'text',
    displayText: 'A4',
    status: 'out',
    brand: '得力',
    specification: 'A4 70g',
    description: '得力A4复印纸，70g/㎡，500张/包，白度适中，双面打印不透墨。',
    creatorName: '李四',
    createdAt: '2026-04-10 09:00',
    stockRecords: [
      { type: 'inbound', quantity: 20, createdAt: '2026-04-10 09:00', operatorName: '李四' },
      { type: 'outbound', quantity: -20, createdAt: '2026-07-12 10:00', operatorName: '张三' }
    ]
  },
  {
    id: 'p010',
    name: '膨胀螺栓 M8×60',
    code: 'HW-M8',
    category: '五金',
    unit: '盒',
    stock: 450,
    minStock: 80,
    keywords: ['螺栓', '膨胀', 'M8', '五金'],
    coverMode: 'text',
    displayText: 'M8',
    status: 'normal',
    brand: '天剑',
    specification: 'M8×60mm',
    description: 'M8×60mm膨胀螺栓，镀锌处理，强度高，适用于混凝土和砖墙固定。',
    creatorName: '张三',
    createdAt: '2026-03-28 15:00',
    stockRecords: [
      { type: 'inbound', quantity: 500, createdAt: '2026-03-28 15:00', operatorName: '张三' },
      { type: 'outbound', quantity: -50, createdAt: '2026-06-15 11:00', operatorName: '李四' }
    ]
  },
  {
    id: 'p011',
    name: '陶瓷芯水龙头',
    code: 'HW-510',
    category: '五金',
    unit: '个',
    stock: 14,
    minStock: 20,
    keywords: ['水龙头', '陶瓷', '五金', '卫浴'],
    coverMode: 'text',
    displayText: '水龙头',
    status: 'low',
    brand: '九牧',
    specification: 'DN15',
    description: '九牧陶瓷阀芯水龙头，全铜主体，表面镀铬，节水起泡器，适合厨房和卫生间台盆。',
    creatorName: '李四',
    createdAt: '2026-05-08 13:40',
    stockRecords: [
      { type: 'inbound', quantity: 30, createdAt: '2026-05-08 13:40', operatorName: '李四' },
      { type: 'outbound', quantity: -16, createdAt: '2026-07-03 09:30', operatorName: '张三' }
    ]
  },
  {
    id: 'p012',
    name: '贴墙砖专用胶',
    code: 'HC-8K',
    category: '耗材',
    unit: '桶',
    stock: 41,
    minStock: 15,
    keywords: ['胶', '贴砖', '专用胶', '耗材'],
    coverMode: 'text',
    displayText: '胶',
    status: 'normal',
    brand: '雨虹',
    specification: '20kg/桶',
    description: '雨虹瓷砖胶，C2级粘结强度，适用于大尺寸瓷砖和石材粘贴，抗下滑性能好。',
    creatorName: '张三',
    createdAt: '2026-06-20 10:15',
    stockRecords: [
      { type: 'inbound', quantity: 50, createdAt: '2026-06-20 10:15', operatorName: '张三' }
    ]
  }
];

var CATEGORIES = ['全部', '瓷砖', '工具', '五金', '耗材', '办公用品'];

function computeStatus(stock, minStock) {
  if (stock <= 0) return 'out';
  if (stock < (minStock || 0)) return 'low';
  return 'normal';
}

function getProducts() {
  return MOCK_PRODUCTS.map(function (product) {
    return Object.assign({}, product, {
      status: computeStatus(product.stock, product.minStock)
    });
  });
}

function getProductById(id) {
  if (!id) return null;
  var found = null;
  MOCK_PRODUCTS.some(function (product) {
    if (product.id === id) {
      found = Object.assign({}, product, {
        status: computeStatus(product.stock, product.minStock)
      });
      return true;
    }
    return false;
  });
  return found;
}

module.exports = {
  MOCK_PRODUCTS: MOCK_PRODUCTS,
  CATEGORIES: CATEGORIES,
  getProducts: getProducts,
  getProductById: getProductById
};
