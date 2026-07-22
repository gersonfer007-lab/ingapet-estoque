// Servidor principal do sistema de gestão IngáPet
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
    secure: false,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// ============================================
// AUTENTICACAO
// ============================================

// Middleware: verifica se esta logado
function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ success: false, error: 'Nao autorizado. Faca login.' });
  }
  res.redirect('/login');
}

// Pagina de login (servir HTML)
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: fazer login
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

// API: verificar sessao
app.get('/api/auth/check', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ success: true, loggedIn: true, user: req.session.user });
  }
  res.json({ success: true, loggedIn: false });
});

// API: logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logout realizado' });
});

// API: trocar senha
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Preencha todos os campos' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, error: 'Senha deve ter no minimo 6 caracteres' });
  }
  const user = db.getUserByUsername(req.session.user.username);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ success: false, error: 'Senha atual incorreta' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.updateUserPassword(user.id, hash);
  res.json({ success: true, message: 'Senha alterada com sucesso' });
});

// ============================================
// ROTAS PUBLICAS (sem login)
// ============================================

// Exportar dados para site publico
app.get('/api/export/site-data', (req, res) => {
  try {
    const products = db.getAllProducts();
    const siteProducts = products.map(p => ({
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

// Bot products (publico)
app.get('/api/bot/products', (req, res) => {
  try {
    const products = db.getAllProducts();
    const botProducts = products.filter(p => p.quantity > 0).map(p => ({
      id: p.id, name: p.name, category: p.category, price: p.price,
      priceDelivery: p.price_delivery || null, desc: p.description, available: p.quantity,
    }));
    res.json({ success: true, data: botProducts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bot check availability (publico)
app.post('/api/bot/check-availability', (req, res) => {
  try {
    const { items } = req.body;
    const results = [];
    for (const item of items) {
      const product = db.getProduct(item.id);
      if (product) {
        results.push({ id: item.id, name: product.name, requested: item.quantity, available: product.quantity, canFulfill: product.quantity >= item.quantity });
      }
    }
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bot process order (publico)
app.post('/api/bot/process-order', (req, res) => {
  try {
    const { phone, items, total } = req.body;
    const orderId = db.createOrder(phone, items, total);
    for (const item of items) {
      db.addStockMovement(item.id, 'out', item.quantity, 'Pedido WhatsApp', `Pedido #${orderId} - ${phone}`, `ORDER-${orderId}`);
    }
    res.json({ success: true, data: { orderId }, message: 'Pedido processado e estoque atualizado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WhatsApp Webhook (publico)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'ingapet_verify_2024';

let botResponses;
try { botResponses = require('./bot/responses'); } catch(e) {}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.value.messages) {
          for (const message of change.value.messages) {
            const phone = message.from;
            const text = message.text?.body || '';
            if (botResponses) {
              const response = botResponses.processMessage(phone, text);
              await sendWhatsAppMessage(phone, response);
            }
          }
        }
      }
    }
  }
  res.sendStatus(200);
});

async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;
  try {
    const axios = require('axios');
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      data: { messaging_product: 'whatsapp', recipient_type: 'individual', type: 'text', to, text: { body: text } },
    });
  } catch (error) {
    console.error('Erro WhatsApp:', error.response?.data || error.message);
  }
}

// ============================================
// SERVIR PAGINA PRINCIPAL (com verificacao de login no frontend)
// ============================================

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// ROTAS PROTEGIDAS (requer login)
// ============================================

// Configuração do multer para upload de imagens
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // Aumentado para 10MB para Base64

// Modified saveImage to return base64
async function saveImage(file) {
  const buffer = await sharp(file.buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

// API: PRODUTOS (protegido)
app.get('/api/products', requireAuth, (req, res) => {
  try {
    const products = db.getAllProducts();
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/products/:id', requireAuth, (req, res) => {
  try {
    const product = db.getProduct(req.params.id);
    if (!product) return res.status(404).json({ success: false, error: 'Produto nao encontrado' });
    res.json({ success: true, data: product });
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
      // Preservar imagem existente
      const product = db.getProduct(req.params.id);
      if (product) {
        data.image = product.image;
      }
    }
    
    if (data.quantity !== undefined) data.quantity = parseInt(data.quantity);
    if (data.min_quantity !== undefined) data.min_quantity = parseInt(data.min_quantity);
    db.updateProduct(req.params.id, data);
    res.json({ success: true, message: 'Produto atualizado' });
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

// API: ESTOQUE (protegido)
app.post('/api/stock/move', requireAuth, (req, res) => {
  try {
    const { product_id, type, quantity, reason, notes, reference } = req.body;
    if (!product_id || !type || !quantity) {
      return res.status(400).json({ success: false, error: 'Campos obrigatorios: product_id, type, quantity' });
    }
    const newQty = db.addStockMovement(product_id, type, parseInt(quantity), reason, notes, reference);
    res.json({ success: true, new_quantity: newQty, message: `Movimentacao registrada. Novo estoque: ${newQty}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stock/movements', requireAuth, (req, res) => {
  try {
    const { product_id, limit } = req.query;
    const movements = db.getMovements(product_id, parseInt(limit) || 50);
    res.json({ success: true, data: movements });
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

// API: PEDIDOS (protegido)
app.post('/api/orders', requireAuth, (req, res) => {
  try {
    const { phone, items, total } = req.body;
    const orderId = db.createOrder(phone, items, total);
    res.json({ success: true, data: { id: orderId }, message: 'Pedido criado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders', requireAuth, (req, res) => {
  try {
    const orders = db.getOrders(parseInt(req.query.limit) || 50);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/orders/:id/status', requireAuth, (req, res) => {
  try {
    db.updateOrderStatus(req.params.id, req.body.status);
    res.json({ success: true, message: 'Status atualizado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: UPLOAD (protegido)
app.post('/api/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });
    const base64 = await saveImage(req.file);
    res.json({ success: true, data: { url: base64 } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// INICIAR SERVIDOR
// ============================================

(async () => {
  await db.initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sistema IngaPet rodando na porta ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`Usuario padrao: admin / ingapet2024`);
  });
})();