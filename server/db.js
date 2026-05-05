import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SCHEMA_FILE = path.resolve(__dirname, '../docs/schema.sql');

const { Pool, types } = pg;

// Keep temporal values as ISO-like strings because the app compares and formats them as strings.
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);
types.setTypeParser(1700, value => Number(value));

const SNAPSHOT_TABLES = [
  { name: 'restaurants', columns: ['id', 'name', 'city', 'owner_name', 'phone', 'email', 'status', 'plan', 'subscription_status', 'trial_started_at', 'trial_ends_at', 'subscription_started_at', 'subscription_ends_at', 'created_at'] },
  { name: 'users', columns: ['id', 'restaurant_id', 'name', 'login', 'password_hash', 'access_password', 'role', 'department', 'active', 'is_super_admin', 'created_at'] },
  { name: 'checklist_templates', columns: ['id', 'restaurant_id', 'role', 'type', 'title', 'active', 'created_at'] },
  { name: 'checklist_items', columns: ['id', 'restaurant_id', 'template_id', 'text', 'required', 'needs_comment', 'needs_photo', 'sort_order'] },
  { name: 'checklist_runs', columns: ['id', 'restaurant_id', 'template_id', 'user_id', 'status', 'comment', 'created_at', 'completed_at'] },
  { name: 'checklist_answers', columns: ['id', 'restaurant_id', 'run_id', 'item_id', 'done', 'comment', 'photo_url'] },
  { name: 'products', columns: ['id', 'restaurant_id', 'department', 'name', 'unit', 'category', 'supplier', 'active', 'created_at'] },
  { name: 'product_requests', columns: ['id', 'restaurant_id', 'department', 'created_by', 'target_role', 'target_user_id', 'status', 'comment', 'created_at', 'updated_at'] },
  { name: 'request_items', columns: ['id', 'restaurant_id', 'request_id', 'product_id', 'qty_ordered', 'qty_received', 'status', 'comment'] },
  { name: 'inventory_templates', columns: ['id', 'restaurant_id', 'department', 'title', 'active', 'created_at'] },
  { name: 'inventory_template_items', columns: ['id', 'restaurant_id', 'template_id', 'product_id', 'sort_order'] },
  { name: 'inventory_runs', columns: ['id', 'restaurant_id', 'template_id', 'user_id', 'department', 'comment', 'status', 'created_at'] },
  { name: 'inventory_values', columns: ['id', 'restaurant_id', 'inventory_run_id', 'product_id', 'qty', 'comment'] },
  { name: 'floor_tables', columns: ['id', 'restaurant_id', 'label', 'seats', 'zone', 'sort_order', 'active', 'created_at'] },
  { name: 'table_reservations', columns: ['id', 'restaurant_id', 'created_by', 'table_ids', 'reserved_for', 'duration_minutes', 'guests_count', 'guest_name', 'guest_phone', 'comment', 'status', 'created_at', 'updated_at'], jsonColumns: ['table_ids'] },
  { name: 'tasks', columns: ['id', 'restaurant_id', 'title', 'description', 'target_type', 'target_role', 'target_user_id', 'target_department', 'due_at', 'created_by', 'created_at', 'active'] },
  { name: 'task_assignments', columns: ['id', 'restaurant_id', 'task_id', 'user_id', 'done', 'comment', 'completed_at'] },
  { name: 'tech_requests', columns: ['id', 'restaurant_id', 'created_by', 'title', 'description', 'category', 'status', 'manager_comment', 'started_at', 'resolved_at', 'created_at', 'updated_at'] },
  { name: 'knowledge_categories', columns: ['id', 'restaurant_id', 'title', 'allowed_roles', 'sort_order'], jsonColumns: ['allowed_roles'] },
  { name: 'knowledge_documents', columns: ['id', 'restaurant_id', 'category_id', 'title', 'type', 'content', 'file_url', 'photo_url', 'ingredients', 'allowed_roles', 'requires_acknowledgement', 'version', 'is_active', 'created_by', 'created_at', 'updated_at', 'sort_order'], jsonColumns: ['allowed_roles', 'ingredients'] },
  { name: 'knowledge_acknowledgements', columns: ['id', 'restaurant_id', 'document_id', 'user_id', 'version', 'acknowledged_at'] },
  { name: 'knowledge_views', columns: ['id', 'restaurant_id', 'document_id', 'user_id', 'viewed_at'] },
  { name: 'shifts', columns: ['id', 'restaurant_id', 'user_id', 'role', 'department', 'location', 'status', 'opened_at', 'closed_at', 'comment'] },
  { name: 'notifications', columns: ['id', 'restaurant_id', 'user_id', 'title', 'body', 'entity_type', 'entity_id', 'read_at', 'created_at'] },
  { name: 'activity_events', columns: ['id', 'restaurant_id', 'actor_id', 'type', 'title', 'entity_type', 'entity_id', 'metadata', 'created_at'], jsonColumns: ['metadata'] },
  { name: 'comments', columns: ['id', 'restaurant_id', 'entity_type', 'entity_id', 'user_id', 'body', 'created_at'] },
  { name: 'integrations', columns: ['id', 'restaurant_id', 'provider', 'status', 'api_login_encrypted', 'organization_id', 'terminal_group_id', 'sync_interval_seconds', 'sync_bookings', 'sync_shifts', 'last_sync_at', 'last_error', 'created_at', 'updated_at'] },
  { name: 'external_mappings', columns: ['id', 'restaurant_id', 'provider', 'entity_type', 'local_id', 'external_id', 'label', 'created_at'] },
  { name: 'integration_events', columns: ['id', 'restaurant_id', 'provider', 'event_type', 'external_id', 'payload', 'status', 'received_at', 'processed_at', 'error'], jsonColumns: ['payload'] },
  { name: 'billing_profiles', columns: ['id', 'restaurant_id', 'customer_type', 'legal_name', 'inn', 'kpp', 'ogrn', 'legal_address', 'bank_name', 'bik', 'checking_account', 'correspondent_account', 'edo_operator', 'edo_id', 'email', 'phone', 'updated_at', 'created_at'] },
  { name: 'billing_invoices', columns: ['id', 'restaurant_id', 'number', 'status', 'plan', 'plan_title', 'months', 'period_start', 'period_end', 'amount', 'currency', 'customer_requisites', 'seller_requisites', 'issued_at', 'due_at', 'paid_at', 'created_at', 'updated_at'], jsonColumns: ['customer_requisites', 'seller_requisites'] },
  { name: 'payments', columns: ['id', 'restaurant_id', 'invoice_id', 'amount', 'currency', 'method', 'reference', 'comment', 'paid_at', 'created_by', 'created_at'] },
  { name: 'closing_documents', columns: ['id', 'restaurant_id', 'invoice_id', 'type', 'number', 'status', 'period_start', 'period_end', 'amount', 'currency', 'issued_at', 'signed_at', 'created_at'] }
];

let pool;
let saveQueue = Promise.resolve();

export const ROLES = ['owner', 'manager', 'senior_waiter', 'senior_bartender', 'senior_cook', 'hostess', 'waiter', 'bartender', 'cook'];
export const DEPARTMENTS = ['hall', 'bar', 'kitchen', 'common'];

function hasPostgres() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!hasPostgres()) return null;
  if (pool) return pool;

  const useSsl = process.env.PGSSL === 'require'
    || (process.env.PGSSL !== 'disable' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || ''));

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : false
  });

  return pool;
}

function readJsonDb() {
  if (!fs.existsSync(DB_FILE)) return null;
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function cloneDbSnapshot(db) {
  return JSON.parse(JSON.stringify(db));
}

function writeJsonDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${DB_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2));
  fs.renameSync(tmpFile, DB_FILE);
}

function encodeColumnValue(column, value) {
  if (column === 'allowed_roles' || column === 'metadata' || column === 'table_ids' || column === 'ingredients' || column === 'payload' || column === 'customer_requisites' || column === 'seller_requisites') {
    if (column === 'metadata' || column === 'payload') return JSON.stringify(value || {});
    return JSON.stringify(value || []);
  }
  if (column === 'supplier') return value || 'Без поставщика';
  return value ?? null;
}

function hasMeaningfulData(db) {
  return Array.isArray(db?.users) && db.users.length > 0;
}

async function ensurePostgresSchema() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  await getPool().query(sql);
  await getPool().query(`alter table if exists users add column if not exists access_password text`);
  await getPool().query('alter table if exists knowledge_documents add column if not exists sort_order int not null default 0');
  await getPool().query(`alter table if exists products add column if not exists supplier text not null default 'Без поставщика'`);
  await getPool().query(`alter table if exists product_requests add column if not exists target_role text`);
  await getPool().query(`alter table if exists product_requests add column if not exists target_user_id text references users(id)`);
  await getPool().query(`alter table if exists tasks add column if not exists target_department text`);
  await getPool().query(`alter table if exists knowledge_documents add column if not exists photo_url text`);
  await getPool().query(`alter table if exists knowledge_documents add column if not exists ingredients jsonb not null default '[]'`);
  await getPool().query(`alter table if exists integrations add column if not exists sync_interval_seconds int not null default 60`);
  await getPool().query(`alter table if exists integrations add column if not exists sync_bookings boolean not null default true`);
  await getPool().query(`alter table if exists integrations add column if not exists sync_shifts boolean not null default true`);
}



async function loadPostgresSnapshot() {
  const db = emptyDb();
  for (const table of SNAPSHOT_TABLES) {
    const { rows } = await getPool().query(`select * from ${table.name}`);
    db[table.name] = rows;
  }
  return db;
}

async function savePostgresSnapshot(db) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    await client.query(`truncate ${SNAPSHOT_TABLES.map(table => table.name).join(', ')} cascade`);

    for (const table of SNAPSHOT_TABLES) {
      const rows = Array.isArray(db[table.name]) ? db[table.name] : [];
      if (!rows.length) continue;

      const columnList = table.columns.join(', ');
      const values = [];
      const tuples = rows.map((row, rowIndex) => {
        const placeholders = table.columns.map((column, columnIndex) => {
          values.push(encodeColumnValue(column, row[column]));
          return `$${rowIndex * table.columns.length + columnIndex + 1}`;
        });
        return `(${placeholders.join(', ')})`;
      });

      await client.query(
        `insert into ${table.name} (${columnList}) values ${tuples.join(', ')}`,
        values
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

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
    floor_tables: [],
    table_reservations: [],
    tasks: [],
    task_assignments: [],
    tech_requests: [],
    knowledge_categories: [],
    knowledge_documents: [],
    knowledge_acknowledgements: [],
    knowledge_views: [],
    shifts: [],
    notifications: [],
    activity_events: [],
    comments: [],
    integrations: [],
    external_mappings: [],
    integration_events: [],
    billing_profiles: [],
    billing_invoices: [],
    payments: [],
    closing_documents: []
  };
}

export function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (hasPostgres()) {
    return loadDbFromPostgres();
  }
  if (!fs.existsSync(DB_FILE)) {
    const db = emptyDb();
    seed(db);
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    return db;
  }
  return { ...emptyDb(), ...readJsonDb() };
}

export function saveDb(db) {
  const snapshot = cloneDbSnapshot(db);
  const writeSnapshot = () => hasPostgres()
    ? savePostgresSnapshot(snapshot)
    : Promise.resolve(writeJsonDb(snapshot));

  const result = saveQueue.then(writeSnapshot, writeSnapshot);
  saveQueue = result.catch(() => undefined);
  return result;
}

export function resetDb() {
  const db = emptyDb();
  seed(db);
  return Promise.resolve(saveDb(db)).then(() => db);
}

async function loadDbFromPostgres() {
  await ensurePostgresSchema();
  const pgDb = await loadPostgresSnapshot();
  if (hasMeaningfulData(pgDb)) {
    return pgDb;
  }

  const jsonDb = readJsonDb();
  if (hasMeaningfulData(jsonDb)) {
    await savePostgresSnapshot(jsonDb);
    return jsonDb;
  }

  const db = emptyDb();
  seed(db);
  await savePostgresSnapshot(db);
  return db;
}

export function publicUser(user) {
  if (!user) return null;
  const { password_hash, access_password, ...safe } = user;
  return safe;
}

export function canUseRestaurant(restaurant) {
  if (!restaurant) return false;
  if (restaurant.subscription_status === 'active') {
    return !restaurant.subscription_ends_at || new Date(restaurant.subscription_ends_at).getTime() >= Date.now();
  }
  if (restaurant.subscription_status === 'trial') {
    return Boolean(restaurant.trial_ends_at) && new Date(restaurant.trial_ends_at).getTime() >= Date.now();
  }
  return false;
}

export function restaurantStatus(restaurant) {
  if (!restaurant) return 'missing';
  if (restaurant.subscription_status === 'trial' && !canUseRestaurant(restaurant)) return 'trial_expired';
  if (restaurant.subscription_status === 'active' && !canUseRestaurant(restaurant)) return 'subscription_expired';
  return restaurant.subscription_status;
}

export function roleToDepartment(role) {
  if (role === 'hostess' || role === 'waiter' || role === 'senior_waiter') return 'hall';
  if (role === 'bartender' || role === 'senior_bartender') return 'bar';
  if (role === 'cook' || role === 'senior_cook') return 'kitchen';
  return 'common';
}

function createRestaurant(db, overrides = {}) {
  const restaurant = {
    id: overrides.id || uid('rest'),
    name: overrides.name || 'Новый ресторан',
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
    access_password: data.role === 'owner' ? '' : String(data.access_password ?? data.password ?? ''),
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
  list.forEach(([name, unit, category, supplier]) => db.products.push({
    id: uid('prod'), restaurant_id, department, name, unit, category, supplier: supplier || 'Без поставщика', active: true, created_at: nowIso()
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

export function syncProductWithInventoryTemplates(db, product) {
  const templates = db.inventory_templates.filter(t => t.restaurant_id === product.restaurant_id && t.department === product.department);
  templates.forEach(template => {
    const exists = db.inventory_template_items.some(i => i.template_id === template.id && i.product_id === product.id);
    if (exists) return;

    const nextSortOrder = db.inventory_template_items
      .filter(i => i.template_id === template.id)
      .reduce((max, i) => Math.max(max, Number(i.sort_order) || 0), 0) + 1;

    db.inventory_template_items.push({
      id: uid('invitem'),
      restaurant_id: product.restaurant_id,
      template_id: template.id,
      product_id: product.id,
      sort_order: nextSortOrder
    });
  });
}

export function moveProductBetweenInventoryTemplates(db, product, previousDepartment) {
  const templates = db.inventory_templates.filter(t => t.restaurant_id === product.restaurant_id);
  const staleTemplateIds = templates
    .filter(t => t.department !== product.department && (!previousDepartment || t.department === previousDepartment))
    .map(t => t.id);

  if (staleTemplateIds.length) {
    db.inventory_template_items = db.inventory_template_items.filter(item => !(item.product_id === product.id && staleTemplateIds.includes(item.template_id)));
  }

  syncProductWithInventoryTemplates(db, product);
}

export function removeProductFromInventoryTemplates(db, productId) {
  db.inventory_template_items = db.inventory_template_items.filter(item => item.product_id !== productId);
}

function addKnowledge(db, restaurant_id, title, allowed_roles, docs) {
  const cat = { id: uid('kcat'), restaurant_id, title, allowed_roles, sort_order: db.knowledge_categories.length + 1 };
  db.knowledge_categories.push(cat);
  docs.forEach((doc, idx) => db.knowledge_documents.push({
    id: uid('kdoc'), restaurant_id, category_id: cat.id, title: doc.title, type: doc.type || 'text', content: doc.content,
    file_url: doc.file_url || '', photo_url: doc.photo_url || '', ingredients: doc.ingredients || [], allowed_roles: doc.allowed_roles || allowed_roles, requires_acknowledgement: doc.requires_acknowledgement ?? true,
    version: 1, is_active: true, created_by: null, created_at: nowIso(), updated_at: nowIso(), sort_order: idx + 1
  }));
}

export function createRestaurantWithDefaults(db, data) {
  const ownerLogin = String(data.login || '').trim();
  const ownerPassword = String(data.password || '');
  if (!ownerLogin || !ownerPassword) {
    throw new Error('Нужны логин и пароль владельца');
  }

  const restaurant = createRestaurant(db, data);
  createUser(db, restaurant.id, {
    name: data.owner_name || 'Владелец ресторана',
    login: ownerLogin,
    password: ownerPassword,
    role: 'owner'
  });

  addChecklist(db, restaurant.id, 'waiter', 'open', 'Открытие смены официанта', [
    'Проверить чистоту столов и посадочных мест', 'Проверить наличие меню', 'Проверить салфетки и приборы', 'Проверить терминал оплаты', 'Сообщить менеджеру о готовности зала'
  ]);
  addChecklist(db, restaurant.id, 'waiter', 'close', 'Закрытие смены официанта', [
    'Протереть столы', 'Сдать терминал и отчёт', 'Проверить забытые вещи гостей', 'Закрыть кассовую зону', 'Передать смену менеджеру'
  ]);
  addChecklist(db, restaurant.id, 'bartender', 'open', 'Открытие бара', [
    'Проверить лёд', 'Проверить заготовки', 'Проверить чистоту станции', 'Проверить стоп-лист бара', 'Подготовить гарниши'
  ]);
  addChecklist(db, restaurant.id, 'bartender', 'close', 'Закрытие бара', [
    'Списать остатки заготовок', 'Помыть барный инвентарь', 'Убрать станцию', 'Передать остатки бара', 'Закрыть холодильники'
  ]);
  addChecklist(db, restaurant.id, 'cook', 'open', 'Открытие кухни', [
    'Проверить холодильники', 'Проверить заготовки', 'Проверить чистоту рабочих зон', 'Проверить стоп-лист кухни', 'Подготовить станцию'
  ]);
  addChecklist(db, restaurant.id, 'cook', 'close', 'Закрытие кухни', [
    'Убрать рабочие зоны', 'Промаркировать заготовки', 'Передать остатки кухни', 'Проверить холодильники', 'Передать смену'
  ]);

  addProducts(db, restaurant.id, 'bar', [
    ['Aperol', 'бут.', 'Алкоголь', 'Simple Group'], ['Джин', 'бут.', 'Алкоголь', 'Simple Group'], ['Ром', 'бут.', 'Алкоголь', 'Luding'], ['Сироп клубника', 'шт.', 'Сиропы', 'Barline'], ['Лёд', 'пакет', 'Расходники', 'Локальный поставщик'], ['Трубочки', 'уп.', 'Расходники', 'HoReCa Market']
  ]);
  addProducts(db, restaurant.id, 'kitchen', [
    ['Курица', 'кг', 'Мясо', 'Мясной двор'], ['Картофель', 'кг', 'Овощи', 'Фермерский склад'], ['Сливки', 'л', 'Молочка', 'Молочный мир'], ['Сыр', 'кг', 'Молочка', 'Молочный мир'], ['Зелень', 'кг', 'Овощи', 'Фермерский склад'], ['Упаковка', 'шт.', 'Расходники', 'HoReCa Market']
  ]);
  addProducts(db, restaurant.id, 'hall', [
    ['Салфетки', 'уп.', 'Расходники', 'HoReCa Market'], ['Меню', 'шт.', 'Сервис', 'Типография'], ['Чековая лента', 'шт.', 'Расходники', 'Касса Сервис']
  ]);

  addInventoryTemplate(db, restaurant.id, 'bar', 'Инвентаризация бара');
  addInventoryTemplate(db, restaurant.id, 'kitchen', 'Инвентаризация кухни');
  addInventoryTemplate(db, restaurant.id, 'hall', 'Инвентаризация зала');

  addKnowledge(db, restaurant.id, 'Сервис-бук', ['waiter', 'hostess', 'manager', 'owner'], [
    { title: 'Стандарт приветствия гостя', content: 'Гость должен получить приветствие в течение 30 секунд. Улыбка, зрительный контакт, предложение помочь с посадкой.' },
    { title: 'Работа с жалобой', content: 'Выслушать гостя, не спорить, извиниться, позвать менеджера, зафиксировать ситуацию.' }
  ]);
  addKnowledge(db, restaurant.id, 'ТТК бара', ['bartender', 'manager', 'owner'], [
    { title: 'Aperol Spritz', content: 'Выход: 250 мл\nСостав: Aperol 60 мл, Prosecco 90 мл, Soda 30 мл, апельсин 1 слайс.\nТехнология: бокал со льдом, налить ингредиенты, аккуратно перемешать, украсить.' }
  ]);
  addKnowledge(db, restaurant.id, 'ТТК кухни', ['cook', 'manager', 'owner'], [
    { title: 'Цезарь с курицей', content: 'Выход: 280 г\nАллергены: яйцо, молочные продукты, глютен.\nТехнология: подготовить салат, курицу, соус, выложить по стандарту подачи.' }
  ]);

  const task = { id: uid('task'), restaurant_id: restaurant.id, title: 'Проверить актуальность стоп-листа', description: 'Перед открытием смены проверьте стоп-лист и сообщите менеджеру.', target_type: 'all', target_role: null, target_user_id: null, target_department: null, due_at: addDays(1), created_by: null, created_at: nowIso(), active: true };
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
}

export { uid, nowIso, addDays };
