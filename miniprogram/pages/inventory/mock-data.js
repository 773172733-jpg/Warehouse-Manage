/**
 * 库存首页 — 本地模拟数据
 * 阶段1A：仅用于静态UI开发和交互验证，不连接云数据库
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
    status: 'normal'
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
    status: 'normal'
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
    status: 'low'
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
    status: 'out'
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
    status: 'normal'
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
    status: 'normal'
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
    status: 'low'
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
    status: 'normal'
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
    status: 'out'
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
    status: 'normal'
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
    status: 'low'
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
    status: 'normal'
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

module.exports = {
  MOCK_PRODUCTS: MOCK_PRODUCTS,
  CATEGORIES: CATEGORIES,
  getProducts: getProducts
};
