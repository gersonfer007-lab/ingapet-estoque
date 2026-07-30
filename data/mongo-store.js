/**
 * IngaPet - Armazenamento em MongoDB (persistente, nao apaga em deploy)
 * Colecoes: products, photos, movements, users
 */
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const { SEED_PRODUCTS } = require('./seed');

const DB_NAME = process.env.MONGODB_DB || 'ingapet';

let client = null;
let mdb = null;
const col = {};

function newId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function bufOf(v) {
  if (!v) return null;
  if (Buffer.isBuffer(v)) return v;
  if (v.buffer) return Buffer.from(v.buffer);
  if (v.value && typeof v.value === 'function') return Buffer.from(v.value());
  return null;
}

function toProduct(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    name: doc.name || '',
    category: doc.category || 'Geral',
    price: doc.price || '',
    price_delivery: doc.price_delivery || null,
    description: doc.description || '',
    image_url: doc.image_url || null,
    photos: Array.isArray(doc.photos) ? doc.photos : [],
    active: doc.active === false ? 0 : 1,
    featured: doc.featured ? 1 : 0,
    quantity: Number.isFinite(doc.quantity) ? doc.quantity : 0,
    min_quantity: Number.isFinite(doc.min_quantity) ? doc.min_quantity : 5,
    created_at: doc.created_at ? new Date(doc.created_at).toISOString() : null,
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null
  };
}

async function initDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI nao definida');

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    maxPoolSize: 5,
    retryWrites: true
  });
  await client.connect();
  mdb = client.db(DB_NAME);

  col.products = mdb.collection('products');
  col.photos = mdb.collection('photos');
  col.movements = mdb.collection('movements');
  col.users = mdb.collection('users');

  await col.products.createIndex({ active: 1, name: 1 });
  await col.photos.createIndex({ product_id: 1 });
  await col.movements.createIndex({ created_at: -1 });
  await col.movements.createIndex({ product_id: 1, created_at: -1 });
  await col.users.createIndex({ username: 1 }, { unique: true });

  await ensureAdmin();
  await seedIfEmpty();

  console.log('[db] MongoDB conectado -> banco "' + DB_NAME + '" (dados permanentes)');
}

async function ensureAdmin() {
  const envPass = process.env.ADMIN_PASSWORD;
  const existing = await col.users.findOne({ username: 'admin' });
  if (!existing) {
    await col.users.insertOne({
      _id: 'admin',
      username: 'admin',
      password: bcrypt.hashSync(envPass || 'ingapet2024', 10),
      name: 'Administrador',
      role: 'admin',
      created_at: new Date()
    });
    console.log('[db] usuario admin criado');
  } else if (envPass) {
    await col.users.updateOne({ username: 'admin' }, { $set: { password: bcrypt.hashSync(envPass, 10) } });
  }
}

async function seedIfEmpty() {
  const n = await col.products.countDocuments({});
  if (n > 0) return;
  const now = new Date();
  await col.products.insertMany(SEED_PRODUCTS.map(s => ({
    _id: s.id,
    name: s.name,
    category: s.category,
    price: s.price,
    price_delivery: null,
    description: '',
    image_url: s.image_url,
    photos: [],
    active: true,
    featured: s.featured,
    quantity: s.quantity,
    min_quantity: s.min_quantity,
    created_at: now,
    updated_at: now
  })));
  console.log('[db] catalogo inicial criado com ' + SEED_PRODUCTS.length + ' produtos');
}

/* ---------------- usuarios ---------------- */

async function getUserByUsername(username) {
  const u = await col.users.findOne({ username: username });
  if (!u) return null;
  return { id: u._id, username: u.username, password: u.password, name: u.name, role: u.role };
}

/* ---------------- produtos ---------------- */

async function getAllProducts(includeInactive) {
  const q = includeInactive ? {} : { active: { $ne: false } };
  const docs = await col.products.find(q).sort({ name: 1 }).toArray();
  return docs.map(toProduct);
}

async function getProduct(id) {
  return toProduct(await col.products.findOne({ _id: id }));
}

async function createProduct(d) {
  const id = d.id || newId('p');
  const now = new Date();
  await col.products.insertOne({
    _id: id,
    name: (d.name || '').trim(),
    category: (d.category || 'Geral').trim(),
    price: (d.price || '').trim(),
    price_delivery: d.price_delivery || null,
    description: d.description || '',
    image_url: d.image_url || null,
    photos: [],
    active: true,
    featured: !!d.featured,
    quantity: parseInt(d.quantity != null && d.quantity !== '' ? d.quantity : d.initial_stock, 10) || 0,
    min_quantity: parseInt(d.min_quantity, 10) || 5,
    created_at: now,
    updated_at: now
  });
  return id;
}

async function updateProduct(id, d) {
  const set = { updated_at: new Date() };
  if (d.name !== undefined) set.name = String(d.name).trim();
  if (d.category !== undefined) set.category = String(d.category).trim() || 'Geral';
  if (d.price !== undefined) set.price = String(d.price).trim();
  if (d.price_delivery !== undefined) set.price_delivery = d.price_delivery || null;
  if (d.description !== undefined) set.description = d.description || '';
  if (d.image_url !== undefined) set.image_url = d.image_url || null;
  if (d.featured !== undefined) set.featured = !!d.featured;
  if (d.quantity !== undefined && d.quantity !== null && d.quantity !== '') {
    const q = parseInt(d.quantity, 10);
    if (Number.isFinite(q)) set.quantity = Math.max(0, q);
  }
  if (d.min_quantity !== undefined && d.min_quantity !== null && d.min_quantity !== '') {
    const m = parseInt(d.min_quantity, 10);
    if (Number.isFinite(m)) set.min_quantity = Math.max(0, m);
  }
  await col.products.updateOne({ _id: id }, { $set: set });
}

async function deleteProduct(id) {
  await col.products.updateOne({ _id: id }, { $set: { active: false, updated_at: new Date() } });
}

async function destroyProduct(id) {
  await col.photos.deleteMany({ product_id: id });
  await col.movements.deleteMany({ product_id: id });
  await col.products.deleteOne({ _id: id });
}

/* ---------------- fotos (carrossel) ---------------- */

async function addPhotos(productId, items) {
  if (!items || !items.length) return [];
  const now = new Date();
  const docs = items.map(it => ({
    _id: newId('ph'),
    product_id: productId,
    mime: it.mime || 'image/jpeg',
    w: it.w || null,
    h: it.h || null,
    size: it.full ? it.full.length : 0,
    full: it.full,
    thumb: it.thumb,
    created_at: now
  }));
  await col.photos.insertMany(docs);
  const ids = docs.map(d => d._id);
  await col.products.updateOne(
    { _id: productId },
    { $push: { photos: { $each: ids } }, $set: { updated_at: now } }
  );
  return ids;
}

async function getPhoto(photoId, variant) {
  const field = variant === 'thumb' ? 'thumb' : 'full';
  const doc = await col.photos.findOne({ _id: photoId }, { projection: { mime: 1, [field]: 1 } });
  if (!doc) return null;
  const data = bufOf(doc[field]);
  if (!data) return null;
  return { mime: doc.mime || 'image/jpeg', data: data };
}

async function listPhotos(productId) {
  const p = await col.products.findOne({ _id: productId }, { projection: { photos: 1 } });
  return (p && Array.isArray(p.photos)) ? p.photos : [];
}

async function deletePhoto(productId, photoId) {
  await col.photos.deleteOne({ _id: photoId, product_id: productId });
  await col.products.updateOne(
    { _id: productId },
    { $pull: { photos: photoId }, $set: { updated_at: new Date() } }
  );
}

async function setPhotoOrder(productId, ids) {
  const owned = await col.photos.find({ product_id: productId }, { projection: { _id: 1 } }).toArray();
  const ownedIds = owned.map(o => o._id);
  const keep = ids.filter(i => ownedIds.includes(i));
  const remove = ownedIds.filter(i => !keep.includes(i));
  if (remove.length) await col.photos.deleteMany({ _id: { $in: remove } });
  await col.products.updateOne({ _id: productId }, { $set: { photos: keep, updated_at: new Date() } });
  return keep;
}

/* ---------------- estoque ---------------- */

async function addStockMovement(productId, type, quantity, reason, notes, reference) {
  const p = await col.products.findOne({ _id: productId }, { projection: { quantity: 1 } });
  if (!p) throw new Error('Produto nao encontrado');
  const cur = Number.isFinite(p.quantity) ? p.quantity : 0;
  const q = Math.abs(parseInt(quantity, 10) || 0);
  let next;
  if (type === 'in') next = cur + q;
  else if (type === 'out') next = Math.max(0, cur - q);
  else next = q;

  await col.movements.insertOne({
    product_id: productId,
    type: type,
    quantity: q,
    reason: reason || '',
    notes: notes || '',
    reference: reference || '',
    balance: next,
    created_at: new Date()
  });
  await col.products.updateOne({ _id: productId }, { $set: { quantity: next, updated_at: new Date() } });
  return next;
}

async function getMovements(productId, limit) {
  const q = productId ? { product_id: productId } : {};
  const rows = await col.movements.find(q).sort({ created_at: -1 }).limit(parseInt(limit, 10) || 50).toArray();
  const ids = [...new Set(rows.map(r => r.product_id))];
  const prods = ids.length
    ? await col.products.find({ _id: { $in: ids } }, { projection: { name: 1 } }).toArray()
    : [];
  const nameById = {};
  prods.forEach(p => { nameById[p._id] = p.name; });
  return rows.map(r => ({
    id: String(r._id),
    product_id: r.product_id,
    product_name: nameById[r.product_id] || r.product_id,
    type: r.type,
    quantity: r.quantity,
    reason: r.reason,
    notes: r.notes,
    reference: r.reference,
    balance: r.balance,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : null
  }));
}

async function getStockSummary() {
  const active = { active: { $ne: false } };
  const total_products = await col.products.countDocuments(active);
  const agg = await col.products.aggregate([
    { $match: active },
    { $group: { _id: null, items: { $sum: { $ifNull: ['$quantity', 0] } } } }
  ]).toArray();
  const cats = await col.products.distinct('category', active);
  const lowDocs = await col.products.find({
    ...active,
    $expr: { $lte: [{ $ifNull: ['$quantity', 0] }, { $ifNull: ['$min_quantity', 5] }] }
  }).project({ name: 1, quantity: 1, min_quantity: 1 }).limit(20).toArray();

  return {
    summary: {
      total_products: total_products,
      total_items: agg.length ? agg[0].items : 0,
      low_stock: lowDocs.length,
      categories: cats.length
    },
    lowStockItems: lowDocs.map(d => ({
      id: d._id, name: d.name,
      quantity: Number.isFinite(d.quantity) ? d.quantity : 0,
      min_quantity: Number.isFinite(d.min_quantity) ? d.min_quantity : 5
    })),
    recentMovements: await getMovements(null, 10)
  };
}

async function close() {
  if (client) await client.close();
}

module.exports = {
  kind: 'mongodb',
  initDatabase, close,
  getUserByUsername,
  getAllProducts, getProduct, createProduct, updateProduct, deleteProduct, destroyProduct,
  addPhotos, getPhoto, listPhotos, deletePhoto, setPhotoOrder,
  addStockMovement, getMovements, getStockSummary
};