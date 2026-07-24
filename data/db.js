const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'ingapet.db');

let SQL;
let db;

function getDb() {
  if (db) return db;
  throw new Error('Database not initialized.');
}

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

async function initDatabase() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL, role TEXT DEFAULT "admin", created_at TEXT DEFAULT (datetime("now", "localtime")))');
  db.run('CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price TEXT NOT NULL, price_delivery TEXT, description TEXT, image TEXT, active INTEGER DEFAULT 1, featured INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS stock (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0, min_quantity INTEGER NOT NULL DEFAULT 5, updated_at TEXT)');
  
  const hash = bcrypt.hashSync('ingapet2024', 10);
  const existing = db.exec("SELECT id FROM users WHERE username = 'admin'");
  
  if (existing.length > 0) {
    db.run("UPDATE users SET password = ? WHERE username = 'admin'", [hash]);
  } else {
    db.run('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
      ['admin', hash, 'Administrador', 'admin']);
  }

  const countRes = db.exec('SELECT COUNT(*) FROM products');
  if (countRes[0].values[0][0] === 0) {
     db.run("INSERT INTO products (id, name, category, price) VALUES ('test-1', 'Produto Teste', 'Geral', '0.00')");
     db.run("INSERT INTO stock (product_id, quantity) VALUES ('test-1', 10)");
  }

  saveDb();
}

function getUserByUsername(username) {
  const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
  stmt.bind([username]);
  let user = null;
  if (stmt.step()) user = stmt.getAsObject();
  stmt.free();
  return user;
}

function getAllProducts() {
  const stmt = db.prepare("SELECT p.*, s.quantity FROM products p LEFT JOIN stock s ON p.id = s.product_id WHERE p.active = 1");
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function getProduct(id) {
  const stmt = db.prepare("SELECT p.*, s.quantity, s.min_quantity FROM products p LEFT JOIN stock s ON p.id = s.product_id WHERE p.id = ?");
  stmt.bind([id]);
  let result = null;
  if (stmt.step()) result = stmt.getAsObject();
  stmt.free();
  return result;
}

function createProduct(data) {
  const id = data.id || `prod-${Date.now()}`;
  db.run("INSERT INTO products (id, name, category, price, description, image, featured) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, data.name, data.category, data.price, data.description || '', data.image || null, data.featured ? 1 : 0]);
  db.run("INSERT INTO stock (product_id, quantity, min_quantity) VALUES (?, ?, ?)",
    [id, parseInt(data.initial_stock) || 0, parseInt(data.min_quantity) || 5]);
  saveDb();
  return id;
}

function updateProduct(id, data) {
  db.run("UPDATE products SET name = ?, category = ?, price = ?, description = ?, image = ?, featured = ? WHERE id = ?",
    [data.name, data.category, data.price, data.description, data.image, data.featured ? 1 : 0, id]);
  if (data.quantity !== undefined) {
    db.run("UPDATE stock SET quantity = ?, min_quantity = ? WHERE product_id = ?", [data.quantity, data.min_quantity, id]);
  }
  saveDb();
}

function deleteProduct(id) {
  db.run("UPDATE products SET active = 0 WHERE id = ?", [id]);
  saveDb();
}

function addStockMovement(productId, type, quantity, reason, notes, reference) {
  const current = getProduct(productId);
  const curQty = current ? current.quantity : 0;
  const newQty = type === 'in' ? curQty + quantity : Math.max(0, curQty - quantity);
  db.run("UPDATE stock SET quantity = ? WHERE product_id = ?", [newQty, productId]);
  saveDb();
  return newQty;
}

function getStockSummary() {
  const total = db.exec("SELECT COUNT(*) FROM products WHERE active = 1")[0].values[0][0];
  const items = db.exec("SELECT SUM(quantity) FROM stock")[0].values[0][0] || 0;
  return { summary: { total_products: total, total_items: items }, lowStockItems: [], recentMovements: [] };
}

module.exports = {
  initDatabase, getUserByUsername, getAllProducts, getProduct, createProduct, updateProduct, deleteProduct, addStockMovement, getStockSummary, getDb
};