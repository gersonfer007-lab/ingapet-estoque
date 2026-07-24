Ly8gU2Vydmlkb3IgcHJpbmNpcGFsIGRvIHNpc3RlbWEgZGUgZ2VzdMOjbyBJbmfDoVBldApjb25zdCBleHByZXNzID0gcmVxdWlyZSgnZXhwcmVzcycpOwpjb25zdCBtdWx0ZXIgPSByZXF1aXJlKCdtdWx0ZXInKTsKY29uc3Qgc2hhcnAgPSByZXF1aXJlKCdzaGFycCcpOwpjb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpOwpjb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7CmNvbnN0IHNlc3Npb24gPSByZXF1aXJlKCdleHByZXNzLXNlc3Npb24nKTsKY29uc3QgYmNyeXB0ID0gcmVxdWlyZSgnYmNyeXB0anMnKTsKY29uc3QgZGIgPSByZXF1aXJlKCcuL2RhdGEvZGInKTsKCmNvbnN0IGFwcCA9IGV4cHJlc3MoKTsKY29uc3QgUE9SVCA9IHBhcnNlSW50KHByb2Nlc3MuZW52LlBPUlQpIHx8IDMwMDA7CgovLyBDT1JTIG1hbnVhbAphcHAudXNlKChyZXEsIHJlcywgbmV4dCkgPT4gewogIGNvbnN0IGFsbG93ZWRPcmlnaW5zID0gWwogICAgJ2h0dHBzOi8vaW5nYXBldC5wYWdlcy5kZXYnLAogICAgJ2h0dHBzOi8vaW5nYWdhc3BldHNob3AuY29tLmJyJywKICAgICdodHRwczovL3d3dy5pbmdhZ2FzcGV0c2hvcC5jb20uYnInCiAgXTsKICBjb25zdCBvcmlnaW4gPSByZXEuaGVhZGVycy5vcmlnaW47CiAgaWYgKGFsbG93ZWRPcmlnaW5zLmluY2x1ZGVzKG9yaWdpbikpIHsKICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsIG9yaWdpbik7CiAgfSBlbHNlIHsKICAgIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJyk7CiAgfQogIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnLCAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycpOwogIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLCAnT3JpZ2luLCBYLVJlcXVlc3RlZC1XaXRoLCBDb250ZW50LVR5cGUsIEFjY2VwdCwgQXV0aG9yaXphdGlvbicpOwogIHJlcy5zZXRIZWFkZXIoJ0FjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJywgJ3RydWUnKTsKICAKICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7CiAgICByZXR1cm4gcmVzLnNlbmRTdGF0dXMoMjAwKTsKICB9CiAgbmV4dCgpOwp9KTsKCmFwcC51c2U(express.json({ limit: '10mb' }));
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
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
  try {
    res.json({ success: true, data: db.getAllProducts() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/products', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const data = { ...req.body };
    data.featured = data.featured === 'true' || data.featured === '1';
    if (req.file) data.image = await saveImage(req.file);
    const id = db.createProduct(data);
    res.json({ success: true, data: { id }, message: 'Produto criado' });
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
    res.json({ success: true, message: 'Produto atualizado' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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

app.get('/api/stock/summary', requireAuth, (req, res) => {
  try { res.json({ success: true, data: db.getStockSummary() }); } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  await db.initDatabase();
  app.listen(PORT, '0.0.0.0', () => console.log(`IngaPet rodando na porta ${PORT}`));
})();