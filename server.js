const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./data/db');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

// IMPORTANTE: Necessario para funcionar atras do proxy do Render
app.set('trust proxy', 1);

// CORS manual
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://ingapet.pages.dev',
    'https://ingagaspetshop.com.br',
    'https://www.ingagaspetshop.com.br'
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'ingapet-secret-2024-seguro',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ success: false, error: 'Não autorizado' });
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, error: 'Preencha todos os campos' });
  const user = db.getUserByUsername(username.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ success: false, error: 'Usuário ou senha incorretos' });
  }
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ success: true, user: { name: user.name, username: user.username, role: user.role } });
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.user) return res.json({ success: true, loggedIn: true, user: req.session.user });
  res.json({ success: true, loggedIn: false });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logout realizado' });
});

app.get('/api/export/site-data', (req, res) => {
  try {
    const products = db.getAllProducts();
    const siteProducts = products.map(p => ({
      id: p.id, name: p.name, price: p.price, category: p.category,
      image: p.image || `images/products/default.jpg`, desc: p.description,
      badge: p.featured ? 'Destaque' : null, priceDelivery: p.price_delivery || null,
      stock: p.quantity, available: p.quantity > 0,
    }));
    res.json({ success: true, lastUpdated: new Date().toISOString(), products: siteProducts });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

async function saveImage(file) {
  const buffer = await sharp(file.buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

app.get('/api/products', requireAuth, (req, res) => {
  try { res.json({ success: true, data: db.getAllProducts() }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/products', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1';
    if (req.file) data.image = await saveImage(req.file);
    const id = db.createProduct(data);
    res.json({ success: true, data: { id }, message: 'Produto criado' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.put('/api/products/:id', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1';
    if (req.file) {
      data.image = await saveImage(req.file);
    } else {
      const product = db.getProduct(req.params.id);
      if (product) data.image = product.image;
    }
    if (data.initial_stock !== undefined) data.quantity = parseInt(data.initial_stock);
    if (data.min_quantity !== undefined) data.min_quantity = parseInt(data.min_quantity);
    db.updateProduct(req.params.id, data);
    res.json({ success: true, message: 'Produto atualizado' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  try {
    db.deleteProduct(req.params.id);
    res.json({ success: true, message: 'Produto removido' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/stock/move', requireAuth, (req, res) => {
  try {
    const { product_id, type, quantity, reason, notes, reference } = req.body;
    const newQty = db.addStockMovement(product_id, type, parseInt(quantity), reason, notes, reference);
    res.json({ success: true, new_quantity: newQty, message: `Novo estoque: ${newQty}` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/stock/movements', requireAuth, (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const movements = db.getMovements(req.query.product_id, limit);
    res.json({ success: true, data: movements });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/stock/summary', requireAuth, (req, res) => {
  try { res.json({ success: true, data: db.getStockSummary() }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// Tratamento de erros do Multer e erros gerais
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, error: 'Imagem muito grande. Maximo: 10MB' });
    }
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
  await db.initDatabase();
  app.listen(PORT, '0.0.0.0', () => console.log(`IngaPet rodando na porta ${PORT}`));
})();