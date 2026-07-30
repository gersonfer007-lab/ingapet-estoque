/**
 * IngaPet - Armazenamento local em SQLite (sql.js)
 * ATENCAO: usado apenas como MODO DE EMERGENCIA quando MONGODB_URI nao esta
 * configurada. No Render este arquivo e apagado em cada deploy/restart.
 * Mesma interface do mongo-store.js.
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { SEED_PRODUCTS } = require('./seed');

const DB_PATH = path.join(__dirname, 'ingapet.db');
let SQL, db;

function saveDb() {
  const data = db.export();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function rows(sql, params) {
  const res = db.exec(sql, params);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(v => cols.reduce((o, c, i) => { o[c] = v[i]; return o; }, {}));
}

function one(sql, params) {
  const r = rows(sql, params);
  return r.length ? r[0] : null;
}

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function toProduct(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name || '',
    category: r.category || 'Geral',
    price: r.price || '',
    price_delivery: r.price_delivery || null,
    description: r.description || '',
    image_url: r.image_url || null,
    photos: r.photo_ids ? String(r.photo_ids).split(',').filter(Boolean) : [],
    active: r.active ? 1 : 0,
    featured: r.featured ? 1 : 0,
    quantity: r.quantity == null ? 0 : Number(r.quantity),
    min_quantity: r.min_quantity == null ? 5 : Number(r.min_quantity),
    created_at: r.created_at || null,
    updated_at: r.updated_at || null
  };
}

async function initDatabase() {
  SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price TEXT NOT NULL,
    price_delivery TEXT, description TEXT, image_url TEXT, photo_ids TEXT DEFAULT '',
    quantity INTEGER DEFAULT 0, min_quantity INTEGER DEFAULT 5,
    active INTEGER DEFAULT 1, featured INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY, product_id TEXT NOT NULL, mime TEXT, w INTEGER, h INTEGER,
    full TEXT, thumb TEXT, created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, type TEXT NOT NULL,
    quantity INTEGER NOT NULL, reason TEXT, notes TEXT, reference TEXT, balance INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    name TEXT NOT NULL, role TEXT DEFAULT 'admin'
  )`);

  const pass = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ingapet2024', 10);
  if (!one("SELECT id FROM users WHERE username = 'admin'")) {
    db.run("INSERT INTO users (id, username, password, name, role) VALUES ('admin','admin',?,'Administrador','admin')", [pass]);
  } else if (process.env.ADMIN_PASSWORD) {
    db.run("UPDATE users SET password = ? WHERE username = 'admin'", [pass]);
  }

  const count = one("SELECT COUNT(*) c FROM products");
  if (!count || !count.c) {
    SEED_PRODUCTS.forEach(s => {
      db.run(`INSERT INTO products (id,name,category,price,description,image_url,photo_ids,quantity,min_quantity,active,featured)
              VALUES (?,?,?,?,'',?,'',?,?,1,?)`,
        [s.id, s.name, s.category, s.price, s.image_url, s.quantity, s.min_quantity, s.featured ? 1 : 0]);
    });
    console.log('[db] catalogo inicial criado com ' + SEED_PRODUCTS.length + ' produtos');
  }

  saveDb();
  console.log('[db] MODO TEMPORARIO: SQLite local. Configure MONGODB_URI para nao perder dados.');
}

async function getUserByUsername(username) {
  return one("SELECT * FROM users WHERE username = ?", [username]);
}

async function getAllProducts(includeInactive) {
  const sql = includeInactive
    ? "SELECT * FROM products ORDER BY name"
    : "SELECT * FROM products WHERE active = 1 ORDER BY name";
  return rows(sql).map(toProduct);
}

async function getProduct(id) {
  return toProduct(one("SELECT * FROM products WHERE id = ?", [id]));
}

async function createProduct(d) {
  const id = d.id || newId('p');
  db.run(`INSERT INTO products (id,name,category,price,price_delivery,description,image_url,photo_ids,quantity,min_quantity,active,featured)
          VALUES (?,?,?,?,?,?,?,'',?,?,1,?)`,
    [id, (d.name || '').trim(), (d.category || 'Geral').trim(), (d.price || '').trim(),
     d.price_delivery || null, d.description || '', d.image_url || null,
     parseInt(d.quantity != null && d.quantity !== '' ? d.quantity : d.initial_stock, 10) || 0, parseInt(d.min_quantity, 10) || 5, d.featured ? 1 : 0]);
  saveDb();
  return id;
}

async function updateProduct(id, d) {
  const cur = one("SELECT * FROM products WHERE id = ?", [id]);
  if (!cur) return;
  const v = (k, def) => (d[k] === undefined || d[k] === null || d[k] === '' ? def : d[k]);
  db.run(`UPDATE products SET name=?, category=?, price=?, price_delivery=?, description=?, image_url=?,
          quantity=?, min_quantity=?, featured=?, updated_at=datetime('now','localtime') WHERE id=?`,
    [String(v('name', cur.name)).trim(), String(v('category', cur.category)).trim(),
     String(v('price', cur.price)).trim(), d.price_delivery === undefined ? cur.price_delivery : (d.price_delivery || null),
     d.description === undefined ? cur.description : (d.description || ''),
     d.image_url === undefined ? cur.image_url : (d.image_url || null),
     parseInt(v('quantity', cur.quantity), 10) || 0, parseInt(v('min_quantity', cur.min_quantity), 10) || 5,
     d.featured === undefined ? cur.featured : (d.featured ? 1 : 0), id]);
  saveDb();
}

async function deleteProduct(id) {
  db.run("UPDATE products SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?", [id]);
  saveDb();
}

async function destroyProduct(id) {
  db.run("DELETE FROM photos WHERE product_id = ?", [id]);
  db.run("DELETE FROM movements WHERE product_id = ?", [id]);
  db.run("DELETE FROM products WHERE id = ?", [id]);
  saveDb();
}

async function addPhotos(productId, items) {
  if (!items || !items.length) return [];
  const ids = [];
  for (const it of items) {
    const id = newId('ph');
    ids.push(id);
    db.run("INSERT INTO photos (id,product_id,mime,w,h,full,thumb) VALUES (?,?,?,?,?,?,?)",
      [id, productId, it.mime || 'image/jpeg', it.w || null, it.h || null,
       it.full.toString('base64'), it.thumb.toString('base64')]);
  }
  const cur = await listPhotos(productId);
  db.run("UPDATE products SET photo_ids = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    [cur.concat(ids).join(','), productId]);
  saveDb();
  return ids;
}

async function getPhoto(photoId, variant) {
  const r = one("SELECT mime, full, thumb FROM photos WHERE id = ?", [photoId]);
  if (!r) return null;
  const b64 = variant === 'thumb' ? (r.thumb || r.full) : r.full;
  if (!b64) return null;
  return { mime: r.mime || 'image/jpeg', data: Buffer.from(b64, 'base64') };
}

async function listPhotos(productId) {
  const r = one("SELECT photo_ids FROM products WHERE id = ?", [productId]);
  return r && r.photo_ids ? String(r.photo_ids).split(',').filter(Boolean) : [];
}

async function deletePhoto(productId, photoId) {
  db.run("DELETE FROM photos WHERE id = ? AND product_id = ?", [photoId, productId]);
  const keep = (await listPhotos(productId)).filter(i => i !== photoId);
  db.run("UPDATE products SET photo_ids = ?, updated_at = datetime('now','localtime') WHERE id = ?", [keep.join(','), productId]);
  saveDb();
}

async function setPhotoOrder(productId, ids) {
  const owned = rows("SELECT id FROM photos WHERE product_id = ?", [productId]).map(r => r.id);
  const keep = ids.filter(i => owned.includes(i));
  const remove = owned.filter(i => !keep.includes(i));
  remove.forEach(i => db.run("DELETE FROM photos WHERE id = ?", [i]));
  db.run("UPDATE products SET photo_ids = ?, updated_at = datetime('now','localtime') WHERE id = ?", [keep.join(','), productId]);
  saveDb();
  return keep;
}

async function addStockMovement(productId, type, quantity, reason, notes, reference) {
  const p = one("SELECT quantity FROM products WHERE id = ?", [productId]);
  if (!p) throw new Error('Produto nao encontrado');
  const cur = Number(p.quantity) || 0;
  const q = Math.abs(parseInt(quantity, 10) || 0);
  const next = type === 'in' ? cur + q : (type === 'out' ? Math.max(0, cur - q) : q);
  db.run("INSERT INTO movements (product_id,type,quantity,reason,notes,reference,balance) VALUES (?,?,?,?,?,?,?)",
    [productId, type, q, reason || '', notes || '', reference || '', next]);
  db.run("UPDATE products SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?", [next, productId]);
  saveDb();
  return next;
}

async function getMovements(productId, limit) {
  const lim = parseInt(limit, 10) || 50;
  const sql = productId
    ? "SELECT m.*, p.name as product_name FROM movements m LEFT JOIN products p ON m.product_id = p.id WHERE m.product_id = ? ORDER BY m.id DESC LIMIT ?"
    : "SELECT m.*, p.name as product_name FROM movements m LEFT JOIN products p ON m.product_id = p.id ORDER BY m.id DESC LIMIT ?";
  return rows(sql, productId ? [productId, lim] : [lim]);
}

async function getStockSummary() {
  const t = one("SELECT COUNT(*) c FROM products WHERE active = 1");
  const i = one("SELECT SUM(quantity) s FROM products WHERE active = 1");
  const c = one("SELECT COUNT(DISTINCT category) c FROM products WHERE active = 1");
  const low = rows("SELECT id, name, quantity, min_quantity FROM products WHERE active = 1 AND quantity <= min_quantity LIMIT 20");
  return {
    summary: {
      total_products: t ? t.c : 0,
      total_items: (i && i.s) || 0,
      low_stock: low.length,
      categories: c ? c.c : 0
    },
    lowStockItems: low,
    recentMovements: await getMovements(null, 10)
  };
}

async function close() {}

module.exports = {
  kind: 'sqlite-temporario',
  initDatabase, close,
  getUserByUsername,
  getAllProducts, getProduct, createProduct, updateProduct, deleteProduct, destroyProduct,
  addPhotos, getPhoto, listPhotos, deletePhoto, setPhotoOrder,
  addStockMovement, getMovements, getStockSummary
};