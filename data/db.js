const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'ingapet.db');
let SQL, db;

function saveDb() {
  const data = db.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDatabase() {
  SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price TEXT NOT NULL,
    price_delivery TEXT, description TEXT, image TEXT, active INTEGER DEFAULT 1,
    featured INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0, min_quantity INTEGER NOT NULL DEFAULT 5,
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('in', 'out', 'adjust')),
    quantity INTEGER NOT NULL, reason TEXT, notes TEXT, reference TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, name TEXT NOT NULL, role TEXT DEFAULT 'admin'
  )`);

  const hash = bcrypt.hashSync('ingapet2024', 10);
  const userExists = db.exec("SELECT id FROM users WHERE username = 'admin'").length > 0;
  if (!userExists) {
    db.run("INSERT INTO users (username, password, name, role) VALUES ('admin', ?, 'Administrador', 'admin')", [hash]);
  } else {
    db.run("UPDATE users SET password = ? WHERE username = 'admin'", [hash]);
  }
  
  if (db.exec("SELECT id FROM products").length === 0) {
    const p = { id: 'gas-13', name: 'Botijão de Gás 13kg', cat: 'gas', price: 'R$ 99,99' };
    db.run("INSERT INTO products (id, name, category, price) VALUES (?, ?, ?, ?)", [p.id, p.name, p.cat, p.price]);
    db.run("INSERT INTO stock (product_id, quantity) VALUES (?, 10)", [p.id]);
  }
  saveDb();
}

function getUserByUsername(username) {
  const res = db.exec("SELECT * FROM users WHERE username = ?", [username]);
  if (res.length === 0) return null;
  const cols = res[0].columns;
  const vals = res[0].values[0];
  return cols.reduce((o, c, i) => ({ ...o, [c]: vals[i] }), {});
}

function getAllProducts() {
  const res = db.exec("SELECT p.*, s.quantity, s.min_quantity FROM products p LEFT JOIN stock s ON p.id = s.product_id WHERE p.active = 1 ORDER BY p.name");
  if (res.length === 0) return [];
  const cols = res[0].columns;
  return res[0].values.map(v => cols.reduce((o, c, i) => ({ ...o, [c]: v[i] }), {}));
}

function getProduct(id) {
  const res = db.exec("SELECT p.*, s.quantity, s.min_quantity FROM products p LEFT JOIN stock s ON p.id = s.product_id WHERE p.id = ?", [id]);
  if (res.length === 0) return null;
  const cols = res[0].columns;
  return cols.reduce((o, c, i) => ({ ...o, [c]: res[0].values[0][i] }), {});
}

function createProduct(d) {
  const id = d.id || `p-${Date.now()}`;
  db.run("INSERT INTO products (id, name, category, price, description, image, featured) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, d.name, d.category, d.price, d.description || '', d.image || null, d.featured ? 1 : 0]);
  db.run("INSERT INTO stock (product_id, quantity, min_quantity) VALUES (?, ?, ?)",
    [id, parseInt(d.initial_stock) || 0, parseInt(d.min_quantity) || 5]);
  saveDb();
  return id;
}

function updateProduct(id, d) {
  db.run("UPDATE products SET name=?, category=?, price=?, description=?, image=?, featured=?, updated_at=datetime('now','localtime') WHERE id=?",
    [d.name, d.category, d.price, d.description, d.image, d.featured?1:0, id]);
  if (d.quantity !== undefined) {
    db.run("UPDATE stock SET quantity=?, min_quantity=?, updated_at=datetime('now','localtime') WHERE product_id=?", [d.quantity, d.min_quantity, id]);
  }
  saveDb();
}

function deleteProduct(id) { db.run("UPDATE products SET active = 0 WHERE id = ?", [id]); saveDb(); }

function addStockMovement(pId, type, q, reason, notes, ref) {
  const prod = getProduct(pId);
  const cur = prod ? prod.quantity : 0;
  const n = type === 'in' ? cur + q : Math.max(0, cur - q);
  db.run("INSERT INTO movements (product_id, type, quantity, reason, notes, reference) VALUES (?,?,?,?,?,?)", [pId, type, q, reason||'', notes||'', ref||'']);
  db.run("UPDATE stock SET quantity = ?, updated_at = datetime('now','localtime') WHERE product_id = ?", [n, pId]);
  saveDb();
  return n;
}

function getMovements(pId, limit) {
  const sql = pId ? "SELECT m.*, p.name as product_name FROM movements m JOIN products p ON m.product_id = p.id WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT ?" 
                  : "SELECT m.*, p.name as product_name FROM movements m JOIN products p ON m.product_id = p.id ORDER BY m.created_at DESC LIMIT ?";
  const res = db.exec(sql, pId ? [pId, limit] : [limit]);
  if (res.length === 0) return [];
  const cols = res[0].columns;
  return res[0].values.map(v => cols.reduce((o, c, i) => ({ ...o, [c]: v[i] }), {}));
}

function getStockSummary() {
  const totalRes = db.exec("SELECT COUNT(*) FROM products WHERE active = 1");
  const itemsRes = db.exec("SELECT SUM(quantity) FROM stock WHERE product_id IN (SELECT id FROM products WHERE active = 1)");
  const lowRes = db.exec("SELECT COUNT(*) FROM products p JOIN stock s ON p.id = s.product_id WHERE p.active = 1 AND s.quantity <= s.min_quantity");
  const catsRes = db.exec("SELECT COUNT(DISTINCT category) FROM products WHERE active = 1");
  
  const lowItemsRes = db.exec("SELECT p.id, p.name, s.quantity, s.min_quantity FROM products p JOIN stock s ON p.id = s.product_id WHERE p.active = 1 AND s.quantity <= s.min_quantity LIMIT 10");
  const lowItems = lowItemsRes.length ? lowItemsRes[0].values.map(v => ({ id: v[0], name: v[1], quantity: v[2], min_quantity: v[3] })) : [];
  const movs = getMovements(null, 10);

  return {
    summary: {
      total_products: totalRes[0].values[0][0],
      total_items: itemsRes[0].values[0][0] || 0,
      low_stock: lowRes[0].values[0][0],
      categories: catsRes[0].values[0][0]
    },
    lowStockItems: lowItems,
    recentMovements: movs
  };
}

module.exports = { initDatabase, getUserByUsername, getAllProducts, getProduct, createProduct, updateProduct, deleteProduct, addStockMovement, getMovements, getStockSummary };