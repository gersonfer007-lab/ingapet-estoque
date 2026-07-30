/**
 * Fachada de banco de dados do IngaPet.
 *
 * - Se MONGODB_URI estiver configurada, usa MongoDB (dados permanentes).
 * - Se nao estiver (ou a conexao falhar), cai para SQLite local em modo
 *   temporario para o site nao sair do ar. Nesse modo os dados sao perdidos
 *   a cada deploy do Render.
 *
 * Toda a API e assincrona (retorna Promise).
 */
let store = null;
let mode = 'nao-iniciado';
let lastError = null;

async function initDatabase() {
  if (process.env.MONGODB_URI) {
    try {
      const mongo = require('./mongo-store');
      await mongo.initDatabase();
      store = mongo;
      mode = 'mongodb';
      return mode;
    } catch (err) {
      lastError = err.message;
      console.error('[db] falha ao conectar no MongoDB:', err.message);
      console.error('[db] iniciando em modo temporario (SQLite local)');
    }
  } else {
    console.warn('[db] MONGODB_URI nao configurada -> modo temporario');
  }

  const sqlite = require('./sqlite-store');
  await sqlite.initDatabase();
  store = sqlite;
  mode = 'sqlite-temporario';
  return mode;
}

function status() {
  return {
    mode: mode,
    persistente: mode === 'mongodb',
    erro: lastError
  };
}

const proxy = {
  initDatabase,
  status
};

const methods = [
  'close', 'getUserByUsername',
  'getAllProducts', 'getProduct', 'createProduct', 'updateProduct', 'deleteProduct', 'destroyProduct',
  'addPhotos', 'getPhoto', 'listPhotos', 'deletePhoto', 'setPhotoOrder',
  'addStockMovement', 'getMovements', 'getStockSummary'
];

methods.forEach(name => {
  proxy[name] = function (...args) {
    if (!store) return Promise.reject(new Error('Banco de dados ainda nao iniciado'));
    return store[name](...args);
  };
});

module.exports = proxy;