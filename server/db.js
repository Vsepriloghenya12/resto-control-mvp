import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const ROLES = ['owner', 'manager', 'waiter', 'bartender', 'cook'];
export const DEPARTMENTS = ['hall', 'bar', 'kitchen', 'common'];

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export function hashPassword(password) {
  return crypto.createHash('sha256').update(`resto:${password}`).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 14));
  return d.toISOString();
}

function emptyDb() {
  return {
    meta: { version: 1, created_at: nowIso() },
    restaurants: [],
    users: [],
    checklist_templates: [],
    checklist_items: [],
    checklist_runs: [],
    checklist_answers: [],
    products: [],
    product_requests: [],
    request_items: [],
    inventory_templates: [],
    inventory_template_items: [],
    inventory_runs: [],
    inventory_values: [],
    tasks: [],
    task_assignments: [],
    knowledge_categories: [],
    knowledge_documents: [],
    knowledge_acknowledgements: [],
    knowledge_views: []
  };
}

export function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const db = emptyDb();
    seed(db);
    saveDb(db);
    return db;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

export function saveDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function resetDb() {
  const db = emptyDb();
  seed(db);
  saveDb(db);
  return db;
}

export function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

export function canUseRestaurant(restaurant) {
  if (!restaurant) return false;
  if (restaurant.subscription_status === 'active') return true;
  if (restaurant.subscription_status === 'trial') return new Date(restaurant.trial_ends_at).getTime() >= Date.now();
  return false;
}

export function restaurantStatus(restaurant) {
  if (!restaurant) return 'missing';
  if (restaurant.subscription_status === 'trial' && !canUseRestaurant(restaurant)) return 'trial_expired';
  return restaurant.subscription_status;
}

export function roleToDepartment(role) {
  if (role === 'bartender') return 'bar';
  if (role === 'cook') return 'kitchen';
  if (role === 'waiter') return 'hall';
  return 'common';
}

function createRestaurant(db, overrides = {}) {
  const restaurant = {
    id: overrides.id || uid('rest'),
    name: overrides.name || 'Демо ресторан',
    city: overrides.city || 'Москва',
    owner_name: overrides.owner_name || 'Владелец',
    phone: overrides.phone || '+79999999999',
    email: overrides.email || 'owner@example.com',
    status: 'active',
    plan: overrides.plan || 'trial',
    subscription_status: overrides.subscription_status || 'trial',
    trial_started_at: nowIso(),
    trial_ends_at: overrides.trial_ends_at || addDays(process.env.TRIAL_DAYS || 14),
    subscription_started_at: null,
    subscription_ends_at: null,
    created_at: nowIso()
  };
  db.restaurants.push(restaurant);
  return restaurant;
}

function createUser(db, restaurant_id, data) {
  const user = {
    id: data.id || uid('user'),
    restaurant_id: restaurant_id || null,
    name: data.name,
    login: data.login,
    password_hash: hashPassword(data.password),
    role: data.role,
    department: data.department || roleToDepartment(data.role),
    active: data.active ?? true,
    is_super_admin: !!data.is_super_admin,
    created_at: nowIso()
  };
  db.users.push(user);
  return user;
}

function addChecklist(db, restaurant_id, role, type, title, items) {
  const template = { id: uid('cltpl'), restaurant_id, role, type, title, active: true, created_at: nowIso() };
  db.checklist_templates.push(template);
  items.forEach((text, index) => db.checklist_items.push({
    id: uid('cli'), restaurant_id, template_id: template.id, text, required: true, needs_comment: false, needs_photo: false, sort_order: index + 1
  }));
  return template;
}

function addProducts(db, restaurant_id, department, list) {
  list.forEach(([name, unit, category]) => db.products.push({
    id: uid('prod'), restaurant_id, department, name, unit, category, active: true, created_at: nowIso()
  }));
}

function addInventoryTemplate(db, restaurant_id, department, title) {
  const template = { id: uid('invtpl'), restaurant_id, department, title, active: true, created_at: nowIso() };
  db.inventory_templates.push(template);
  db.products.filter(p => p.restaurant_id === restaurant_id && p.department === department).forEach((p, idx) => {
    db.inventory_template_items.push({ id: uid('invitem'), restaurant_id, template_id: template.id, product_id: p.id, sort_order: idx + 1 });
  });
  return template;
}

function addKnowledge(db, restaurant_id, title, allowed_roles, docs) {
  const cat = { id: uid('kcat'), restaurant_id, title, allowed_roles, sort_order: db.knowledge_categories.length + 1 };
  db.knowledge_categories.push(cat);
  docs.forEach((doc, idx) => db.knowledge_documents.push({
    id: uid('kdoc'), restaurant_id, category_id: cat.id, title: doc.title, type: doc.type || 'text', content: doc.content,
    file_url: '', allowed_roles: doc.allowed_roles || allowed_roles, requires_acknowledgement: doc.requires_acknowledgement ?? true,
    version: 1, is_active: true, created_by: null, created_at: nowIso(), updated_at: nowIso(), sort_order: idx + 1
  }));
}

export function createRestaurantWithDefaults(db, data) {
  const restaurant = createRestaurant(db, data);
  const demoPrefix = data.loginPrefix ?? ((data.login || 'owner') === 'owner' ? '' : `${data.login}_`);
  createUser(db, restaurant.id, { name: data.owner_name || 'Владелец ресторана', login: data.login || 'owner', password: data.password || 'owner123', role: 'owner' });
  createUser(db, restaurant.id, { name: 'Официант демо', login: `${demoPrefix}waiter`, password: 'waiter123', role: 'waiter' });
  createUser(db, restaurant.id, { name: 'Бармен демо', login: `${demoPrefix}bar`, password: 'bar123', role: 'bartender' });
  createUser(db, restaurant.id, { name: 'Повар демо', login: `${demoPrefix}cook`, password: 'cook123', role: 'cook' });

  addChecklist(db, restaurant.id, 'waiter', 'open', 'Открытие смены официанта', [
    'Проверить чистоту столов и посадочных мест', 'Проверить наличие меню', 'Проверить салфетки и приборы', 'Проверить терминал оплаты', 'Сообщить управляющему о готовности зала'
  ]);
  addChecklist(db, restaurant.id, 'waiter', 'close', 'Закрытие смены официанта', [
    'Протереть столы', 'Сдать терминал и отчёт', 'Проверить забытые вещи гостей', 'Закрыть кассовую зону', 'Передать смену управляющему'
  ]);
  addChecklist(db, restaurant.id, 'bartender', 'open', 'Открытие бара', [
    'Проверить лёд', 'Проверить заготовки', 'Проверить чистоту станции', 'Проверить стоп-лист бара', 'Подготовить гарниши'
  ]);
  addChecklist(db, restaurant.id, 'bartender', 'close', 'Закрытие бара', [
    'Списать остатки заготовок', 'Помыть барный инвентарь', 'Убрать станцию', 'Заполнить заявку бара', 'Закрыть холодильники'
  ]);
  addChecklist(db, restaurant.id, 'cook', 'open', 'Открытие кухни', [
    'Проверить холодильники', 'Проверить заготовки', 'Проверить чистоту рабочих зон', 'Проверить стоп-лист кухни', 'Подготовить станцию'
  ]);
  addChecklist(db, restaurant.id, 'cook', 'close', 'Закрытие кухни', [
    'Убрать рабочие зоны', 'Промаркировать заготовки', 'Заполнить заявку кухни', 'Проверить холодильники', 'Передать смену'
  ]);

  addProducts(db, restaurant.id, 'bar', [
    ['Aperol', 'бут.', 'Алкоголь'], ['Джин', 'бут.', 'Алкоголь'], ['Ром', 'бут.', 'Алкоголь'], ['Сироп клубника', 'шт.', 'Сиропы'], ['Лёд', 'пакет', 'Расходники'], ['Трубочки', 'уп.', 'Расходники']
  ]);
  addProducts(db, restaurant.id, 'kitchen', [
    ['Курица', 'кг', 'Мясо'], ['Картофель', 'кг', 'Овощи'], ['Сливки', 'л', 'Молочка'], ['Сыр', 'кг', 'Молочка'], ['Зелень', 'кг', 'Овощи'], ['Упаковка', 'шт.', 'Расходники']
  ]);
  addProducts(db, restaurant.id, 'hall', [
    ['Салфетки', 'уп.', 'Расходники'], ['Меню', 'шт.', 'Сервис'], ['Чековая лента', 'шт.', 'Расходники']
  ]);

  addInventoryTemplate(db, restaurant.id, 'bar', 'Инвентаризация бара');
  addInventoryTemplate(db, restaurant.id, 'kitchen', 'Инвентаризация кухни');
  addInventoryTemplate(db, restaurant.id, 'hall', 'Инвентаризация зала');

  addKnowledge(db, restaurant.id, 'Сервис-бук', ['waiter', 'manager', 'owner'], [
    { title: 'Стандарт приветствия гостя', content: 'Гость должен получить приветствие в течение 30 секунд. Улыбка, зрительный контакт, предложение помочь с посадкой.' },
    { title: 'Работа с жалобой', content: 'Выслушать гостя, не спорить, извиниться, позвать управляющего, зафиксировать ситуацию.' }
  ]);
  addKnowledge(db, restaurant.id, 'ТТК бара', ['bartender', 'manager', 'owner'], [
    { title: 'Aperol Spritz', content: 'Выход: 250 мл\nСостав: Aperol 60 мл, Prosecco 90 мл, Soda 30 мл, апельсин 1 слайс.\nТехнология: бокал со льдом, налить ингредиенты, аккуратно перемешать, украсить.' }
  ]);
  addKnowledge(db, restaurant.id, 'ТТК кухни', ['cook', 'manager', 'owner'], [
    { title: 'Цезарь с курицей', content: 'Выход: 280 г\nАллергены: яйцо, молочные продукты, глютен.\nТехнология: подготовить салат, курицу, соус, выложить по стандарту подачи.' }
  ]);

  const task = { id: uid('task'), restaurant_id: restaurant.id, title: 'Проверить актуальность стоп-листа', description: 'Перед открытием смены проверьте стоп-лист и сообщите управляющему.', target_type: 'all', target_role: null, target_user_id: null, due_at: addDays(1), created_by: null, created_at: nowIso(), active: true };
  db.tasks.push(task);
  db.users.filter(u => u.restaurant_id === restaurant.id && !u.is_super_admin).forEach(u => {
    db.task_assignments.push({ id: uid('tasg'), restaurant_id: restaurant.id, task_id: task.id, user_id: u.id, done: false, comment: '', completed_at: null });
  });

  return restaurant;
}

export function seed(db) {
  createUser(db, null, {
    name: 'Создатель приложения',
    login: process.env.SUPER_ADMIN_LOGIN || 'admin',
    password: process.env.SUPER_ADMIN_PASSWORD || 'admin123',
    role: 'owner',
    is_super_admin: true
  });
  createRestaurantWithDefaults(db, { name: 'Демо ресторан', city: 'Москва', owner_name: 'Владелец ресторана', email: 'owner@example.com', login: 'owner', password: 'owner123' });
}

export { uid, nowIso, addDays };
