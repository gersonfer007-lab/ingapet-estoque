/**
 * IngaPet - API + Painel de Estoque
 * Banco: MongoDB (permanente) com fallback SQLite temporario.
 * Fotos: multiplas por produto (carrossel), servidas por /api/photos/:id
 */
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./data/db');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

app.set('trust proxy', 1);

const ALLOWED_ORIGINS = [
  'https://ingapet.pages.dev',
  'https://ingagaspetshop.com.br',
  'https://www.ingagaspetshop.com.br',
  'http://ingagaspetshop.com.br',
  'http://www.ingagaspetshop.com.br'
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ingapet-secret-2024-seguro',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, error: 'Nao autorizado' });
  res.redirect('/login');
}

function fail(res, err, code) {
  console.error('[api]', err && err.message ? err.message : err);
  res.status(code || 500).json({ success: false, error: (err && err.message) || 'Erro interno' });
}

function publicBase(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return req.protocol + '://' + req.get('host');
}

/* ---------------- upload / imagens ---------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 12 }
});

const productUpload = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'photos', maxCount: 10 }
]);

async function buildPhoto(buffer) {
  const img = sharp(buffer).rotate();
  const meta = await img.metadata();
  const full = await sharp(buffer).rotate()
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true }).toBuffer();
  const thumb = await sharp(buffer).rotate()
    .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72, progressive: true, mozjpeg: true }).toBuffer();
  return { mime: 'image/jpeg', w: meta.width || null, h: meta.height || null, full, thumb };
}

function collectFiles(req) {
  const out = [];
  if (Array.isArray(req.files)) {
    out.push(...req.files);
  } else if (req.files && typeof req.files === 'object') {
    if (Array.isArray(req.files.photos)) out.push(...req.files.photos);
    if (Array.isArray(req.files.image)) out.push(...req.files.image);
  }
  if (req.file) out.push(req.file);
  const inline = req.body && req.body.image;
  if (typeof inline === 'string' && inline.startsWith('data:image')) {
    const b64 = inline.split(',')[1];
    if (b64) out.push({ buffer: Buffer.from(b64, 'base64') });
  }
  return out.filter(f => f && f.buffer && f.buffer.length);
}

async function savePhotos(productId, req) {
  const files = collectFiles(req);
  if (!files.length) return [];
  const items = [];
  for (const f of files) items.push(await buildPhoto(f.buffer));
  return db.addPhotos(productId, items);
}

/* ---------------- rotas publicas ---------------- */

app.get('/health', (req, res) => res.json({ ok: true, db: db.status() }));

app.get('/api/db-status', (req, res) => {
  const s = db.status();
  res.json({
    success: true,
    modo: s.mode,
    permanente: s.persistente,
    aviso: s.persistente ? null : 'Dados temporarios: configure MONGODB_URI no Render.'
  });
});

async function sendPhoto(req, res, variant) {
  try {
    const ph = await db.getPhoto(req.params.id, variant);
    if (!ph) return res.status(404).end();
    res.setHeader('Content-Type', ph.mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(ph.data);
  } catch (err) { fail(res, err); }
}

app.get('/api/photos/:id', (req, res) => sendPhoto(req, res, 'full'));
app.get('/api/photos/:id/thumb', (req, res) => sendPhoto(req, res, 'thumb'));

app.get('/api/export/site-data', async (req, res) => {
  try {
    const base = publicBase(req);
    const products = await db.getAllProducts();
    const siteProducts = products.map(p => {
      const gallery = (p.photos || []).map(id => base + '/api/photos/' + id);
      const thumbs = (p.photos || []).map(id => base + '/api/photos/' + id + '/thumb');
      const cover = gallery[0] || p.image_url || 'images/products/default.jpg';
      return {
        id: p.id,
        name: p.name,
        price: p.price,
        priceDelivery: p.price_delivery || null,
        category: p.category,
        desc: p.description || '',
        image: cover,
        images: gallery.length ? gallery : (p.image_url ? [p.image_url] : []),
        thumbs: thumbs,
        badge: p.featured ? 'Destaque' : null,
        stock: p.quantity,
        available: p.quantity > 0
      };
    });
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ success: true, lastUpdated: new Date().toISOString(), products: siteProducts });
  } catch (err) { fail(res, err); }
});

/* ---------------- autenticacao ---------------- */

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ success: false, error: 'Preencha todos os campos' });
    const user = await db.getUserByUsername(String(username).toLowerCase().trim());
    if (!user || !bcrypt.compareSync(String(password), user.password)) {
      return res.status(401).json({ success: false, error: 'Usuario ou senha incorretos' });
    }
    req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
    res.json({ success: true, user: { name: user.name, username: user.username, role: user.role } });
  } catch (err) { fail(res, err); }
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.user) return res.json({ success: true, loggedIn: true, user: req.session.user });
  res.json({ success: true, loggedIn: false });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true, message: 'Logout realizado' }));
});

/* ---------------- produtos ---------------- */

app.get('/api/products', requireAuth, async (req, res) => {
  try {
    const base = publicBase(req);
    const list = await db.getAllProducts(req.query.all === '1');
    res.json({
      success: true,
      data: list.map(p => ({
        ...p,
        image: (p.photos && p.photos[0]) ? base + '/api/photos/' + p.photos[0] + '/thumb' : (p.image_url || null),
        gallery: (p.photos || []).map(id => ({
          id: id,
          thumb: base + '/api/photos/' + id + '/thumb',
          full: base + '/api/photos/' + id
        }))
      }))
    });
  } catch (err) { fail(res, err); }
});

app.post('/api/products', requireAuth, productUpload, async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1' || data.featured === true;
    const id = await db.createProduct(data);
    const photos = await savePhotos(id, req);
    res.json({ success: true, data: { id, photos }, message: 'Produto criado' });
  } catch (err) { fail(res, err); }
});

app.put('/api/products/:id', requireAuth, productUpload, async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.featured !== undefined) {
      data.featured = data.featured === 'true' || data.featured === '1' || data.featured === true;
    }
    if (data.initial_stock !== undefined && data.quantity === undefined) data.quantity = data.initial_stock;
    delete data.image;
    await db.updateProduct(req.params.id, data);
    const photos = await savePhotos(req.params.id, req);
    res.json({ success: true, data: { photos }, message: 'Produto atualizado' });
  } catch (err) { fail(res, err); }
});

app.delete('/api/products/:id', requireAuth, async (req, res) => {
  try {
    if (req.query.hard === '1') await db.destroyProduct(req.params.id);
    else await db.deleteProduct(req.params.id);
    res.json({ success: true, message: 'Produto removido' });
  } catch (err) { fail(res, err); }
});

/* ---------------- fotos do produto (carrossel) ---------------- */

app.get('/api/products/:id/photos', requireAuth, async (req, res) => {
  try {
    const base = publicBase(req);
    const ids = await db.listPhotos(req.params.id);
    res.json({
      success: true,
      data: ids.map(id => ({ id: id, thumb: base + '/api/photos/' + id + '/thumb', full: base + '/api/photos/' + id }))
    });
  } catch (err) { fail(res, err); }
});

app.post('/api/products/:id/photos', requireAuth, upload.array('photos', 10), async (req, res) => {
  try {
    const prod = await db.getProduct(req.params.id);
    if (!prod) return res.status(404).json({ success: false, error: 'Produto nao encontrado' });
    const ids = await savePhotos(req.params.id, req);
    if (!ids.length) return res.status(400).json({ success: false, error: 'Nenhuma imagem recebida' });
    res.json({ success: true, data: { photos: ids }, message: ids.length + ' foto(s) adicionada(s)' });
  } catch (err) { fail(res, err); }
});

app.delete('/api/products/:id/photos/:photoId', requireAuth, async (req, res) => {
  try {
    await db.deletePhoto(req.params.id, req.params.photoId);
    res.json({ success: true, message: 'Foto removida' });
  } catch (err) { fail(res, err); }
});

app.put('/api/products/:id/photos/order', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.photos) ? req.body.photos.map(String) : [];
    const keep = await db.setPhotoOrder(req.params.id, ids);
    res.json({ success: true, data: { photos: keep }, message: 'Ordem salva' });
  } catch (err) { fail(res, err); }
});

/* ---------------- estoque ---------------- */

app.post('/api/stock/move', requireAuth, async (req, res) => {
  try {
    const { product_id, type, quantity, reason, notes, reference } = req.body || {};
    const newQty = await db.addStockMovement(product_id, type, parseInt(quantity, 10), reason, notes, reference);
    res.json({ success: true, new_quantity: newQty, message: 'Novo estoque: ' + newQty });
  } catch (err) { fail(res, err); }
});

app.get('/api/stock/movements', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    res.json({ success: true, data: await db.getMovements(req.query.product_id, limit) });
  } catch (err) { fail(res, err); }
});

app.get('/api/stock/summary', requireAuth, async (req, res) => {
  try { res.json({ success: true, data: await db.getStockSummary() }); } catch (err) { fail(res, err); }
});

/* ---------------- erros / estaticos ---------------- */

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: 'Imagem muito grande. Maximo 12MB por foto.' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ success: false, error: 'Maximo de 10 fotos por envio.' });
    if (err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ success: false, error: 'Campo de arquivo inesperado: ' + err.field });
    return res.status(400).json({ success: false, error: 'Erro no upload: ' + err.message });
  }
  if (err) {
    console.error('Erro no servidor:', err);
    return res.status(500).json({ success: false, error: err.message || 'Erro interno do servidor' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  try {
    const mode = await db.initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log('IngaPet rodando na porta ' + PORT + ' | banco: ' + mode);
    });
  } catch (err) {
    console.error('Falha ao iniciar:', err);
    process.exit(1);
  }
})();