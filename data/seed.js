/**
 * Catalogo inicial - usado somente quando o banco esta vazio.
 * As imagens apontam para os arquivos que ja existem no site.
 */
const IMG = 'https://ingagaspetshop.com.br/images/products/';

const SEED_PRODUCTS = [
  { id: 'agua-20l',           name: 'Garrafão de Água 20L',      category: 'Água Mineral',       price: 'R$ 18,00',            img: 'agua-mineral-20l.jpg',       featured: true  },
  { id: 'special-dog-15kg',   name: 'Special Dog Premium 15kg',  category: 'Produtos para Pets', price: 'R$ 109,90',           img: 'special-dog-15kg-carne.jpg', featured: true  },
  { id: 'gas-13',             name: 'Botijão de Gás 13kg',       category: 'Gás e Carvão',       price: 'R$ 99,99',            img: 'botijao-gas.jpg',            featured: true  },
  { id: 'vasos-cachepots',    name: 'Vasos e Cachepots',         category: 'Casa e Jardim',      price: 'R$ 9,90',             img: 'vasos-ceramica.jpg',         featured: false },
  { id: 'ferramentas-jardim', name: 'Ferramentas de Jardim',     category: 'Casa e Jardim',      price: 'R$ 12,90',            img: 'ferramentas-jardim-new.jpg', featured: false },
  { id: 'agua-garoto-500',    name: 'Água Garoto Fardo 500ml',   category: 'Água Mineral',       price: 'R$ 11,99',            img: 'agua-gratis.jpg',            featured: true  },
  { id: 'vitta-natural-15kg', name: 'Vitta Natural 15kg Adulto', category: 'Produtos para Pets', price: 'R$ 138,90',           img: 'vitta-natural-15kg.jpg',     featured: true  },
  { id: 'carvao-4kg',         name: 'Carvão Vegetal 4kg',        category: 'Gás e Carvão',       price: 'R$ 19,99',            img: 'carvao-4kg.jpg',             featured: true  },
  { id: 'carvao-7kg',         name: 'Carvão Vegetal 7kg',        category: 'Gás e Carvão',       price: 'R$ 34,99',            img: 'carvao-7kg.png',             featured: false },
  { id: 'sementes-feltrin',   name: 'Sementes Feltrin',          category: 'Casa e Jardim',      price: 'A partir de R$ 4,90', img: 'sementes-feltrin.jpg',       featured: true  }
].map(p => ({ ...p, image_url: IMG + p.img, quantity: 10, min_quantity: 5 }));

module.exports = { SEED_PRODUCTS };