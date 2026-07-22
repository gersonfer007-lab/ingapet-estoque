const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'ingapet.db');

let SQL;
let db;

function getDb() {
  if (db) return db;
  throw new Error('Database not initialized. Call initDatabase() first.');
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function initDatabase() {
  SQL = await initSqlJs();

  // Carregar banco existente ou criar novo
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  // Tabela de produtos
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price TEXT NOT NULL,
      price_delivery TEXT,
      description TEXT,
      image TEXT,
      barcode TEXT,
      brand TEXT,
      active INTEGER DEFAULT 1,
      featured INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Tabela de estoque
  db.run(`
    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      min_quantity INTEGER NOT NULL DEFAULT 5,
      updated_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // Tabela de movimentacoes
  db.run(`
    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('in', 'out', 'adjust')),
      quantity INTEGER NOT NULL,
      reason TEXT,
      notes TEXT,
      reference TEXT,
      user TEXT DEFAULT 'sistema',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // Tabela de pedidos do WhatsApp
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      items TEXT NOT NULL,
      total TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'delivered', 'cancelled')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Tabela de configuracoes
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Tabela de usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    )
  `);

  // Criar usuario admin padrao se nao existir
  const userCount = db.exec('SELECT COUNT(*) as c FROM users');
  const uCount = userCount.length > 0 ? userCount[0].values[0][0] : 0;
  if (uCount === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('ingapet2024', 10);
    db.run('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
      ['admin', hash, 'Administrador', 'admin']);
  }

  // Dados iniciais de exemplo (se vazio)
  const countResult = db.exec('SELECT COUNT(*) as c FROM products');
  const count = countResult.length > 0 ? countResult[0].values[0][0] : 0;
  if (count === 0) {
    insertInitialProducts();
  }

  saveDb();
}

// Helper: executa SELECT e retorna array de objetos
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: executa SELECT e retorna primeiro objeto ou null
function queryOne(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function insertInitialProducts() {
  const products = [
    { id: 'gas-1', name: 'Botijao de Gas 13kg', category: 'gas', price: 'R$ 99,99', price_delivery: 'R$ 125,00', description: 'Botijao de gas de cozinha 13kg', stock: 15, min: 5 },
    { id: 'carvao-4', name: 'Carvao Vegetal 4kg', category: 'gas', price: 'R$ 19,99', description: 'Carvao vegetal para churrasco', stock: 30, min: 10 },
    { id: 'carvao-7', name: 'Carvao Vegetal 7kg', category: 'gas', price: 'R$ 34,99', description: 'Carvao vegetal para churrasco', stock: 20, min: 8 },
    { id: 'agua-20', name: 'Garrafao de Agua 20L', category: 'agua', price: 'R$ 18,00', description: 'Garrafao de agua mineral 20 litros', stock: 25, min: 10 },
    { id: 'agua-garoto', name: 'Agua Garoto Fardo 500ml', category: 'agua', price: 'R$ 11,99', description: 'Fardo 500ml - 12 unidades', stock: 18, min: 6 },
    { id: 'special-dog-15', name: 'Special Dog Premium 15kg', category: 'pets', price: 'R$ 109,90', description: 'Racao para caes adultos - Sabor Carne', stock: 12, min: 5 },
    { id: 'special-dog-20', name: 'Special Dog 20kg', category: 'pets', price: 'R$ 134,90', description: 'Racao para caes adultos', stock: 10, min: 4 },
    { id: 'vitta-natural-15', name: 'Vitta Natural 15kg', category: 'pets', price: 'R$ 138,90', description: 'Racao Premium para caes adultos', stock: 8, min: 4 },
    { id: 'billy-dog-15', name: 'Billy Dog 15kg', category: 'pets', price: 'R$ 99,90', description: 'Racao para caes adultos', stock: 14, min: 5 },
    { id: 'billy-dog-10', name: 'Billy Dog 10,1kg', category: 'pets', price: 'R$ 74,90', description: 'Racao para caes adultos', stock: 16, min: 6 },
    { id: 'spert-15', name: 'Spert 15kg', category: 'pets', price: 'R$ 109,90', description: 'Racao para caes adultos', stock: 11, min: 5 },
    { id: 'formula-natural-15', name: 'Formula Natural Life 15kg', category: 'pets', price: 'R$ 129,90', description: 'Racao para caes adultos', stock: 7, min: 3 },
    { id: 'origens-class-15', name: 'Origens Class 15kg', category: 'pets', price: 'R$ 114,90', description: 'Racao para caes adultos', stock: 9, min: 4 },
    { id: 'odin-7', name: 'Odin Caes Adulto 7kg', category: 'pets', price: 'R$ 84,90', description: 'Racao para caes adultos', stock: 13, min: 5 },
    { id: 'areia-variedade', name: 'Areia Sanitaria para Gatos', category: 'pets', price: 'A partir de R$ 12,90', description: 'Areia sanitaria - diversas marcas', stock: 22, min: 8 },
    { id: 'areia-bionature', name: 'Areia Bionature Biodegradavel', category: 'pets', price: 'R$ 24,90', description: 'Areia biodegradavel sustentavel', stock: 15, min: 6 },
    { id: 'cama-pet', name: 'Cama Pet', category: 'pets', price: 'A partir de R$ 39,90', description: 'Camas para pets - diversos tamanhos', stock: 6, min: 2 },
    { id: 'tapetes', name: 'Tapetes Higienicos', category: 'pets', price: 'A partir de R$ 19,90', description: 'Tapetes higienicos - diversos tamanhos', stock: 20, min: 8 },
    { id: 'comedouros', name: 'Comedouros e Bebedouros', category: 'pets', price: 'A partir de R$ 9,90', description: 'Plastico e inox', stock: 18, min: 6 },
    { id: 'coleiras', name: 'Coleiras, Guias e Peitorais', category: 'pets', price: 'A partir de R$ 14,90', description: 'Diversos tamanhos e cores', stock: 25, min: 10 },
    { id: 'brinquedos', name: 'Brinquedos para Pets', category: 'pets', price: 'A partir de R$ 9,90', description: 'Brinquedos variados para caes e gatos', stock: 30, min: 12 },
    { id: 'petiscos-geral', name: 'Petiscos e Ossinhos', category: 'pets', price: 'A partir de R$ 7,90', description: 'Diversos sabores e tamanhos', stock: 35, min: 15 },
    { id: 'sheba-churu', name: 'Petiscos Cremosos Sheba e Churu', category: 'pets', price: 'A partir de R$ 4,90', description: 'Petiscos cremosos para gatos', stock: 28, min: 10 },
    { id: 'special-cat-saches', name: 'Special Cat Cx 12 Saches', category: 'pets', price: 'R$ 29,90', description: 'Caixa com 12 saches para gatos', stock: 12, min: 5 },
    { id: 'golden-cookie', name: 'Golden Cookie / Biscrok', category: 'pets', price: 'A partir de R$ 14,90', description: 'Biscoitos para caes', stock: 20, min: 8 },
    { id: 'vasos', name: 'Vasos e Cachepots', category: 'casa', price: 'A partir de R$ 9,90', description: 'Ceramica e plastico - diversos tamanhos', stock: 15, min: 5 },
    { id: 'ferramentas-jardim', name: 'Ferramentas de Jardim', category: 'casa', price: 'A partir de R$ 12,90', description: 'Pas, rastelos, tesouras e acessorios', stock: 10, min: 3 },
    { id: 'sementes-feltrin', name: 'Sementes Feltrin', category: 'casa', price: 'A partir de R$ 4,90', description: 'Diversas variedades para horta e jardim', stock: 40, min: 15 },
    { id: 'bebidas', name: 'Bebidas Geladas', category: 'casa', price: 'A partir de R$ 4,00', description: 'Refrigerantes, sucos e bebidas', stock: 50, min: 20 },
    { id: 'mangueira', name: 'Mangueira Paciflex', category: 'casa', price: 'R$ 8,90', description: 'Mangueira para jardim', stock: 8, min: 3 },
    { id: 'viveiro-chines', name: 'Viveiro Chines para Passaros', category: 'casa', price: 'A partir de R$ 39,90', description: 'Diversos tamanhos e cores', stock: 5, min: 2 },
    { id: 'gaiola-calopsita', name: 'Gaiola para Calopsita', category: 'casa', price: 'A partir de R$ 59,90', description: 'Gaiolas para passaros pequenos', stock: 4, min: 2 },
  ];

  for (const p of products) {
    db.run(
      'INSERT INTO products (id, name, category, price, price_delivery, description) VALUES (?, ?, ?, ?, ?, ?)',
      [p.id, p.name, p.category, p.price, p.price_delivery || null, p.description]
    );
    db.run(
      'INSERT INTO stock (product_id, quantity, min_quantity) VALUES (?, ?, ?)',
      [p.id, p.stock, p.min]
    );
    db.run(
      "INSERT INTO movements (product_id, type, quantity, reason, notes) VALUES (?, 'in', ?, 'Estoque inicial', 'Cadastro inicial do sistema')",
      [p.id, p.stock]
    );
  }
}

// Funcoes de acesso a dados
function getAllProducts() {
  return queryAll(`
    SELECT p.*, s.quantity, s.min_quantity, s.updated_at as stock_updated
    FROM products p
    LEFT JOIN stock s ON p.id = s.product_id
    WHERE p.active = 1
    ORDER BY p.name
  `);
}

function getProduct(id) {
  return queryOne(`
    SELECT p.*, s.quantity, s.min_quantity
    FROM products p
    LEFT JOIN stock s ON p.id = s.product_id
    WHERE p.id = ?
  `, [id]);
}

function createProduct(data) {
  const id = data.id || `${data.category}-${Date.now()}`;

  db.run(
    'INSERT INTO products (id, name, category, price, price_delivery, description, image, barcode, brand, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, data.name, data.category, data.price, data.price_delivery || null, data.description || '', data.image || null, data.barcode || null, data.brand || null, data.featured ? 1 : 0]
  );
  db.run(
    'INSERT INTO stock (product_id, quantity, min_quantity) VALUES (?, ?, ?)',
    [id, data.initial_stock || 0, data.min_quantity || 5]
  );

  saveDb();
  return id;
}

function updateProduct(id, data) {
  const current = getProduct(id);
  if (!current) return;

  const name = data.name !== undefined ? data.name : current.name;
  const category = data.category !== undefined ? data.category : current.category;
  const price = data.price !== undefined ? data.price : current.price;
  const price_delivery = data.price_delivery !== undefined ? data.price_delivery : current.price_delivery;
  const description = data.description !== undefined ? data.description : current.description;
  const image = data.image !== undefined ? data.image : current.image;
  const brand = data.brand !== undefined ? data.brand : current.brand;
  const featured = data.featured !== undefined ? (data.featured ? 1 : 0) : current.featured;

  db.run(
    "UPDATE products SET name = ?, category = ?, price = ?, price_delivery = ?, description = ?, image = ?, brand = ?, featured = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
    [name, category, price, price_delivery, description, image, brand, featured, id]
  );
  
  if (data.quantity !== undefined) {
    db.run(
      "UPDATE stock SET quantity = ?, min_quantity = ?, updated_at = datetime('now', 'localtime') WHERE product_id = ?",
      [data.quantity, data.min_quantity || 5, id]
    );
  }

  saveDb();
}

function deleteProduct(id) {
  db.run('UPDATE products SET active = 0 WHERE id = ?', [id]);
  saveDb();
}

function addStockMovement(productId, type, quantity, reason, notes, reference) {
  const stockData = queryOne('SELECT quantity FROM stock WHERE product_id = ?', [productId]);
  const currentQty = stockData ? stockData.quantity : 0;
  const newQty = type === 'in' ? currentQty + quantity : Math.max(0, currentQty - quantity);

  db.run(
    'INSERT INTO movements (product_id, type, quantity, reason, notes, reference) VALUES (?, ?, ?, ?, ?, ?)',
    [productId, type, quantity, reason || '', notes || '', reference || '']
  );
  db.run(
    "UPDATE stock SET quantity = ?, updated_at = datetime('now', 'localtime') WHERE product_id = ?",
    [newQty, productId]
  );

  saveDb();
  return newQty;
}

function getMovements(productId, limit = 50) {
  if (productId) {
    return queryAll(`
      SELECT m.*, p.name as product_name
      FROM movements m
      JOIN products p ON m.product_id = p.id
      WHERE m.product_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `, [productId, limit]);
  }
  return queryAll(`
    SELECT m.*, p.name as product_name
    FROM movements m
    JOIN products p ON m.product_id = p.id
    ORDER BY m.created_at DESC
    LIMIT ?
  `, [limit]);
}

function getStockSummary() {
  const summary = queryOne(`
    SELECT
      COUNT(*) as total_products,
      SUM(s.quantity) as total_items,
      SUM(CASE WHEN s.quantity <= s.min_quantity THEN 1 ELSE 0 END) as low_stock,
      COUNT(DISTINCT p.category) as categories
    FROM products p
    JOIN stock s ON p.id = s.product_id
    WHERE p.active = 1
  `);

  const lowStockItems = queryAll(`
    SELECT p.id, p.name, s.quantity, s.min_quantity, p.category
    FROM products p
    JOIN stock s ON p.id = s.product_id
    WHERE p.active = 1 AND s.quantity <= s.min_quantity
    ORDER BY (CAST(s.quantity AS REAL) / s.min_quantity) ASC
    LIMIT 10
  `);

  const recentMovements = queryAll(`
    SELECT m.*, p.name as product_name
    FROM movements m
    JOIN products p ON m.product_id = p.id
    ORDER BY m.created_at DESC
    LIMIT 10
  `);

  return { summary, lowStockItems, recentMovements };
}

function createOrder(phone, items, total) {
  db.run(
    'INSERT INTO orders (phone, items, total) VALUES (?, ?, ?)',
    [phone, JSON.stringify(items), total]
  );
  // Pegar o ultimo ID inserido
  const result = queryOne('SELECT last_insert_rowid() as id');
  saveDb();
  return result ? result.id : 0;
}

function getOrders(limit = 50) {
  return queryAll('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?', [limit]);
}

function updateOrderStatus(id, status) {
  db.run(
    "UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
    [status, id]
  );
  saveDb();
}

function getUserByUsername(username) {
  return queryOne('SELECT * FROM users WHERE username = ?', [username]);
}

function updateUserPassword(id, hashedPassword) {
  db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, id]);
  saveDb();
}

module.exports = {
  initDatabase,
  getAllProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  addStockMovement,
  getMovements,
  getStockSummary,
  createOrder,
  getOrders,
  updateOrderStatus,
  getUserByUsername,
  updateUserPassword,
  getDb
};