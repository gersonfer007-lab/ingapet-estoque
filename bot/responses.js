// Lógica do chatbot integrada com o sistema de estoque
// Lê produtos diretamente do banco de dados

const db = require('../data/db');

// Estado das conversas (em memória)
const sessions = new Map();

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { state: 'idle', history: [] });
  }
  return sessions.get(phone);
}

function processMessage(phone, text) {
  const session = getSession(phone);
  const msg = text.trim().toLowerCase();

  session.history.push({ role: 'user', text, time: new Date().toISOString() });

  let response = '';

  if (isGreeting(msg)) {
    response = getWelcomeMessage();
  }
  else if (msg === '1' || msg.includes('produto')) {
    response = getCategoriesMenu();
    session.state = 'browsing_category';
  }
  else if (msg === '2' || msg.includes('promo')) {
    response = getPromotionsMessage();
  }
  else if (msg === '3' || msg.includes('pedido') || msg.includes('comprar')) {
    response = getOrderMessage();
  }
  else if (msg === '4' || msg.includes('delivery') || msg.includes('entrega')) {
    response = getDeliveryMessage();
  }
  else if (msg === '5' || msg.includes('loja') || msg.includes('endereco') || msg.includes('endereço') || msg.includes('onde')) {
    response = getStoresMessage();
  }
  else if (msg === '6' || msg.includes('pix') || msg.includes('pagamento') || msg.includes('pagar')) {
    response = getPixMessage();
  }
  else if (msg === '7' || msg.includes('atendente') || msg.includes('humano') || msg.includes('pessoa') || msg.includes('ajuda')) {
    response = getHumanAgentMessage();
  }
  else if (msg === '8' || msg.includes('horario') || msg.includes('horário') || msg.includes('aberto') || msg.includes('funcionamento')) {
    response = getHoursMessage();
  }
  else if (msg === '0' || msg === 'menu' || msg === 'voltar' || msg === 'inicio' || msg === 'início') {
    response = getMainMenu();
    session.state = 'idle';
  }
  else if (session.state === 'browsing_category' && isCategorySelection(msg)) {
    response = handleCategoryBrowse(msg);
  }
  else if (msg.includes('gás') || msg.includes('gas') || msg.includes('botijão') || msg.includes('carvão') || msg.includes('carvao')) {
    response = handleCategoryBrowse('gas');
  }
  else if (msg.includes('água') || msg.includes('agua') || msg.includes('garrafão') || msg.includes('garrafao')) {
    response = handleCategoryBrowse('agua');
  }
  else if (msg.includes('ração') || msg.includes('racao') || msg.includes('pet') || msg.includes('cachorro') || msg.includes('gato') || msg.includes('cão') || msg.includes('cao') || msg.includes('dog')) {
    response = handleCategoryBrowse('pets');
  }
  else if (msg.includes('jardim') || msg.includes('casa') || msg.includes('vaso') || msg.includes('semente') || msg.includes('ferramenta')) {
    response = handleCategoryBrowse('casa');
  }
  else if (msg.includes('preço') || msg.includes('preco') || msg.includes('quanto custa') || msg.includes('valor')) {
    response = handlePriceQuery(msg);
  }
  else {
    // Busca genérica
    const results = searchProducts(msg);
    if (results.length > 0) {
      response = formatProductSearch(msg, results);
    } else {
      response = getDefaultResponse(msg);
    }
  }

  session.history.push({ role: 'bot', text: response, time: new Date().toISOString() });
  return response;
}

function isGreeting(msg) {
  const greetings = ['oi', 'olá', 'ola', 'oii', 'e aí', 'e ai', 'opa', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'hello', 'hi', 'salve', 'fala', 'tudo bem', 'tudo bom'];
  return greetings.some(g => msg.includes(g));
}

function isCategorySelection(msg) {
  return ['1', '2', '3', '4', 'gas', 'gás', 'agua', 'água', 'pets', 'casa', 'jardim'].includes(msg);
}

function searchProducts(query) {
  const allProducts = db.getAllProducts();
  const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return allProducts.filter(p =>
    p.quantity > 0 && (
      p.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) ||
      (p.description || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q) ||
      p.category.includes(q)
    )
  );
}

function getProductsByCategory(cat) {
  return db.getAllProducts().filter(p => p.category === cat && p.quantity > 0);
}

function getWelcomeMessage() {
  return `Olá! 👋 Bem-vindo(a) à *IngáPet*! 🐾

Sou o assistente virtual e posso te ajudar com:

1️⃣ Ver produtos e preços
2️⃣ Promoções do dia
3️ Fazer um pedido
4️⃣ Informações de delivery
5️⃣ Nossas lojas e horários
6️⃣ PIX para pagamento
7️⃣ Falar com atendente
8️⃣ Horário de funcionamento

Digite o número da opção desejada ou me pergunte diretamente (ex: "preço do gás", "ração para cachorro")! 🐕🐈`;
}

function getMainMenu() {
  return `📋 *Menu Principal - IngáPet*

1️⃣ Ver produtos e preços
2️⃣ Promoções do dia
3️⃣ Fazer um pedido
4️⃣ Informações de delivery
5️⃣ Nossas lojas e horários
6️⃣ PIX para pagamento
7️ Falar com atendente
8️⃣ Horário de funcionamento

Digite o número da opção:`;
}

function getCategoriesMenu() {
  return `🛍️ *Categorias de Produtos*

🔥 1 - Gás e Carvão
💧 2 - Água Mineral
 3 - Produtos para Pets
 4 - Casa e Jardim

Digite o número ou nome da categoria:

_Ou digite o nome do produto que procura (ex: "ração 15kg", "botijão de gás")_`;
}

function getPromotionsMessage() {
  const allProducts = db.getAllProducts();
  const promos = allProducts.filter(p => p.featured && p.quantity > 0).slice(0, 6);

  let msg = `🔥 *PROMOÇÕES EM DESTAQUE*\n\n`;

  if (promos.length === 0) {
    msg += `Confira nossos melhores produtos:\n\n`;
    // Mostrar produtos disponíveis aleatórios
    const available = allProducts.filter(p => p.quantity > 0).slice(0, 6);
    available.forEach((p, i) => {
      msg += `${i + 1}️⃣ *${p.name}*\n`;
      msg += `   💰 ${p.price}\n`;
      msg += `   📦 Estoque: ${p.quantity} un.\n\n`;
    });
  } else {
    promos.forEach((p, i) => {
      msg += `${i + 1}️⃣ *${p.name}*\n`;
      msg += `   💰 ${p.price}\n`;
      msg += `   📦 Estoque: ${p.quantity} un.\n\n`;
    });
  }

  msg += ` Quer fazer um pedido? Digite *3*\n`;
  msg += `📋 Ver outros produtos? Digite *1*\n`;
  msg += `📞 Falar com atendente? Digite *7*`;
  return msg;
}

function getOrderMessage() {
  return `🛒 *Fazer um Pedido*

Para agilizar seu atendimento, envie:

1️⃣ Seu *nome*
2️⃣ *Endereço* de entrega (bairro e rua)
3️⃣ *Produtos* desejados

Exemplo:
_Maria, Rua das Flores 123 - Centro, 1 botijão de gás + 1 garrafão de água_

📞 Ou fale diretamente com nosso atendente:
_(44) 99881-0928_ (Maringá)
_(44) 99107-1668_ (Sarandi)

_Digite *0* para voltar ao menu_`;
}

function getDeliveryMessage() {
  return ` *Informações de Delivery*

✅ Entregamos em toda *Maringá e Sarandi*

📍 *Taxa de entrega:*
• Botijão de Gás 13kg: R$ 25,00
• Demais produtos: consulte

⏰ *Horário de entregas:*
• Segunda a Sábado: 8h às 20h
• Domingo: 8h às 12h

 💡 *Dica:* Peça pelo WhatsApp para atendimento mais rápido!

📞 *Contatos:*
• Maringá: (44) 99881-0928
• Sarandi: (44) 99107-1668

_Digite *3* para fazer um pedido_`;
}

function getStoresMessage() {
  return ` *Nossas Lojas*

🏪 *IngáPet Maringá*
📌 Av. Tuiuti, 1700 - Jardim Califórnia
📞 (44) 99881-0928
🕐 Seg-Sáb: 8h às 20h | Dom: 8h às 12h

🏪 *IngáPet Sarandi*
📌 Rua Paraná, 285 - Centro
📞 (44) 99107-1668
🕐 Seg-Sáb: 8h às 20h | Dom: 8h às 12h

 📲 *WhatsApp:*
• Maringá: wa.me/5544998810928
• Sarandi: wa.me/5544991071668

_Digite *0* para voltar ao menu_`;
}

function getPixMessage() {
  return `💳 *Pagamento via PIX*

*Banco do Brasil*
🏦 Agência: 4053-5
💰 Conta: 138860-0
📋 Tipo: Poupança

📱 *Como pagar:*
1. Abra o app do seu banco
2. Escolha pagar via PIX
3. Escaneie o QR Code ou digite a chave
4. Envie o comprovante pelo WhatsApp

⚠️ Envie o comprovante após o pagamento para confirmar seu pedido!

_Digite *3* para fazer um pedido_`;
}

function getHumanAgentMessage() {
  return `👤 *Falar com Atendente*

Nossos atendentes estão disponíveis para te ajudar!

📞 *Contatos:*
• *Maringá:* (44) 99881-0928
• *Sarandi:* (44) 99107-1668

🕐 *Horário de atendimento:*
• Segunda a Sábado: 8h às 20h
• Domingo: 8h às 12h

 Clique para abrir o WhatsApp:
• Maringá: wa.me/5544998810928
• Sarandi: wa.me/5544991071668

_Digite *0* para voltar ao menu_`;
}

function getHoursMessage() {
  return ` *Horário de Funcionamento*

 *Segunda a Sábado:* 8h às 20h
📅 *Domingo:* 8h às 12h
📅 *Feriados:* Consulte

🏪 *Duas lojas:*
• Maringá - Av. Tuiuti, 1700
• Sarandi - Rua Paraná, 285

_Digite *0* para voltar ao menu_`;
}

function handleCategoryBrowse(category) {
  const catMap = { '1': 'gas', '2': 'agua', '3': 'pets', '4': 'casa' };
  const cat = catMap[category] || category;
  const catInfo = { gas: { name: 'Gás e Carvão', emoji: '🔥' }, agua: { name: 'Água Mineral', emoji: '💧' }, pets: { name: 'Produtos para Pets', emoji: '' }, casa: { name: 'Casa e Jardim', emoji: '' } };
  const info = catInfo[cat];
  if (!info) return 'Categoria não encontrada. Digite 1-4 para ver as categorias.';

  const prods = getProductsByCategory(cat);

  if (prods.length === 0) {
    return `${info.emoji} *${info.name}*\n\nNenhum produto disponível no momento. Tente outra categoria ou digite *0* para voltar ao menu.`;
  }

  let msg = `${info.emoji} *${info.name}*\n\n`;
  msg += `Produtos disponíveis:\n\n`;

  prods.slice(0, 8).forEach(p => {
    msg += `• *${p.name}*\n`;
    msg += `  💰 ${p.price}`;
    if (p.price_delivery) msg += ` | Entrega: ${p.price_delivery}`;
    msg += `\n  📦 ${p.quantity} em estoque\n\n`;
  });

  if (prods.length > 8) {
    msg += `_...e mais ${prods.length - 8} produtos_\n\n`;
  }

  msg += `🛒 Quer pedir algum? Digite *3*\n`;
  msg += `🔍 Buscar outro produto? Digite o nome!\n`;
  msg += `📋 *0* para voltar ao menu`;
  return msg;
}

function handlePriceQuery(query) {
  const cleanQuery = query.replace(/preço|preco|quanto custa|valor/gi, '').trim();
  const results = cleanQuery ? searchProducts(cleanQuery) : db.getAllProducts().filter(p => p.quantity > 0);

  if (results.length === 0) {
    return `🔍 Não encontrei esse produto. Tente digitar o nome (ex: "gás", "ração special dog") ou digite *1* para ver o catálogo.`;
  }

  let msg = `💰 *Preços encontrados:*\n\n`;
  results.slice(0, 5).forEach(p => {
    msg += `• *${p.name}*\n`;
    msg += `  💰 ${p.price}`;
    if (p.price_delivery) msg += ` | Entrega: ${p.price_delivery}`;
    msg += `\n  📦 ${p.quantity} em estoque\n\n`;
  });

  msg += `🛒 Quer pedir? Digite *3*`;
  return msg;
}

function formatProductSearch(query, results) {
  let msg = `🔍 *Resultados para "${query}"*\n\n`;
  msg += `Encontrei *${results.length}* produto(s):\n\n`;

  results.slice(0, 6).forEach(p => {
    msg += `• *${p.name}*\n`;
    msg += `  💰 ${p.price}\n`;
    msg += `  📦 ${p.quantity} em estoque\n`;
    if (p.description) msg += `  📝 ${p.description}\n`;
    msg += `\n`;
  });

  if (results.length > 6) {
    msg += `_...e mais ${results.length - 6} produto(s)_\n\n`;
  }

  msg += `🛒 Quer pedir? Digite *3*\n`;
  msg += `📋 *0* para voltar ao menu`;
  return msg;
}

function getDefaultResponse(msg) {
  return `🤔 Não entendi sua mensagem.

Posso te ajudar com:
• Ver produtos e preços (digite *1*)
• Promoções do dia (digite *2*)
• Fazer um pedido (digite *3*)
• Informações de delivery (digite *4*)
• Nossas lojas (digite *5*)
• PIX (digite *6*)
• Falar com atendente (digite *7*)
• Horário de funcionamento (digite *8*)

Ou pergunte diretamente (ex: "preço do gás", "ração para cachorro")! 🐾`;
}

module.exports = { processMessage, getSession, sessions };
