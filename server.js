// Servidor principal do sistema de gestão IngáPet
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./data/db');
const cors = require('cors');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

// Configuração de CORS
const allowedOrigins = [
  'https://ingapet.pages.dev',
  'https://ingagaspetshop.com.br',
  'https://www.ingagaspetshop.com.br',
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    // permitir requests sem origin (como apps mobile ou curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true
}));

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Sessao
app.use(session({
  secret: process.env.SESSION_SECRET || 'ingapet-secret-2024-seguro',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// ============================================
// AUTENTICACAO
// ============================================

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Nao autorizado. Faca login.' });
  }
  res.redirect('/login');
}

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Usuario e senha obrigatorios' });
  }
  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ success: false, error: 'Usuario ou senha incorretos' });
  }
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ success: true, user: { name: user.name, username: user.username, role: user.role } });
});

app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ success: true, loggedIn: true, user: req.session.user });
  }
  res.json({ success: true, loggedIn: false });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logout realizado' });
});

// ============================================
// ROTAS PUBLICAS
// ============================================

// Exportar dados para site publico (CORS habilitado acima)
app.get('/api/export/site-data', (req, res) => {
  try {
    const products = db.getAllProducts();
    const siteProducts = products.map(p => ({
      id: p.id,
      name: p.name,
      price: p.price,
      category: p.category,
      image: p.image || `images/products/default.jpg`,
      desc: p.description,
      badge: p.featured ? 'Destaque' : null,
      priceDelivery: p.price_delivery || null,
      stock: p.quantity,
      available: p.quantity > 0,
    }));
    res.json({ success: true, lastUpdated: new Date().toISOString(), products: siteProducts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ROTAS PROTEGIDAS
// ============================================

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

async function saveImage(file) {
  const buffer = await sharp(file.buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

app.get('/api/products', requireAuth, (req, res) => {
  try {
    const products = db.getAllProducts();
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/products', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1';
    if (req.file) {
      data.image = await saveImage(req.file);
    }
    const id = db.createProduct(data);
    res.json({ success: true, data: { id }, message: 'Produto criado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
    res.json({ success: true, message: 'Produto atualizado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/products/:id', requireAuth, (req, res) => {
  try {
    db.deleteProduct(req.params.id);
    res.json({ success: true, message: 'Produto removido' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/stock/move', requireAuth, (req, res) => {
  try {
    const { product_id, type, quantity, reason, notes, reference } = req.body;
    const newQty = db.addStockMovement(product_id, type, parseInt(quantity), reason, notes, reference);
    res.json({ success: true, new_quantity: newQty, message: `Movimentacao registrada. Novo estoque: ${newQty}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stock/summary', requireAuth, (req, res) => {
  try {
    const summary = db.getStockSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

(async () => {
  await db.initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sistema IngaPet rodando na porta ${PORT}`);
  });
})();
