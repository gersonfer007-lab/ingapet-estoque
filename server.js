// Servidor principal do sistema de gestão IngáPet
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const db = require('./data/db');

const app = express();
const PORT = parseInt(process.env.PORT) || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuração do multer para upload de imagens
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// ============================================
// API: PRODUTOS
// ============================================

app.get('/api/products', (req, res) => {
  try {
    const products = db.getAllProducts();
    res.json({ success: true, data: products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/products/:id', (req, res) => {
  try {
    const product = db.getProduct(req.params.id);
    if (!product) return res.status(404).json({ success: false, error: 'Produto não encontrado' });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/products', upload.single('image'), async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1';

    if (req.file) {
      const filename = await saveImage(req.file, data.category);
      data.image = `/uploads/${filename}`;
    }

    const id = db.createProduct(data);
    res.json({ success: true, data: { id }, message: 'Produto criado com sucesso' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/products/:id', upload.single('image'), async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1';

    if (req.file) {
      const filename = await saveImage(req.file, data.category);
      data.image = `/uploads/${filename}`;
    }

    if (data.quantity !== undefined) {
      data.quantity = parseInt(data.quantity);
    }
    if (data.min_quantity !== undefined) {
      data.min_quantity = parseInt(data.min_quantity);
    }

    db.updateProduct(req.params.id, data);
    res.json({ success: true, message: 'Produto atualizado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/products/:id', (req, res) => {
  try {
    db.deleteProduct(req.params.id);
    res.json({ success: true, message: 'Produto removido' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// API: ESTOQUE / MOVIMENTAÇÕES
// ============================================

app.post('/api/stock/move', (req, res) => {
  try {
    const { product_id, type, quantity, reason, notes, reference } = req.body;

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ success: false, error: 'Campos obrigatórios: product_id, type, quantity' });
    }

    const newQty = db.addStockMovement(product_id, type, parseInt(quantity), reason, notes, reference);
    res.json({ success: true, new_quantity: newQty, message: `Movimentação registrada. Novo estoque: ${newQty}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stock/movements', (req, res) => {
  try {
    const { product_id, limit } = req.query;
    const movements = db.getMovements(product_id, parseInt(limit) || 50);
    res.json({ success: true, data: movements });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stock/summary', (req, res) => {
  try {
    const summary = db.getStockSummary();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// API: PEDIDOS
// ============================================

app.post('/api/orders', (req, res) => {
  try {
    const { phone, items, total } = req.body;
    const orderId = db.createOrder(phone, items, total);
    res.json({ success: true, data: { id: orderId }, message: 'Pedido criado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders', (req, res) => {
  try {
    const orders = db.getOrders(parseInt(req.query.limit) || 50);
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/orders/:id/status', (req, res) => {
  try {
    db.updateOrderStatus(req.params.id, req.body.status);
    res.json({ success: true, message: 'Status atualizado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// API: EXPORTAR PARA SITE
// ============================================

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

    res.json({
      success: true,
      lastUpdated: new Date().toISOString(),
      products: siteProducts,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// API: CHATBOT INTEGRATION
// ============================================

app.get('/api/bot/products', (req, res) => {
  try {
    const products = db.getAllProducts();
    const botProducts = products.filter(p => p.quantity > 0).map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      price: p.price,
      priceDelivery: p.price_delivery || null,
      desc: p.description,
      available: p.quantity,
    }));
    res.json({ success: true, data: botProducts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Verificar disponibilidade para pedido do WhatsApp
app.post('/api/bot/check-availability', (req, res) => {
  try {
    const { items } = req.body;
    const results = [];

    for (const item of items) {
      const product = db.getProduct(item.id);
      if (product) {
        results.push({
          id: item.id,
          name: product.name,
          requested: item.quantity,
          available: product.quantity,
          canFulfill: product.quantity >= item.quantity,
        });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Registrar pedido do chatbot e dar baixa no estoque
app.post('/api/bot/process-order', (req, res) => {
  try {
    const { phone, items, total } = req.body;
    const orderId = db.createOrder(phone, items, total);

    // Dar baixa no estoque
    for (const item of items) {
      db.addStockMovement(item.id, 'out', item.quantity, 'Pedido WhatsApp', `Pedido #${orderId} - ${phone}`, `ORDER-${orderId}`);
    }

    res.json({ success: true, data: { orderId }, message: 'Pedido processado e estoque atualizado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// WHATSAPP WEBHOOK (INTEGRADO COM ESTOQUE)
// ============================================

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN || 'ingapet_verify_2024';

let botResponses;
try { botResponses = require('./bot/responses'); } catch(e) {}

// Verificação do webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recebimento de mensagens
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'whatsapp_business_account') {
    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.value.messages) {
          for (const message of change.value.messages) {
            const phone = message.from;
            const text = message.text?.body || '';
            console.log(`📩 ${phone}: ${text}`);

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
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log(`⚠️ WhatsApp não configurado. Resposta: ${text.substring(0, 80)}...`);
    return;
  }
  try {
    const response = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      data: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        type: 'text',
        to: to,
        text: { body: text },
      },
    });
    console.log(`✅ Mensagem enviada: ${response.data.messages[0].id}`);
  } catch (error) {
    console.error('❌ Erro WhatsApp:', error.response?.data || error.message);
  }
}

// ============================================
// UPLOAD DE IMAGENS
// ============================================

async function saveImage(file, category) {
  const timestamp = Date.now();
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${category || 'products'}-${timestamp}${ext}`;
  const filepath = path.join(__dirname, 'uploads', filename);

  // Redimensionar e otimizar
  await sharp(file.buffer)
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(filepath.replace(ext, '.jpg'));

  return filename.replace(ext, '.jpg');
}

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Nenhum arquivo enviado' });

    const category = req.body.category || 'products';
    const filename = await saveImage(req.file, category);

    res.json({
      success: true,
      data: {
        filename,
        url: `/uploads/${filename}`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================
// ROTA PRINCIPAL - DASHBOARD
// ============================================

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// INICIAR SERVIDOR
// ============================================

// Inicializar banco e subir servidor
(async () => {
  await db.initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sistema IngaPet rodando na porta ${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api`);
  });
})();
