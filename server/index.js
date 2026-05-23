import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  loadDb,
  saveDb,
  publicUser,
  hashPassword,
  uid,
  nowIso,
  addDays,
  canUseRestaurant,
  restaurantStatus,
  roleToDepartment,
  createRestaurantWithDefaults,
  syncProductWithInventoryTemplates,
  moveProductBetweenInventoryTemplates,
  removeProductFromInventoryTemplates
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 8090);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDist = path.resolve(__dirname, '../webapp/dist');
const uploadsDir = path.resolve(__dirname, 'data/uploads');
const checklistUploadsDir = path.join(uploadsDir, 'checklists');
const knowledgeUploadsDir = path.join(uploadsDir, 'knowledge');
const billingUploadsDir = path.join(uploadsDir, 'billing');
const MANAGER_ROLES = ['owner', 'manager'];
const SENIOR_ROLE_DEPARTMENT = { senior_waiter: 'hall', senior_bartender: 'bar', senior_cook: 'kitchen' };
const SENIOR_ROLES = Object.keys(SENIOR_ROLE_DEPARTMENT);
const DEPARTMENT_ROLE_MAP = {
  hall: ['senior_waiter', 'waiter', 'hostess'],
  bar: ['senior_bartender', 'bartender'],
  kitchen: ['senior_cook', 'cook'],
  cleaning: ['cleaning'],
  common: ['manager']
};
const STAFF_ROLES = ['manager', 'senior_waiter', 'senior_bartender', 'senior_cook', 'hostess', 'waiter', 'bartender', 'cook', 'cleaning'];
const CHECKLIST_ROLES = ['cook', 'bartender', 'hostess', 'waiter', 'cleaning'];
const departments = { hall: 'Зал', bar: 'Бар', kitchen: 'Кухня', cleaning: 'Клининг', common: 'Общее' };
const techRequestStatuses = { new: 'новая', in_progress: 'в работе', done: 'выполнена', cancelled: 'отклонена' };
const problemTypeLabels = { task: 'Задача', tech_request: 'Проблема', checklist_run: 'Чек-лист', inventory_run: 'Инвентаризация', booking: 'Бронь' };
const bookingStatuses = { booked: 'забронирован', seated: 'гости пришли', completed: 'завершён', cancelled: 'отменён' };
const CHECKLIST_ROLE_VIEWERS = {
  waiter: ['waiter', 'senior_waiter'],
  hostess: ['hostess', 'senior_waiter'],
  bartender: ['bartender', 'senior_bartender'],
  cook: ['cook', 'senior_cook'],
  cleaning: ['cleaning']
};
const tariffEmployeeLimits = {
  trial: 10,
  start: 10,
  старт: 10,
  team20: 20,
  'команда 20': 20,
  team: 25,
  команда: 25,
  standard: 30,
  стандарт: 30,
  pro: 30,
  team40: 40,
  'команда 40': 40,
  business: 50,
  бизнес: 50,
  team50: 50,
  'команда 50': 50,
  team60: 60,
  'команда 60': 60,
  network: 100,
  сеть: 100,
  enterprise: null
};

function isoDateKey(value) {
  return String(value || '').slice(0, 10);
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeDateRange(query, fromKey = 'from', toKey = 'to') {
  const today = todayKey();
  const from = isDateKey(query?.[fromKey]) ? String(query[fromKey]) : today;
  const to = isDateKey(query?.[toKey]) ? String(query[toKey]) : from;
  return from <= to ? { from, to } : { from: to, to: from };
}

function dateKeyInRange(value, range) {
  const key = isoDateKey(value);
  return isDateKey(key) && key >= range.from && key <= range.to;
}

function taskWorkDate(task) {
  return task?.due_at || task?.created_at || '';
}

function taskTouchesRange(task, assignment, range) {
  if (assignment?.done) return dateKeyInRange(assignment.completed_at || taskWorkDate(task), range);
  return dateKeyInRange(taskWorkDate(task), range);
}

function inventoryAssignmentDetails(assignment) {
  const template = db.inventory_templates.find(t => t.id === assignment.template_id);
  const runs = sameRestaurant(db.inventory_runs, assignment.restaurant_id)
    .filter(run => run.template_id === assignment.template_id)
    .filter(run => run.assignment_id === assignment.id || isoDateKey(run.created_at) === assignment.due_date)
    .filter(run => run.status === 'completed');
  const latestRun = runs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  const completed = Boolean(latestRun);
  return {
    ...assignment,
    status: completed ? 'completed' : assignment.status,
    completed_at: latestRun?.completed_at || latestRun?.created_at || assignment.completed_at || null,
    template,
    completed_by: latestRun ? publicUser(db.users.find(user => user.id === latestRun.user_id)) : null,
    assigned_by_user: publicUser(db.users.find(user => user.id === assignment.assigned_by)),
    runs_count: runs.length
  };
}

const billingPlans = [
  { id: 'start', title: 'Старт', employees: 10, monthly_amount: 1490 },
  { id: 'team20', title: 'Команда 20', employees: 20, monthly_amount: 1990 },
  { id: 'standard', title: 'Стандарт', employees: 30, monthly_amount: 2990 },
  { id: 'team40', title: 'Команда 40', employees: 40, monthly_amount: 3990 },
  { id: 'team50', title: 'Команда 50', employees: 50, monthly_amount: 4990 },
  { id: 'team60', title: 'Команда 60', employees: 60, monthly_amount: 5990 },
  { id: 'network', title: 'Сеть', employees: 100, monthly_amount: 9990 },
  { id: 'enterprise', title: 'Enterprise', employees: null, monthly_amount: 0 }
];

const defaultSellerRequisites = {
  legal_name: process.env.BILLING_SELLER_NAME || 'ИП ФИО',
  inn: process.env.BILLING_SELLER_INN || '',
  ogrn: process.env.BILLING_SELLER_OGRNIP || '',
  legal_address: process.env.BILLING_SELLER_ADDRESS || '',
  bank_name: process.env.BILLING_SELLER_BANK_NAME || '',
  bik: process.env.BILLING_SELLER_BIK || '',
  checking_account: process.env.BILLING_SELLER_CHECKING_ACCOUNT || '',
  correspondent_account: process.env.BILLING_SELLER_CORRESPONDENT_ACCOUNT || '',
  email: process.env.BILLING_SELLER_EMAIL || '',
  phone: process.env.BILLING_SELLER_PHONE || '',
  tax_note: process.env.BILLING_TAX_NOTE || 'Без НДС'
};
const defaultTransferRequisites = {
  recipient: process.env.BILLING_TRANSFER_RECIPIENT || process.env.BILLING_SELLER_NAME || 'Resto Control',
  phone: process.env.BILLING_TRANSFER_PHONE || process.env.BILLING_SELLER_PHONE || '',
  card: process.env.BILLING_TRANSFER_CARD || '',
  bank: process.env.BILLING_TRANSFER_BANK || process.env.BILLING_SELLER_BANK_NAME || '',
  comment: process.env.BILLING_TRANSFER_COMMENT || 'После перевода отправьте заявку из кабинета',
  tax_note: process.env.BILLING_TAX_NOTE || 'Без НДС'
};
const sellerRequisiteFields = ['legal_name', 'inn', 'kpp', 'ogrn', 'legal_address', 'bank_name', 'bik', 'checking_account', 'correspondent_account', 'email', 'phone', 'tax_note'];
const transferRequisiteFields = ['recipient', 'phone', 'card', 'bank', 'comment', 'tax_note'];

const inventoryImportSections = {
  bar: { department: 'bar', title: 'Бар', defaultCategory: 'Бар' },
  kitchen: { department: 'kitchen', title: 'Кухня', defaultCategory: 'Кухня' },
  household: { department: 'hall', title: 'Хозтовары', defaultCategory: 'Хозтовары' },
  dishes: { department: 'hall', title: 'Посуда', defaultCategory: 'Посуда' }
};

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(morgan('tiny'));

let db = await loadDb();

async function persist() {
  await saveDb(db);
}

function runAsync(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function sign(user) {
  return jwt.sign({ id: user.id, restaurant_id: user.restaurant_id, role: user.role, is_super_admin: user.is_super_admin }, JWT_SECRET, { expiresIn: '14d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.id && u.active);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден или отключен' });
    req.user = user;
    req.restaurant = user.restaurant_id ? db.restaurants.find(r => r.id === user.restaurant_id) : null;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Сессия истекла' });
  }
}

function superOnly(req, res, next) {
  if (!req.user?.is_super_admin) return res.status(403).json({ error: 'Доступ только для создателя приложения' });
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.is_super_admin) return next();
  if (!MANAGER_ROLES.includes(req.user?.role)) return res.status(403).json({ error: 'Доступ только для владельца или менеджера' });
  next();
}

function roleDepartment(role) {
  if (role === 'hostess' || role === 'waiter' || role === 'senior_waiter') return 'hall';
  if (role === 'bartender' || role === 'senior_bartender') return 'bar';
  if (role === 'cook' || role === 'senior_cook') return 'kitchen';
  if (role === 'cleaning') return 'cleaning';
  return 'common';
}

function manageableDepartment(user) {
  if (!user) return '';
  return SENIOR_ROLE_DEPARTMENT[user.role] || '';
}

function manageableRolesForUser(user) {
  if (!user) return [];
  if (user.is_super_admin || MANAGER_ROLES.includes(user.role)) return STAFF_ROLES;
  const department = manageableDepartment(user);
  return department ? (DEPARTMENT_ROLE_MAP[department] || []) : [];
}

function canManageRole(user, role) {
  return manageableRolesForUser(user).includes(role);
}

function canManageChecklistRole(user, role) {
  if (user?.is_super_admin || MANAGER_ROLES.includes(user?.role)) return true;
  return CHECKLIST_ROLES.includes(role) && canManageRole(user, role);
}

function checklistRoleMatchesUser(templateRole, userRole) {
  if (!templateRole || templateRole === userRole) return true;
  return (CHECKLIST_ROLE_VIEWERS[templateRole] || [templateRole]).includes(userRole);
}

function taskRecipientRolesForUser(user) {
  if (!user) return [];
  if (user.role === 'senior_bartender') return ['bartender'];
  if (user.role === 'senior_cook') return ['cook'];
  if (user.role === 'senior_waiter') return ['waiter', 'hostess'];
  return STAFF_ROLES.filter(role => role !== 'manager' && !SENIOR_ROLES.includes(role));
}

function canAssignTaskToRole(user, role) {
  if (user?.is_super_admin || MANAGER_ROLES.includes(user?.role)) return STAFF_ROLES.includes(role) && role !== 'manager';
  return taskRecipientRolesForUser(user).includes(role);
}

function operationalEditorOnly(req, res, next) {
  if (req.user?.is_super_admin || MANAGER_ROLES.includes(req.user?.role) || SENIOR_ROLES.includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Доступ только для менеджера или старшего сотрудника подразделения' });
}

function ensureRestaurantActive(req, res, next) {
  if (req.user?.is_super_admin) return next();
  if (!canUseRestaurant(req.restaurant)) {
    return res.status(402).json({
      error: 'Пробный период или подписка закончились',
      status: restaurantStatus(req.restaurant),
      restaurant: req.restaurant
    });
  }
  next();
}

function sameRestaurant(items, restaurant_id) {
  return (items || []).filter(i => i.restaurant_id === restaurant_id);
}


function integrationKey() {
  return crypto.createHash('sha256').update(String(process.env.INTEGRATION_SECRET || JWT_SECRET)).digest();
}

function encryptSecret(value) {
  const plain = String(value || '').trim();
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', integrationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

function decryptSecret(value) {
  if (!value) return '';
  try {
    const [ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', integrationKey(), Buffer.from(ivRaw, 'base64'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function iikoBaseUrl() {
  return String(process.env.IIKO_API_BASE_URL || 'https://api-ru.iiko.services').replace(/\/$/, '');
}

async function iikoCloudRequest(pathname, body, token = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${iikoBaseUrl()}${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {})
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(data?.errorDescription || data?.message || data?.error || 'iiko не ответила на запрос');
  }
  return data;
}

function publicIntegration(integration) {
  if (!integration) {
    return {
      id: '',
      provider: 'iiko',
      status: 'autonomous',
      organization_id: '',
      terminal_group_id: '',
      sync_interval_seconds: 60,
      sync_bookings: false,
      sync_shifts: false,
      last_sync_at: null,
      last_error: '',
      has_api_login: false
    };
  }
  const { api_login_encrypted, ...safe } = integration;
  const hasApiLogin = Boolean(api_login_encrypted);
  return {
    ...safe,
    status: hasApiLogin ? safe.status : 'autonomous',
    sync_bookings: hasApiLogin ? safe.sync_bookings !== false : false,
    sync_shifts: hasApiLogin ? safe.sync_shifts !== false : false,
    has_api_login: hasApiLogin
  };
}

function getIikoIntegration(restaurantId) {
  return sameRestaurant(db.integrations, restaurantId).find(item => item.provider === 'iiko') || null;
}

function integrationEvent(restaurantId, eventType, payload, status = 'received', error = '') {
  const event = {
    id: uid('intevt'),
    restaurant_id: restaurantId,
    provider: 'iiko',
    event_type: eventType,
    external_id: String(payload?.id || payload?.external_id || payload?.organizationId || ''),
    payload: payload || {},
    status,
    received_at: nowIso(),
    processed_at: status === 'processed' ? nowIso() : null,
    error
  };
  db.integration_events.push(event);
  return event;
}

function employeeLimitForRestaurant(restaurant) {
  const plan = String(restaurant?.plan || restaurant?.tariff || 'trial').trim().toLowerCase();
  if (plan.includes('enterprise')) return null;
  return tariffEmployeeLimits[plan] ?? 10;
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function hasRoleAccess(user, allowedRoles = []) {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  if (MANAGER_ROLES.includes(user.role)) return true;
  return allowedRoles.includes(user.role);
}

function normalizeStaffRole(role) {
  const value = String(role || '').trim();
  return STAFF_ROLES.includes(value) ? value : '';
}

function serializeAdminUser(user, viewer) {
  return publicUser(user);
}

function normalizeChecklistTemplateItems(rawItems = []) {
  if (!Array.isArray(rawItems)) {
    return { error: 'Передайте массив пунктов чек-листа' };
  }

  const items = rawItems.map((item, index) => {
    const text = String(typeof item === 'string' ? item : item?.text || '').trim();
    if (!text) return null;

    return {
      id: typeof item === 'object' && item?.id ? String(item.id) : uid('cli'),
      text,
      required: item?.required !== undefined ? Boolean(item.required) : true,
      needs_comment: Boolean(item?.needs_comment),
      needs_photo: Boolean(item?.needs_photo),
      sort_order: index + 1
    };
  }).filter(Boolean);

  if (!items.length) {
    return { error: 'Добавьте хотя бы один пункт чек-листа' };
  }

  return { items };
}

function activeFloorTables(restaurant_id) {
  return sameRestaurant(collection('floor_tables'), restaurant_id)
    .filter(table => table.active)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.label || '').localeCompare(String(b.label || ''), 'ru'));
}

function reservationInterval(reservation) {
  const start = new Date(reservation.reserved_for).getTime();
  const duration = Math.max(30, Number(reservation.duration_minutes || 120));
  return {
    start,
    end: start + duration * 60000
  };
}

function intervalsOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

function serializeReservation(reservation) {
  return {
    ...reservation,
    created_by_user: publicUser(db.users.find(user => user.id === reservation.created_by)),
    tables: (Array.isArray(reservation.table_ids) ? reservation.table_ids : [])
      .map(tableId => collection('floor_tables').find(table => table.id === tableId))
      .filter(Boolean)
  };
}


function parseInventoryQuantity(input) {
  const raw = typeof input === 'object' && input !== null ? input.qty : input;
  const expression = String(raw ?? '').trim();
  if (!expression) return { qty: 0, expression: '' };

  const normalized = expression.replace(/\s+/g, '').replace(/,/g, '.');
  const terms = normalized.split('+');
  if (!terms.length || terms.some(term => !term)) {
    return { error: 'Введите количество числами, например 3+2,2+0,04' };
  }

  let total = 0;
  for (const term of terms) {
    if (!/^\d+(?:\.\d+)?$/.test(term)) {
      return { error: 'Введите количество числами, например 3+2,2+0,04' };
    }
    total += Number(term);
  }

  return { qty: Math.round(total * 1000) / 1000, expression };
}


function cleanInventoryText(value) {
  return String(value || '')
    .replace(/[\u0000-\u001F]+/g, ' ')
    .replace(/[•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeInventoryUnit(value) {
  const raw = cleanInventoryText(value).toLowerCase().replace(/[.,:;]+$/g, '');
  const aliases = {
    'ед': 'шт.', 'ед.': 'шт.', 'штука': 'шт.', 'штук': 'шт.', 'шт': 'шт.', 'шт.': 'шт.',
    'килограмм': 'кг', 'килограмма': 'кг', 'кг.': 'кг',
    'грамм': 'г', 'гр': 'г', 'гр.': 'г',
    'литр': 'л', 'литра': 'л', 'л.': 'л',
    'миллилитр': 'мл', 'мл.': 'мл',
    'уп': 'уп.', 'упак': 'уп.', 'упаковка': 'уп.', 'упаковки': 'уп.',
    'бут': 'бут.', 'бутылка': 'бут.', 'бутылки': 'бут.',
    'банка': 'бан.', 'банки': 'бан.', 'бан': 'бан.',
    'коробка': 'кор.', 'коробки': 'кор.', 'кор': 'кор.',
    'пачка': 'пач.', 'пачки': 'пач.', 'пач': 'пач.',
    'порция': 'порц.', 'порции': 'порц.', 'порц': 'порц.',
    'кега': 'кег', 'кеги': 'кег'
  };
  return aliases[raw] || raw;
}

const inventoryUnitWords = [
  'шт', 'шт.', 'ед', 'ед.', 'кг', 'кг.', 'г', 'гр', 'гр.', 'л', 'л.', 'мл', 'мл.',
  'уп', 'уп.', 'упак', 'упаковка', 'бут', 'бут.', 'бутылка', 'банка', 'бан.', 'бан',
  'коробка', 'кор.', 'кор', 'пачка', 'пач.', 'пач', 'порция', 'порц.', 'порц', 'кег', 'кега',
  'рул', 'рулон', 'пара', 'компл', 'комплект', 'баллон', 'мешок', 'ящик'
];

function isInventoryUnit(value) {
  const unit = normalizeInventoryUnit(value);
  return inventoryUnitWords.map(normalizeInventoryUnit).includes(unit);
}

function isInventoryHeader(value) {
  const text = cleanInventoryText(value).toLowerCase();
  return /^(№|n|п\/п|наименование|название|товар|продукт|позиция|единица|ед\.?\s*изм\.?|изм\.?|кол-?во|количество|остаток|итого|цена|сумма|комментарий|примечание)$/i.test(text);
}

function normalizeImportedProductName(value) {
  return cleanInventoryText(value)
    .replace(/^\d{4,6}(?=[^\d\s])/, '')
    .replace(/^\d+[.)\-\s]+/, '')
    .replace(/^(наименование|название|товар|продукт)\s*[:\-]\s*/i, '')
    .replace(/\s+(шт\.?|кг\.?|г|гр\.?|л\.?|мл\.?|уп\.?|бут\.?)$/i, '')
    .trim();
}

function productKey(name) {
  return cleanInventoryText(name).toLowerCase().replace(/ё/g, 'е');
}

function rowFromLine(line) {
  const text = cleanInventoryText(line);
  if (!text || text.length < 4) return null;
  if (/^(наименование|товар|продукт|ед\.?\s*изм|единица|количество|остаток)/i.test(text)) return null;

  const tokens = text.split(/\s+/);
  const unitIndex = tokens.findIndex(isInventoryUnit);
  if (unitIndex <= 0) return null;

  const unit = normalizeInventoryUnit(tokens[unitIndex]);
  const nameTokens = tokens.slice(0, unitIndex).filter(token => !/^\d+[.)]?$/.test(token) && !isInventoryHeader(token));
  const name = normalizeImportedProductName(nameTokens.join(' '));
  if (!name || name.length < 2 || isInventoryHeader(name)) return null;
  return { name, unit };
}


function stripInventoryNoise(value) {
  return cleanInventoryText(value)
    .replace(/\b\d{8,14}\b/g, ' ')
    .replace(/\b\d+\s*из\s*\d+\b/gi, ' ')
    .replace(/инвентаризацию\s+(произвел|принял).*$/i, ' ')
    .replace(/^(организация|бланк инвентаризации|на дату|склад|товар|код|штрихкод|группа|ед\. изм\.?|единица измерения|остаток фактический|отметки)$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikePostUnitNoise(value) {
  const text = stripInventoryNoise(value);
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^(организация|бланк|инвентаризации|товар|код|штрихкод|группа|наименование|остаток|отметки|ед\.?\s*изм)/i.test(text)) return true;
  if (/^[А-ЯЁ0-9\s\/().,"«»\-]+$/.test(text) && text.length <= 80) return true;
  if (/\sт$/i.test(text) && text.length <= 80) return true;
  return false;
}

function normalizePdfSegmentName(value) {
  return normalizeImportedProductName(stripInventoryNoise(value)
    .replace(/^(наименование|группа|штрихкод)\s*/i, '')
    .replace(/\s+/g, ' '));
}

function rowFromPdfSegment(segment) {
  const prepared = String(segment || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/(\d{8,14})/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!prepared || prepared.length < 3) return null;

  const withoutBarcodes = prepared.replace(/\b\d{8,14}\b/g, ' ');
  const compactUnits = Array.from(new Set(inventoryUnitWords.flatMap(value => {
    const normalized = normalizeInventoryUnit(value);
    return [value, normalized, normalized.replace(/\.$/, '')];
  })))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(match => ({ match: match.toLowerCase(), unit: normalizeInventoryUnit(match) }));
  const lower = withoutBarcodes.toLowerCase();

  for (let index = 0; index < lower.length; index += 1) {
    for (const unitCandidate of compactUnits) {
      const unit = unitCandidate.unit;
      const match = unitCandidate.match;
      if (!unit || !match) continue;
      if (!lower.startsWith(match, index)) continue;

      const beforeChar = withoutBarcodes[index - 1] || '';
      const afterChar = withoutBarcodes[index + match.length] || '';
      if (/\d/.test(beforeChar)) continue;
      if (match === 'л' && /[мm]/i.test(beforeChar)) continue;
      if (match === 'г' && /[кk]/i.test(beforeChar)) continue;
      if (afterChar && /[а-яёa-z]/.test(afterChar)) continue;

      const rawName = withoutBarcodes.slice(0, index);
      const after = withoutBarcodes.slice(index + match.length);
      if (!looksLikePostUnitNoise(after)) continue;

      const name = normalizePdfSegmentName(rawName);
      if (!name || name.length < 2 || isInventoryHeader(name)) continue;
      if (/^(группа|штрихкод|наименование|код)$/i.test(name)) continue;
      return { name, unit };
    }
  }

  return rowFromLine(prepared.replace(/\b\d{8,14}\b/g, ' '));
}

function parseInventoryPdfText(text) {
  const source = String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/([0-9]{4,6})(?=[А-ЯЁа-яёA-Za-z«"])/g, '$1 ');
  const codeMatches = Array.from(source.matchAll(/(?<!\d)(\d{4,6})(?!\d)/g))
    .filter(match => {
      const code = match[1];
      if (/^(202[0-9]|20[0-9]{2})$/.test(code)) return false;
      const before = source.slice(Math.max(0, match.index - 12), match.index);
      const after = source.slice(match.index + code.length, match.index + code.length + 12);
      return !/\d$/.test(before) && !/^\d/.test(after);
    });

  const rows = [];
  for (let i = 0; i < codeMatches.length; i += 1) {
    const current = codeMatches[i];
    const next = codeMatches[i + 1];
    const start = current.index + current[1].length;
    const end = next ? next.index : source.length;
    const segment = source.slice(start, end);
    const row = rowFromPdfSegment(segment);
    if (row) rows.push(row);
  }

  String(text || '').split(/\r?\n/)
    .map(line => rowFromPdfSegment(line) || rowFromLine(line))
    .filter(Boolean)
    .forEach(row => rows.push(row));

  return rows;
}

function rowFromCells(cells) {
  const cleanCells = cells.map(cleanInventoryText).filter(Boolean);
  if (cleanCells.length < 2) return null;
  const lowerJoined = cleanCells.join(' ').toLowerCase();
  if (/наименование|товар|продукт|ед\.?\s*изм|единица|количество|остаток/.test(lowerJoined)
    && cleanCells.every(cell => isInventoryHeader(cell) || /^\d+$/.test(cell))) return null;

  const unitIndex = cleanCells.findIndex(isInventoryUnit);
  if (unitIndex >= 0) {
    const unit = normalizeInventoryUnit(cleanCells[unitIndex]);
    const before = cleanCells.slice(0, unitIndex).filter(cell => !isInventoryHeader(cell) && !/^\d+$/.test(cell));
    const fallback = cleanCells.filter((cell, index) => index !== unitIndex && !isInventoryHeader(cell) && !/^\d+(?:[,.]\d+)?$/.test(cell));
    const rawName = before.length ? before[before.length - 1] : fallback[0];
    const name = normalizeImportedProductName(rawName);
    if (name && name.length >= 2 && !isInventoryHeader(name)) return { name, unit };
  }
  return rowFromLine(cleanCells.join(' '));
}

function uniqueImportedRows(rows) {
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    if (!row?.name || !row?.unit) continue;
    const key = `${productKey(row.name)}::${normalizeInventoryUnit(row.unit)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ name: row.name, unit: normalizeInventoryUnit(row.unit) });
  }
  return unique;
}

async function parseInventoryImportFile({ file_name = '', mime_type = '', data = '' }) {
  const base64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return { error: 'Файл пустой или не удалось прочитать данные' };

  const filename = String(file_name || '').toLowerCase();
  const type = String(mime_type || '').toLowerCase();
  const rows = [];

  if (filename.endsWith('.pdf') || type.includes('pdf')) {
    try {
      const mod = await import('pdf-parse');
      const pdfParse = mod.default || mod;
      const parsed = await pdfParse(buffer);
      parseInventoryPdfText(parsed.text || '').forEach(row => rows.push(row));
    } catch (error) {
      return { error: 'Не удалось прочитать PDF. Если это скан без текста, сохраните бланк в Excel или PDF с распознанным текстом.' };
    }
  } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.csv') || type.includes('spreadsheet') || type.includes('excel') || type.includes('csv')) {
    try {
      const mod = await import('xlsx');
      const XLSX = mod.default || mod;
      const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
      workbook.SheetNames.forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false });
        matrix.map((cells) => rowFromCells(Array.isArray(cells) ? cells : [])).filter(Boolean).forEach(row => rows.push(row));
      });
    } catch (error) {
      return { error: 'Не удалось прочитать Excel-файл. Загрузите .xlsx, .xls или .csv с колонками «наименование» и «единица».' };
    }
  } else {
    return { error: 'Поддерживаются PDF, Excel .xlsx/.xls и CSV' };
  }

  const items = uniqueImportedRows(rows);
  if (!items.length) return { error: 'Не удалось найти наименования и единицы измерения в бланке' };
  return { items };
}

function currentTableReservation(restaurant_id, tableId) {
  const now = Date.now();
  return sameRestaurant(collection('table_reservations'), restaurant_id)
    .filter(reservation => ['seated'].includes(reservation.status))
    .filter(reservation => (Array.isArray(reservation.table_ids) ? reservation.table_ids : []).includes(tableId))
    .sort((a, b) => String(b.reserved_for || '').localeCompare(String(a.reserved_for || '')))
    .find(reservation => {
      const interval = reservationInterval(reservation);
      return Number.isFinite(interval.start) && now >= interval.start - 15 * 60000;
    }) || null;
}

function normalizeReservationPayload(restaurant_id, rawBody = {}, currentReservationId = null) {
  const tableIds = Array.from(new Set((Array.isArray(rawBody.table_ids) ? rawBody.table_ids : []).map(value => String(value || '').trim()).filter(Boolean)));
  if (!tableIds.length) return { error: 'Выберите хотя бы один стол' };

  const reservedFor = String(rawBody.reserved_for || '').trim();
  const reservedAt = new Date(reservedFor);
  if (!reservedFor || Number.isNaN(reservedAt.getTime())) {
    return { error: 'Укажите корректную дату и время брони' };
  }

  const guestsCount = Number(rawBody.guests_count);
  if (!Number.isFinite(guestsCount) || guestsCount <= 0) {
    return { error: 'Укажите количество гостей' };
  }

  const guestPhone = String(rawBody.guest_phone || '').trim();

  const durationMinutes = Math.max(30, Math.min(600, Number(rawBody.duration_minutes || 120) || 120));
  const tables = tableIds.map(tableId => collection('floor_tables').find(table => table.id === tableId && table.restaurant_id === restaurant_id && table.active)).filter(Boolean);
  if (tables.length !== tableIds.length) return { error: 'Один или несколько столов не найдены' };

  const nextInterval = {
    start: reservedAt.getTime(),
    end: reservedAt.getTime() + durationMinutes * 60000
  };
  const conflictingReservation = sameRestaurant(collection('table_reservations'), restaurant_id)
    .filter(reservation => reservation.id !== currentReservationId)
    .filter(reservation => ['booked', 'seated'].includes(reservation.status))
    .find(reservation => {
      const reservationTableIds = Array.isArray(reservation.table_ids) ? reservation.table_ids : [];
      return reservationTableIds.some(tableId => tableIds.includes(tableId)) && intervalsOverlap(nextInterval, reservationInterval(reservation));
    });

  if (conflictingReservation) {
    const busyLabels = (Array.isArray(conflictingReservation.table_ids) ? conflictingReservation.table_ids : [])
      .filter(tableId => tableIds.includes(tableId))
      .map(tableId => collection('floor_tables').find(table => table.id === tableId)?.label)
      .filter(Boolean)
      .join(', ');
    return { error: `Столы уже заняты на это время${busyLabels ? `: ${busyLabels}` : ''}` };
  }

  const rawStatus = String(rawBody.status || 'booked').trim();
  const status = ['booked', 'seated', 'completed', 'cancelled'].includes(rawStatus) ? rawStatus : 'booked';

  return {
    payload: {
      table_ids: tableIds,
      reserved_for: reservedAt.toISOString(),
      duration_minutes: durationMinutes,
      guests_count: Math.round(guestsCount),
      guest_name: String(rawBody.guest_name || '').trim(),
      guest_phone: guestPhone,
      comment: String(rawBody.comment || '').trim(),
      status
    }
  };
}

function saveChecklistPhoto(dataUrl, restaurant_id, run_id, item_id) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!match) {
    throw new Error('Некорректный формат фото');
  }

  const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
  const restaurantDir = path.join(checklistUploadsDir, restaurant_id);
  fs.mkdirSync(restaurantDir, { recursive: true });

  const filename = `${run_id}-${item_id}-${Date.now()}.${ext}`;
  const filepath = path.join(restaurantDir, filename);
  fs.writeFileSync(filepath, Buffer.from(match[2], 'base64'));

  return `/uploads/checklists/${restaurant_id}/${filename}`;
}

function decodeBase64File(file = {}) {
  const data = String(file.data || file.file_data || '');
  const base64 = data.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('Файл пустой или не удалось прочитать данные');
  return buffer;
}

function safeUploadName(name = '', fallback = 'file') {
  const ext = path.extname(String(name || '')).toLowerCase();
  const base = path.basename(String(name || fallback), ext).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '-').slice(0, 80) || fallback;
  return `${Date.now()}-${cryptoRandom()}-${base}${ext}`;
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 8);
}

function saveKnowledgeFile(file, restaurant_id, kind = 'docs') {
  const filename = String(file?.file_name || file?.name || '').trim();
  const mime = String(file?.mime_type || file?.type || '').toLowerCase();
  const isPdf = filename.toLowerCase().endsWith('.pdf') || mime.includes('pdf');
  const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(filename);
  if (kind === 'pdf' && !isPdf) throw new Error('Загрузите PDF-файл');
  if (kind === 'image' && !isImage) throw new Error('Фото должно быть в формате JPG, PNG или WEBP');

  const buffer = decodeBase64File(file);
  const ext = isPdf ? '.pdf' : path.extname(filename || '').toLowerCase() || (mime.includes('png') ? '.png' : '.jpg');
  const restaurantDir = path.join(knowledgeUploadsDir, restaurant_id, kind === 'image' ? 'photos' : 'docs');
  fs.mkdirSync(restaurantDir, { recursive: true });
  const storedName = safeUploadName(filename || `document${ext}`, kind === 'image' ? 'photo' : 'document');
  const filepath = path.join(restaurantDir, storedName);
  fs.writeFileSync(filepath, buffer);
  return { url: `/uploads/knowledge/${restaurant_id}/${kind === 'image' ? 'photos' : 'docs'}/${storedName}`, buffer, filename };
}

function saveBillingReceipt(file, restaurant_id) {
  const filename = String(file?.file_name || file?.name || '').trim();
  const mime = String(file?.mime_type || file?.type || '').toLowerCase();
  const isPdf = filename.toLowerCase().endsWith('.pdf') || mime.includes('pdf');
  const isImage = mime.startsWith('image/') || /\.(jpg|jpeg|png|webp)$/i.test(filename);
  if (!file || !filename) throw new Error('Прикрепите чек оплаты');
  if (!isPdf && !isImage) throw new Error('Чек должен быть фото или PDF-файлом');

  const buffer = decodeBase64File(file);
  const maxSize = 15 * 1024 * 1024;
  if (buffer.length > maxSize) throw new Error('Чек слишком большой. Максимум 15 МБ');

  const ext = path.extname(filename || '').toLowerCase() || (isPdf ? '.pdf' : '.jpg');
  const restaurantDir = path.join(billingUploadsDir, restaurant_id);
  fs.mkdirSync(restaurantDir, { recursive: true });
  const sourceName = path.extname(filename) ? filename : `${filename || 'receipt'}${ext}`;
  const storedName = safeUploadName(sourceName, 'receipt');
  const filepath = path.join(restaurantDir, storedName);
  fs.writeFileSync(filepath, buffer);
  return {
    url: `/uploads/billing/${restaurant_id}/${storedName}`,
    name: filename || storedName,
    mime_type: mime || (isPdf ? 'application/pdf' : 'image/jpeg'),
    uploaded_at: nowIso()
  };
}

function cleanTtkText(value) {
  return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTtkNumber(value) {
  const normalized = String(value || '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : null;
}

function normalizeTtkIngredientName(value) {
  return cleanTtkText(value)
    .replace(/\s+Т$/i, '')
    .replace(/^ТРЕБОВАНИЯ.*$/i, '')
    .replace(/^РЕАЛИЗАЦИИ.*$/i, '')
    .replace(/^ИТОГО.*$/i, '')
    .trim();
}

function isTtkIngredientNameNoise(value) {
  const text = cleanTtkText(value).toLowerCase();
  if (!text) return true;
  if (/^(№|no|nº)\b/.test(text)) return true;
  if (/(^|\s)(наименование продукта|ед\.?\s*изм|технология приготовления|брутто в ед|вес брутто|вес нетто|вес готового)(\s|$)/i.test(text)) return true;
  if (/^(название на чеке|область применения|хранение|срок хранения|органолептические показатели|технологическая карта|требования к оформлению|реализации|итого|вес готового блюда)/i.test(text)) return true;
  if (/^(брутто|вес|единица|количество)$/i.test(text)) return true;
  return false;
}

function lineLooksLikeTtkName(line) {
  const text = normalizeTtkIngredientName(line);
  if (!text || /^\d+[,.]?\d*\s*(?:кг|г|л|мл|шт|порц)?$/i.test(text)) return false;
  if (/^(название|область|хранение|срок|органолептические|требования|реализации|итого|вес готового)/i.test(text)) return false;
  if (/^(№|наименование|ед\.?.*изм|брутто|вес|технология)/i.test(text)) return false;
  return /[а-яёa-z]/i.test(text);
}

function titleContinuationLooksLikeMeasure(line) {
  return /^\d+\s*(?:мл|л|г|кг|шт|порц)(?:$|\s)/i.test(cleanTtkText(line));
}

function normalizeTtkTitle(value) {
  return cleanTtkText(value)
    .replace(/^Блюдо\/напиток:\s*/i, '')
    .replace(/^Название на чеке:\s*/i, '')
    .replace(/(\d+)\s+(мл|л|г|кг|шт|порц)\b/gi, '$1$2')
    .trim();
}


function lineLooksLikeTtkTitleMeasure(value) {
  return /^\d+\s*(?:мл|л|г|кг|шт|порц)\b/i.test(cleanTtkText(value));
}

function normalizeTtkContentTitleLines(content) {
  const lines = String(content || '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const cleaned = cleanTtkText(line);
    if (/^Блюдо\/напиток:/i.test(cleaned)) {
      const pieces = [cleaned.replace(/^Блюдо\/напиток:\s*/i, '')];
      while (i + 1 < lines.length && lineLooksLikeTtkTitleMeasure(lines[i + 1])) {
        i += 1;
        pieces.push(cleanTtkText(lines[i]));
      }
      out.push(`Блюдо/напиток: ${normalizeTtkTitle(pieces.join(' '))}`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

function collectTtkTitleFromLines(lines) {
  const titleLines = [];
  for (const line of lines) {
    const cleaned = normalizeTtkTitle(line);
    if (!cleaned || /^Название на чеке:?$/i.test(cleaned)) continue;
    if (lineLooksLikeTtkName(cleaned) || (titleLines.length && titleContinuationLooksLikeMeasure(cleaned))) {
      titleLines.push(cleaned);
    }
  }
  return normalizeTtkTitle(titleLines.join(' '));
}

function takeTrailingTtkTitleLines(lines) {
  const lead = [];
  let trimFrom = lines.length;
  let sawCandidate = false;

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i -= 1) {
    const cleaned = cleanTtkText(lines[i]);
    if (!cleaned) {
      if (sawCandidate) trimFrom = i;
      continue;
    }
    if (/^Название на чеке:?$/i.test(cleaned)) {
      sawCandidate = true;
      trimFrom = i;
      continue;
    }
    const normalized = normalizeTtkTitle(cleaned);
    if (lineLooksLikeTtkName(normalized) || (lead.length && titleContinuationLooksLikeMeasure(normalized))) {
      sawCandidate = true;
      lead.unshift(normalized);
      trimFrom = i;
      continue;
    }
    break;
  }

  return { titleLines: lead, trimFrom: sawCandidate ? trimFrom : lines.length };
}

function splitTtkBlocks(text) {
  const rows = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let current = [];
  let pendingBeforeFirstHeader = [];

  rows.forEach((row) => {
    const cleaned = cleanTtkText(row);
    const isHeader = /Технологическая карта\s*(?:№|No|Nº|N)\s*\d+/i.test(cleaned);

    if (isHeader) {
      let lead = [];
      if (current.length) {
        const extracted = takeTrailingTtkTitleLines(current);
        lead = extracted.titleLines;
        const previous = current.slice(0, extracted.trimFrom).join('\n').trim();
        if (previous) blocks.push(previous);
      } else {
        lead = takeTrailingTtkTitleLines(pendingBeforeFirstHeader).titleLines;
      }
      current = [...lead, row];
      pendingBeforeFirstHeader = [];
      return;
    }

    if (current.length) {
      current.push(row);
    } else {
      pendingBeforeFirstHeader.push(row);
      if (pendingBeforeFirstHeader.length > 12) pendingBeforeFirstHeader.shift();
    }
  });

  const last = current.join('\n').trim();
  if (last) blocks.push(last);
  return blocks.length ? blocks : [String(text || '')];
}

function parseTtkTitle(source, lines) {
  const headerIndex = lines.findIndex(line => /Технологическая карта\s*(?:№|No|Nº|N)\s*\d+/i.test(line));
  if (headerIndex > 0) {
    const titleBeforeHeader = collectTtkTitleFromLines(lines.slice(0, headerIndex));
    if (titleBeforeHeader) return titleBeforeHeader;
  }

  const dateIndex = lines.findIndex(line => /\d{2}\.\d{2}\.\d{4}/.test(line));
  if (dateIndex >= 0) {
    const titleLines = [];
    const dateLine = lines[dateIndex];
    const sameLineTitle = cleanTtkText(dateLine.replace(/^.*?\d{2}\.\d{2}\.\d{4}/, ''));
    if (lineLooksLikeTtkName(sameLineTitle)) titleLines.push(sameLineTitle);
    for (let i = dateIndex + 1; i < Math.min(lines.length, dateIndex + 7); i += 1) {
      if (/^(Название на чеке|Область применения|Хранение|Срок Хранения|Органолептические|№\s*Наименование)/i.test(lines[i])) break;
      if (lineLooksLikeTtkName(lines[i]) || (titleLines.length && titleContinuationLooksLikeMeasure(lines[i]))) titleLines.push(lines[i]);
    }
    const title = normalizeTtkTitle(titleLines.join(' '));
    if (title) return title;
  }
  const beforeHeader = source.split(/Технологическая карта\s*(?:№|No|Nº|N)/i)[0] || '';
  const beforeTitle = beforeHeader.split('\n').map(line => cleanTtkText(line)).filter(lineLooksLikeTtkName).slice(-2).join(' ');
  if (beforeTitle) return normalizeTtkTitle(beforeTitle);
  const afterOrganoleptic = source.match(/Органолептические показатели:\s*([\s\S]*?)(?:NoНаименование|№\s*Наименование|Наименование продукта|Брутто в ед)/i)?.[1] || '';
  const fallback = afterOrganoleptic.split('\n').map(line => cleanTtkText(line)).filter(lineLooksLikeTtkName).slice(0, 2).join(' ');
  return normalizeTtkTitle(fallback);
}

function extractTtkAmountsAndTail(value) {
  let text = cleanTtkText(value);
  const amounts = [];
  while (true) {
    const match = text.match(/^(\d+[,.]\d{3})(.*)$/);
    if (!match) break;
    amounts.push(match[1]);
    text = cleanTtkText(match[2]);
  }
  if (!amounts.length) {
    const loose = text.match(/\d+[,.]\d+/g) || [];
    loose.forEach(item => amounts.push(item));
    if (loose.length) text = cleanTtkText(text.replace(/^(?:\d+[,.]\d+\s*)+/, ''));
  }
  return { amounts, tail: text };
}

function lineIsTtkRowStart(line) {
  return /^\d+\s*(?:кг|г|л|мл|шт\.?|порц\.?)$/i.test(cleanTtkText(line)) || /^\d+\s+.+?\s+(?:кг|г|л|мл|шт\.?|порц\.?)\b/i.test(cleanTtkText(line));
}

function findTtkNameAfter(lines, startIndex) {
  for (let j = startIndex; j < Math.min(lines.length, startIndex + 7); j += 1) {
    const candidate = cleanTtkText(lines[j]);
    if (!candidate) continue;
    if (lineIsTtkRowStart(candidate) || /^ИТОГО/i.test(candidate)) break;
    if (lineLooksLikeTtkName(candidate)) return normalizeTtkIngredientName(candidate);
  }
  return '';
}

function addTtkIngredient(ingredients, name, unit, amounts) {
  const cleanName = normalizeTtkIngredientName(name);
  const cleanUnit = cleanTtkText(unit).replace(/\.$/, '');
  const rawQty = amounts[amounts.length - 1];
  const qty = parseTtkNumber(rawQty);
  if (!cleanName || !cleanUnit || qty === null) return;
  if (isTtkIngredientNameNoise(cleanName)) return;
  if (!/[а-яёa-z0-9"«»]/i.test(cleanName)) return;
  const key = `${cleanName.toLowerCase()}::${cleanUnit.toLowerCase()}::${qty}`;
  if (!ingredients.some(item => `${item.name.toLowerCase()}::${item.unit.toLowerCase()}::${item.qty}` === key)) {
    ingredients.push({ name: cleanName, unit: cleanUnit, qty, display_qty: String(rawQty || qty).replace('.', ',') });
  }
}

function stripTtkTechnologyText(line) {
  return cleanTtkText(String(line || '')
    .replace(/ТРЕБОВАНИЯ\s+К\s+ОФОРМЛЕНИЮ[\s\S]*$/i, '')
    .replace(/РЕАЛИЗАЦИИ[\s\S]*$/i, ''));
}

function lineIsTtkNoise(line) {
  const text = cleanTtkText(line);
  if (!text) return true;
  if (/^(Название на чеке|Область применения|Хранение|Срок Хранения|Органолептические|Технологическая карта)/i.test(text)) return true;
  if (/^(№|Наименование продукта|Ед\.?\s*изм|Брутто|Вес брутто|Вес нетто|Вес готового|Технология приготовления)/i.test(text)) return true;
  if (/^(ТРЕБОВАНИЯ|РЕАЛИЗАЦИИ|ИТОГО|вес готового блюда)/i.test(text)) return true;
  return false;
}

function lineIsIngredientContinuation(line) {
  const text = stripTtkTechnologyText(line);
  if (!text || lineIsTtkNoise(text)) return false;
  if (/^\d+\s+/.test(text) || /^\d+[,.]\d+/.test(text)) return false;
  return /[а-яёa-z\"«»()-]/i.test(text);
}

function collectTtkNameAroundLine(rawLines, index, inlineName) {
  const before = [];
  for (let i = index - 1; i >= Math.max(0, index - 4); i -= 1) {
    const candidate = stripTtkTechnologyText(rawLines[i]);
    if (!lineIsIngredientContinuation(candidate)) break;
    before.unshift(candidate);
  }

  const after = [];
  for (let i = index + 1; i < Math.min(rawLines.length, index + 4); i += 1) {
    const candidate = stripTtkTechnologyText(rawLines[i]);
    if (!lineIsIngredientContinuation(candidate)) break;
    after.push(candidate);
  }

  return normalizeTtkIngredientName([...before, inlineName, ...after].filter(Boolean).join(' '));
}

function parseTtkRowsFromLayout(source) {
  const rawLines = String(source || '').replace(/\r/g, '').split('\n');
  const ingredients = [];
  const amountSequence = '((?:\\d+[,.]\\d+\\s+){1,4}\\d+[,.]\\d+)';
  const rowPattern = new RegExp('^\\s*(\\d+)\\s+(.*?)\\s+(кг|г|л|мл|шт\\.?|порц\\.?)\\s+' + amountSequence + '\\b', 'i');
  const compactRowPattern = new RegExp('^\\s*(\\d+)\\s+(кг|г|л|мл|шт\\.?|порц\\.?)\\s+' + amountSequence + '\\b', 'i');

  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    const cleaned = stripTtkTechnologyText(raw);
    if (!cleaned || /^ИТОГО/i.test(cleaned)) continue;
    const match = cleaned.match(rowPattern);
    const compactMatch = match ? null : cleaned.match(compactRowPattern);
    if (!match && !compactMatch) continue;

    const inlineName = normalizeTtkIngredientName(match ? match[2] : '');
    const unit = match ? match[3] : compactMatch[2];
    const amountText = match ? match[4] : compactMatch[3];
    const name = collectTtkNameAroundLine(rawLines, i, inlineName);
    const amounts = amountText.match(/\d+[,.]\d+/g) || [];
    addTtkIngredient(ingredients, name, unit, amounts);
  }

  return ingredients;
}

async function renderPdfPageAsLayoutRows(pageData) {
  const textContent = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
  const rows = [];
  const tolerance = 2.6;
  const items = (textContent.items || [])
    .map((item) => ({
      text: cleanTtkText(item.str || ''),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0)
    }))
    .filter((item) => item.text);

  items.forEach((item) => {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  });

  return rows
    .sort((a, b) => b.y - a.y)
    .map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' '))
    .join('\n');
}

function parseTtkBlock(block) {
  const source = String(block || '').replace(/\r/g, '');
  const number = cleanTtkText(source.match(/Технологическая карта\s*(?:№|No|Nº|N)\s*(\d+)/i)?.[1] || source.match(/^\s*(\d+)/)?.[1] || '');
  const date = cleanTtkText(source.match(/(\d{2}\.\d{2}\.\d{4})/)?.[1] || '');
  const lines = source.split('\n').map(line => cleanTtkText(line)).filter(Boolean);
  const title = parseTtkTitle(source, lines) || (number ? `ТТК № ${number}` : 'ТТК');
  const ingredients = parseTtkRowsFromLayout(source);

  if (!ingredients.length) for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fullRow = line.match(/^(\d+)\s+(.+?)\s+(кг|г|л|мл|шт\.?|порц\.?)\s+(.+)$/i);
    if (fullRow) {
      const parsed = extractTtkAmountsAndTail(fullRow[4]);
      addTtkIngredient(ingredients, fullRow[2], fullRow[3], parsed.amounts);
      continue;
    }

    const compactRow = line.match(/^(\d+)\s*(кг|г|л|мл|шт\.?|порц\.?)$/i);
    if (compactRow) {
      const amountLine = cleanTtkText(lines[i + 1] || '');
      const parsed = extractTtkAmountsAndTail(amountLine);
      const name = parsed.tail ? normalizeTtkIngredientName(parsed.tail) : findTtkNameAfter(lines, i + 2);
      addTtkIngredient(ingredients, name, compactRow[2], parsed.amounts);
      continue;
    }
  }

  return {
    number,
    date,
    title,
    ingredients: ingredients.filter(item => item?.name && !isTtkIngredientNameNoise(item.name))
  };
}

async function parseTtkPdfBuffer(buffer) {
  const mod = await import('pdf-parse');
  const pdfParse = mod.default || mod;
  let parsed;
  try {
    parsed = await pdfParse(buffer, { pagerender: renderPdfPageAsLayoutRows });
  } catch (error) {
    parsed = await pdfParse(buffer);
  }
  const text = parsed.text || '';
  const parts = splitTtkBlocks(text).map(part => part.trim()).filter(Boolean);
  const cards = (parts.length ? parts : [text])
    .map(parseTtkBlock)
    .filter(card => card.number || card.ingredients.length);
  return { text, cards };
}

function buildTtkContent(card) {
  const lines = [];
  lines.push(`Технологическая карта${card.number ? ` № ${card.number}` : ''}`);
  if (card.date) lines.push(`Дата: ${card.date}`);
  if (card.title) lines.push(`Блюдо/напиток: ${normalizeTtkTitle(card.title)}`);
  lines.push('');
  lines.push('Состав:');
  const cleanIngredients = Array.isArray(card.ingredients)
    ? card.ingredients.filter(item => item?.name && !isTtkIngredientNameNoise(item.name))
    : [];
  if (cleanIngredients.length) {
    cleanIngredients.forEach(item => lines.push(`- ${item.name}: ${item.display_qty || item.qty} ${item.unit}`));
  } else {
    lines.push('- Состав не удалось извлечь автоматически. Проверьте PDF и заполните вручную.');
  }
  return lines.join('\n');
}

function sanitizeTtkDocumentForResponse(doc) {
  if (!doc || doc.type !== 'ttk') return doc;
  const cleanIngredients = Array.isArray(doc.ingredients)
    ? doc.ingredients.filter(item => item?.name && !isTtkIngredientNameNoise(item.name))
    : [];
  const cleanContent = normalizeTtkContentTitleLines(String(doc.content || ''))
    .split('\n')
    .filter(line => {
      const text = cleanTtkText(line.replace(/^[-–—]\s*/, '').split(':')[0]);
      return !isTtkIngredientNameNoise(text);
    })
    .join('\n');
  return { ...doc, title: normalizeTtkTitle(doc.title || ''), ingredients: cleanIngredients, content: cleanContent };
}
function makeAssignmentsForTask(task) {
  const creator = db.users.find(user => user.id === task.created_by && user.restaurant_id === task.restaurant_id);
  const seniorRecipientRoles = SENIOR_ROLES.includes(creator?.role) ? taskRecipientRolesForUser(creator) : null;
  const candidates = db.users.filter(u => u.restaurant_id === task.restaurant_id && u.active && STAFF_ROLES.includes(u.role));
  const selected = candidates.filter(u => {
    if (task.target_department && u.department !== task.target_department) return false;
    if (seniorRecipientRoles && !seniorRecipientRoles.includes(u.role)) return false;
    if (task.target_type === 'all') return true;
    if (task.target_type === 'role') return u.role === task.target_role;
    if (task.target_type === 'user') return u.id === task.target_user_id;
    return false;
  });
  selected.forEach(u => {
    const exists = db.task_assignments.some(a => a.task_id === task.id && a.user_id === u.id);
    if (!exists) db.task_assignments.push({ id: uid('tasg'), restaurant_id: task.restaurant_id, task_id: task.id, user_id: u.id, done: false, comment: '', completed_at: null });
  });
}

function collection(name) {
  if (!Array.isArray(db[name])) db[name] = [];
  return db[name];
}

function supportTicketDetails(ticket) {
  const messages = collection('support_messages')
    .filter(message => message.ticket_id === ticket.id)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .map(message => ({
      ...message,
      user: publicUser(db.users.find(user => user.id === message.user_id))
    }));
  const clientUnreadCount = messages.filter(message => (
    message.author_type === 'platform'
    && (!ticket.client_read_at || String(message.created_at || '') > String(ticket.client_read_at || ''))
  )).length;
  const platformUnreadCount = messages.filter(message => (
    message.author_type === 'client'
    && (!ticket.platform_read_at || String(message.created_at || '') > String(ticket.platform_read_at || ''))
  )).length;
  return {
    ...ticket,
    restaurant: db.restaurants.find(restaurant => restaurant.id === ticket.restaurant_id) || null,
    created_by_user: publicUser(db.users.find(user => user.id === ticket.created_by)),
    client_unread_count: clientUnreadCount,
    platform_unread_count: platformUnreadCount,
    messages
  };
}

function canUseClientSupport(req) {
  return Boolean(req.user?.restaurant_id && ['owner', 'manager'].includes(req.user.role));
}

function actorName(userId) {
  return db.users.find(u => u.id === userId)?.name || 'Система';
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function sendCsv(res, filename, rows) {
  const csv = rows.map(row => row.map(csvEscape).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(`\ufeff${csv}`);
}

function billingAccess(req, res, next) {
  if (req.user?.is_super_admin || ['owner', 'manager'].includes(req.user?.role)) return next();
  return res.status(403).json({ error: 'Доступ к оплате только для владельца или менеджера' });
}

function getBillingProfile(restaurantId) {
  return sameRestaurant(collection('billing_profiles'), restaurantId)[0] || null;
}

function publicBillingProfile(profile) {
  if (!profile) return null;
  return {
    customer_type: profile.customer_type || 'ip',
    legal_name: profile.legal_name || '',
    inn: profile.inn || '',
    kpp: profile.kpp || '',
    ogrn: profile.ogrn || '',
    legal_address: profile.legal_address || '',
    bank_name: profile.bank_name || '',
    bik: profile.bik || '',
    checking_account: profile.checking_account || '',
    correspondent_account: profile.correspondent_account || '',
    edo_operator: profile.edo_operator || '',
    edo_id: profile.edo_id || '',
    email: profile.email || '',
    phone: profile.phone || ''
  };
}

function validateBillingProfile(profile) {
  if (!profile?.legal_name) return 'Укажите юридическое название';
  if (!profile?.inn) return 'Укажите ИНН';
  if (!profile?.legal_address) return 'Укажите юридический адрес';
  if (!profile?.bank_name) return 'Укажите банк';
  if (!profile?.bik) return 'Укажите БИК';
  if (!profile?.checking_account) return 'Укажите расчётный счёт';
  return '';
}

function billingPlan(planId) {
  return billingPlans.find(plan => plan.id === planId) || billingPlans.find(plan => plan.id === 'standard') || billingPlans[0];
}

function cleanBillingFields(source = {}, fields = []) {
  return fields.reduce((result, field) => {
    result[field] = String(source[field] ?? '').trim();
    return result;
  }, {});
}

function billingSettingsRecord() {
  return collection('platform_settings').find(item => item.key === 'billing_requisites') || null;
}

function platformBillingSettings() {
  let value = billingSettingsRecord()?.value || {};
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = {};
    }
  }
  return {
    seller: value.seller || {},
    transfer: value.transfer || {}
  };
}

function savePlatformBillingSettings(settings) {
  let record = billingSettingsRecord();
  if (!record) {
    record = { id: uid('pset'), key: 'billing_requisites', value: {}, created_at: nowIso(), updated_at: nowIso() };
    collection('platform_settings').push(record);
  }
  record.value = settings;
  record.updated_at = nowIso();
  return record;
}

function sequenceNumber(prefix, items) {
  const year = new Date().getFullYear();
  const sameYearCount = items.filter(item => String(item.number || '').startsWith(`${prefix}-${year}-`)).length + 1;
  return `${prefix}-${year}-${String(sameYearCount).padStart(4, '0')}`;
}

function invoiceNumber() {
  return sequenceNumber('INV', collection('billing_invoices'));
}

function closingDocumentNumber(type = 'act') {
  return sequenceNumber(String(type || 'ACT').toUpperCase(), collection('closing_documents'));
}

function currentSellerRequisites() {
  return { ...defaultSellerRequisites, ...platformBillingSettings().seller };
}

function currentTransferRequisites() {
  return { ...defaultTransferRequisites, ...platformBillingSettings().transfer };
}

function sellerRequisitesReady() {
  const requisites = currentSellerRequisites();
  return Boolean(requisites.legal_name && requisites.inn && requisites.checking_account);
}

function transferRequisitesReady() {
  const requisites = currentTransferRequisites();
  return Boolean(String(requisites.phone || '').trim() || String(requisites.card || '').trim());
}

function addMonthsIso(value, months) {
  const source = value ? new Date(value) : new Date();
  const date = Number.isNaN(source.getTime()) ? new Date() : new Date(source);
  const day = date.getDate();
  date.setMonth(date.getMonth() + Math.max(1, Number(months || 1) || 1));
  if (date.getDate() !== day) date.setDate(0);
  return date.toISOString();
}

function publicPlatformBillingSettings() {
  return {
    seller_requisites: currentSellerRequisites(),
    seller_requisites_ready: sellerRequisitesReady(),
    transfer_requisites: currentTransferRequisites(),
    transfer_requisites_ready: transferRequisitesReady()
  };
}

function restaurantBillingUsers(restaurantId) {
  return db.users.filter(user => user.restaurant_id === restaurantId && user.active && ['owner', 'manager'].includes(user.role));
}

function notifyPlatformBilling(invoice, title, body) {
  logActivity({
    restaurant_id: invoice.restaurant_id,
    actor_id: null,
    type: 'platform_billing_notice',
    title,
    entity_type: 'billing_invoice',
    entity_id: invoice.id,
    metadata: { body }
  });
}

function buildBillingInvoice({ restaurantId, planId = 'standard', months = 1, periodStartValue = null }) {
  const restaurant = db.restaurants.find(r => r.id === restaurantId);
  if (!restaurant) {
    const error = new Error('Ресторан не найден');
    error.status = 404;
    throw error;
  }
  const profile = getBillingProfile(restaurantId);
  const profileError = validateBillingProfile(publicBillingProfile(profile));
  if (profileError) {
    const error = new Error(profileError);
    error.status = 400;
    throw error;
  }
  if (!sellerRequisitesReady()) {
    const error = new Error('Заполните реквизиты для счетов у владельца приложения');
    error.status = 400;
    throw error;
  }
  const plan = billingPlan(String(planId || 'standard'));
  if (plan.id === 'enterprise') {
    const error = new Error('Для Enterprise сформируйте индивидуальный счёт');
    error.status = 400;
    throw error;
  }
  const periodMonths = Math.max(1, Math.min(12, Number(months || 1) || 1));
  const periodStart = periodStartValue ? new Date(periodStartValue) : new Date();
  if (Number.isNaN(periodStart.getTime())) {
    const error = new Error('Некорректное начало периода');
    error.status = 400;
    throw error;
  }
  const amount = Number(plan.monthly_amount || 0) * periodMonths;
  return {
    id: uid('inv'),
    restaurant_id: restaurantId,
    number: invoiceNumber(),
    status: 'issued',
    plan: plan.id,
    plan_title: plan.title,
    months: periodMonths,
    period_start: periodStart.toISOString(),
    period_end: addMonthsIso(periodStart, periodMonths),
    amount,
    currency: 'RUB',
    customer_requisites: publicBillingProfile(profile),
    seller_requisites: currentSellerRequisites(),
    issued_at: nowIso(),
    due_at: addDays(7),
    receipt_url: '',
    receipt_name: '',
    receipt_mime: '',
    receipt_uploaded_at: null,
    paid_at: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

function dateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('ru-RU');
}

function money(value) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function requisitesLines(requisites = {}) {
  return [
    requisites.recipient ? `Получатель: ${requisites.recipient}` : '',
    requisites.legal_name,
    requisites.inn ? `ИНН ${requisites.inn}` : '',
    requisites.kpp ? `КПП ${requisites.kpp}` : '',
    requisites.ogrn ? `ОГРН/ОГРНИП ${requisites.ogrn}` : '',
    requisites.legal_address,
    requisites.bank_name,
    requisites.bik ? `БИК ${requisites.bik}` : '',
    requisites.checking_account ? `р/с ${requisites.checking_account}` : '',
    requisites.correspondent_account ? `к/с ${requisites.correspondent_account}` : '',
    requisites.card ? `Карта ${requisites.card}` : '',
    requisites.email,
    requisites.phone,
    requisites.comment
  ].filter(Boolean);
}

function billingDocumentHtml({ title, number, restaurant, customer, seller, rows, total, footerTitle, footerText }) {
  const serviceRows = rows.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.qty)}</td><td>${money(row.price)}</td><td>${money(row.amount)}</td></tr>`).join('');
  const block = (heading, requisites) => `<section><h2>${escapeHtml(heading)}</h2>${requisitesLines(requisites).map(line => `<p>${escapeHtml(line)}</p>`).join('')}</section>`;
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} ${escapeHtml(number)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 32px; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    h2 { margin: 0 0 8px; font-size: 16px; }
    p { margin: 3px 0; }
    .meta { color: #4b5563; margin-bottom: 24px; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
    section { border: 1px solid #d1d5db; border-radius: 8px; padding: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; }
    .total { text-align: right; font-size: 20px; font-weight: 700; margin-top: 18px; }
    .footer { margin-top: 28px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)} № ${escapeHtml(number)}</h1>
  <div class="meta">${escapeHtml(restaurant?.name || 'Ресторан')} · ${dateOnly(new Date().toISOString())}</div>
  <div class="parties">${block('Поставщик', seller)}${block('Покупатель', customer)}</div>
  <table>
    <thead><tr><th>Услуга</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
    <tbody>${serviceRows}</tbody>
  </table>
  <div class="total">Итого: ${money(total)}</div>
  <div class="footer"><strong>${escapeHtml(footerTitle || '')}</strong><p>${escapeHtml(footerText || '')}</p></div>
</body>
</html>`;
}

function sendHtml(res, filename, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  res.send(html);
}

function logActivity({ restaurant_id, actor_id, type, title, entity_type = '', entity_id = '', metadata = {} }) {
  const event = { id: uid('act'), restaurant_id, actor_id: actor_id || null, type, title, entity_type, entity_id, metadata, created_at: nowIso() };
  collection('activity_events').push(event);
  return event;
}

function notifyUsers(restaurant_id, users, payload) {
  const uniqueUsers = Array.from(new Map(users.filter(Boolean).map(user => [user.id, user])).values());
  uniqueUsers.forEach(user => collection('notifications').push({
    id: uid('ntf'),
    restaurant_id,
    user_id: user.id,
    title: payload.title,
    body: payload.body || '',
    entity_type: payload.entity_type || '',
    entity_id: payload.entity_id || '',
    read_at: null,
    created_at: nowIso()
  }));
}

function notifyManagers(restaurant_id, payload) {
  notifyUsers(restaurant_id, db.users.filter(user => user.restaurant_id === restaurant_id && user.active && MANAGER_ROLES.includes(user.role)), payload);
}

function notifyAssignees(task, payload) {
  notifyUsers(task.restaurant_id, db.task_assignments.filter(a => a.task_id === task.id).map(a => db.users.find(u => u.id === a.user_id && u.active)), payload);
}

function currentOpenShiftFor(user) {
  return collection('shifts').filter(shift => shift.restaurant_id === user.restaurant_id && shift.user_id === user.id && shift.status === 'open').sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')))[0] || null;
}

function eventsBetween(restaurant_id, start, end, user_id = null) {
  return collection('activity_events')
    .filter(event => event.restaurant_id === restaurant_id)
    .filter(event => !user_id || event.actor_id === user_id)
    .filter(event => {
      const created = new Date(event.created_at).getTime();
      return created >= start && created <= end;
    })
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}


// OPERATIONAL LAYER
app.get('/api/shifts/current', auth, ensureRestaurantActive, (req, res) => {
  const current = currentOpenShiftFor(req.user);
  const last_closed = collection('shifts').filter(s => s.restaurant_id === req.user.restaurant_id && s.user_id === req.user.id && s.status === 'closed').sort((a,b)=>String(b.closed_at||'').localeCompare(String(a.closed_at||'')))[0] || null;
  res.json({ current, last_closed });
});

app.post('/api/shifts/start', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const existing = currentOpenShiftFor(req.user);
  if (existing) return res.json(existing);
  const shift = { id: uid('shift'), restaurant_id: req.user.restaurant_id, user_id: req.user.id, role: req.user.role, department: req.user.department, location: String(req.body.location || '').trim(), status: 'open', opened_at: nowIso(), closed_at: null, comment: '' };
  collection('shifts').push(shift);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'shift_started', title: `${req.user.name} начал смену`, entity_type: 'shift', entity_id: shift.id, metadata: { role: req.user.role, department: req.user.department } });
  notifyManagers(req.user.restaurant_id, { title: 'Смена началась', body: `${req.user.name} начал смену`, entity_type: 'shift', entity_id: shift.id });
  await persist();
  res.status(201).json(shift);
}));

app.post('/api/shifts/:id/close', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const shift = collection('shifts').find(s => s.id === req.params.id && s.restaurant_id === req.user.restaurant_id);
  if (!shift) return res.status(404).json({ error: 'Смена не найдена' });
  if (!MANAGER_ROLES.includes(req.user.role) && shift.user_id !== req.user.id) return res.status(403).json({ error: 'Нельзя закрыть чужую смену' });
  shift.status = 'closed';
  shift.closed_at = shift.closed_at || nowIso();
  shift.comment = String(req.body.comment || '').trim();
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'shift_closed', title: `${actorName(shift.user_id)} закрыл смену`, entity_type: 'shift', entity_id: shift.id, metadata: { comment: shift.comment } });
  notifyManagers(req.user.restaurant_id, { title: 'Смена закрыта', body: `${actorName(shift.user_id)} завершил смену`, entity_type: 'shift', entity_id: shift.id });
  await persist();
  res.json(shift);
}));

app.get('/api/notifications', auth, ensureRestaurantActive, (req, res) => {
  res.json(collection('notifications').filter(n => n.restaurant_id === req.user.restaurant_id && n.user_id === req.user.id).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,80));
});

app.post('/api/notifications/read-all', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  collection('notifications').filter(n => n.restaurant_id === req.user.restaurant_id && n.user_id === req.user.id && !n.read_at).forEach(n => { n.read_at = nowIso(); });
  await persist();
  res.json({ ok: true });
}));

app.get('/api/activity', auth, ensureRestaurantActive, (req, res) => {
  const isManager = MANAGER_ROLES.includes(req.user.role);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 40)));
  res.json(collection('activity_events').filter(e => e.restaurant_id === req.user.restaurant_id).filter(e => isManager || e.actor_id === req.user.id || ['task_created'].includes(e.type)).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0, limit).map(e => ({ ...e, actor: publicUser(db.users.find(u => u.id === e.actor_id)) })));
});

app.get('/api/admin/problems', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const openAssignments = sameRestaurant(db.task_assignments, rid).filter(a => !a.done);
  const overdueAssignments = openAssignments.filter(a => {
    const task = db.tasks.find(t => t.id === a.task_id);
    return task?.due_at && new Date(task.due_at).getTime() < now;
  });
  const openTech = sameRestaurant(db.tech_requests, rid).filter(t => !['done', 'cancelled'].includes(t.status));
  const staff = sameRestaurant(db.users, rid).filter(u => u.active && !u.is_super_admin && !MANAGER_ROLES.includes(u.role));
  const requiredDocs = sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active && d.requires_acknowledgement);
  const pendingAck = requiredDocs.reduce((total, doc) => {
    const targets = staff.filter(u => hasRoleAccess(u, doc.allowed_roles));
    const done = db.knowledge_acknowledgements.filter(a => a.document_id === doc.id && a.version === doc.version).length;
    return total + Math.max(0, targets.length - done);
  }, 0);
  const problems = [
    ...overdueAssignments.slice(0, 8).map(a => {
      const task = db.tasks.find(t => t.id === a.task_id);
      const user = db.users.find(u => u.id === a.user_id);
      return { id: `task-${a.id}`, tone: 'danger', title: task?.title || 'Просроченная задача', subtitle: `${user?.name || 'Сотрудник'} · дедлайн ${fmtDate(task?.due_at)}`, type: 'task', type_label: problemTypeLabels.task, entity_id: task?.id || a.task_id };
    }),
    ...openTech.slice(0, 8).map(t => ({ id: `tech-${t.id}`, tone: t.status === 'new' ? 'warning' : 'info', title: t.title, subtitle: `Проблема · ${techRequestStatuses[t.status] || t.status}`, type: 'tech_request', type_label: problemTypeLabels.tech_request, entity_id: t.id }))
  ];
  res.json({ metrics: { open_shifts: collection('shifts').filter(s => s.restaurant_id === rid && s.status === 'open').length, open_tasks: openAssignments.length, overdue_tasks: overdueAssignments.length, open_tech_requests: openTech.length, checklist_runs_today: sameRestaurant(db.checklist_runs, rid).filter(r => String(r.created_at||'').slice(0,10) === today).length, pending_acknowledgements: pendingAck }, problems: problems.slice(0,20) });
});

app.get('/api/comments', auth, ensureRestaurantActive, (req, res) => {
  const entityType = String(req.query.entity_type || '').trim();
  const entityId = String(req.query.entity_id || '').trim();
  if (!entityType || !entityId) return res.status(400).json({ error: 'Нужны entity_type и entity_id' });
  res.json(collection('comments').filter(c => c.restaurant_id === req.user.restaurant_id && c.entity_type === entityType && c.entity_id === entityId).sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))).map(c => ({ ...c, user: publicUser(db.users.find(u => u.id === c.user_id)) })));
});

app.post('/api/comments', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const entityType = String(req.body.entity_type || '').trim();
  const entityId = String(req.body.entity_id || '').trim();
  const body = String(req.body.body || '').trim();
  if (!entityType || !entityId || !body) return res.status(400).json({ error: 'Нужны объект и текст комментария' });
  const comment = { id: uid('cmt'), restaurant_id: req.user.restaurant_id, entity_type: entityType, entity_id: entityId, user_id: req.user.id, body, created_at: nowIso() };
  collection('comments').push(comment);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'comment_created', title: `${req.user.name} оставил комментарий`, entity_type: entityType, entity_id: entityId, metadata: { body } });
  notifyManagers(req.user.restaurant_id, { title: 'Новый комментарий', body: `${req.user.name}: ${body.slice(0,120)}`, entity_type: entityType, entity_id: entityId });
  await persist();
  res.status(201).json({ ...comment, user: publicUser(req.user) });
}));

app.post('/api/offline/sync', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const operations = Array.isArray(req.body.operations) ? req.body.operations : [];
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'offline_sync', title: `${req.user.name} синхронизировал офлайн-действия`, entity_type: 'offline', entity_id: '', metadata: { count: operations.length } });
  await persist();
  res.json({ ok: true, accepted: operations.length });
}));

app.get('/api/reports/shift/export.csv', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  let shift = String(req.query.shift_id || '').trim() ? collection('shifts').find(s => s.id === req.query.shift_id && s.restaurant_id === rid) : currentOpenShiftFor(req.user);
  if (!shift) shift = collection('shifts').filter(s => s.restaurant_id === rid && s.user_id === req.user.id).sort((a,b)=>String(b.opened_at||'').localeCompare(String(a.opened_at||'')))[0];
  if (!shift) return res.status(404).json({ error: 'Смена не найдена' });
  if (!MANAGER_ROLES.includes(req.user.role) && shift.user_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа к отчёту смены' });
  const start = new Date(shift.opened_at).getTime();
  const end = shift.closed_at ? new Date(shift.closed_at).getTime() : Date.now();
  const rows = [['Дата','Событие','Сотрудник','Тип','Объект','Комментарий'], [fmtDate(shift.opened_at),'Смена начата',actorName(shift.user_id),'shift',shift.id,shift.location||''], ...eventsBetween(rid,start,end,shift.user_id).map(e => [fmtDate(e.created_at), e.title, actorName(e.actor_id), e.type, e.entity_type, e.metadata?.comment || e.metadata?.body || ''])];
  if (shift.closed_at) rows.push([fmtDate(shift.closed_at),'Смена закрыта',actorName(shift.user_id),'shift',shift.id,shift.comment||'']);
  sendCsv(res, `shift-${shift.id}.csv`, rows);
});

app.get('/api/admin/reports/operations.csv', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const rows = [['Дата','Сотрудник','Тип','Событие','Объект','Комментарий'], ...collection('activity_events').filter(e => e.restaurant_id === rid).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,1000).map(e => [fmtDate(e.created_at), actorName(e.actor_id), e.type, e.title, e.entity_type, e.metadata?.comment || e.metadata?.body || ''])];
  sendCsv(res, `operations-${rid}.csv`, rows);
});



app.get('/api/admin/integrations/iiko', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const integration = getIikoIntegration(rid);
  const mappings = sameRestaurant(db.external_mappings, rid).filter(item => item.provider === 'iiko');
  const events = sameRestaurant(db.integration_events, rid)
    .filter(item => item.provider === 'iiko')
    .sort((a, b) => String(b.received_at || '').localeCompare(String(a.received_at || '')))
    .slice(0, 10);
  res.json({
    integration: publicIntegration(integration),
    mappings: {
      employees: mappings.filter(item => item.entity_type === 'employee').length,
      tables: mappings.filter(item => item.entity_type === 'table').length,
      halls: mappings.filter(item => item.entity_type === 'hall').length,
      bookings: mappings.filter(item => item.entity_type === 'booking').length,
      shifts: mappings.filter(item => item.entity_type === 'shift').length
    },
    events
  });
});

app.post('/api/admin/integrations/iiko', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const body = req.body || {};
  const apiLogin = String(body.api_login || '').trim();
  let integration = getIikoIntegration(rid);
  if (!integration) {
    integration = {
      id: uid('int'),
      restaurant_id: rid,
      provider: 'iiko',
      status: 'draft',
      api_login_encrypted: '',
      organization_id: '',
      terminal_group_id: '',
      sync_interval_seconds: 60,
      sync_bookings: true,
      sync_shifts: true,
      last_sync_at: null,
      last_error: '',
      created_at: nowIso(),
      updated_at: nowIso()
    };
    db.integrations.push(integration);
  }

  if (body.autonomous === true) integration.api_login_encrypted = '';
  if (apiLogin) integration.api_login_encrypted = encryptSecret(apiLogin);
  const hasApiLogin = Boolean(integration.api_login_encrypted);
  integration.organization_id = String(hasApiLogin ? (body.organization_id ?? integration.organization_id ?? '') : '').trim();
  integration.terminal_group_id = String(hasApiLogin ? (body.terminal_group_id ?? integration.terminal_group_id ?? '') : '').trim();
  integration.sync_interval_seconds = Math.max(30, Math.min(900, Number(body.sync_interval_seconds || integration.sync_interval_seconds || 60)));
  integration.sync_bookings = hasApiLogin && body.sync_bookings !== false;
  integration.sync_shifts = hasApiLogin && body.sync_shifts !== false;
  integration.status = hasApiLogin ? 'connected' : 'autonomous';
  integration.last_error = '';
  integration.updated_at = nowIso();

  integrationEvent(rid, 'settings_updated', { mode: hasApiLogin ? 'iiko_cloud' : 'autonomous', organization_id: integration.organization_id, terminal_group_id: integration.terminal_group_id }, 'processed');
  await persist();
  res.json({ integration: publicIntegration(integration) });
}));

app.post('/api/admin/integrations/iiko/test', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const integration = getIikoIntegration(rid);
  const apiLogin = decryptSecret(integration?.api_login_encrypted);
  if (!apiLogin) {
    integrationEvent(rid, 'connection_tested', { mode: 'autonomous' }, 'processed');
    await persist();
    return res.json({ ok: true, autonomous: true, organizations: [], message: 'API-ключ не указан. Приложение работает автономно.' });
  }

  try {
    const authData = await iikoCloudRequest('/api/1/access_token', { apiLogin });
    const token = authData.token || authData.accessToken || authData.access_token;
    if (!token) throw new Error('iiko не вернула токен доступа');
    const organizationsData = await iikoCloudRequest('/api/1/organizations', { returnAdditionalInfo: true, includeDisabled: false }, token);
    integration.status = 'connected';
    integration.last_error = '';
    integration.updated_at = nowIso();
    integrationEvent(rid, 'connection_tested', { organizations: organizationsData.organizations || [] }, 'processed');
    await persist();
    res.json({ ok: true, organizations: organizationsData.organizations || [] });
  } catch (error) {
    integration.status = 'error';
    integration.last_error = error.message || 'Ошибка подключения iiko';
    integration.updated_at = nowIso();
    integrationEvent(rid, 'connection_tested', { error: integration.last_error }, 'failed', integration.last_error);
    await persist();
    res.status(400).json({ error: integration.last_error });
  }
}));

app.post('/api/admin/integrations/iiko/sync', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const integration = getIikoIntegration(rid);
  const apiLogin = decryptSecret(integration?.api_login_encrypted);
  if (!integration || !apiLogin) {
    integrationEvent(rid, 'cloud_sync_skipped', { mode: 'autonomous' }, 'processed');
    await persist();
    return res.json({
      ok: true,
      autonomous: true,
      integration: publicIntegration(integration),
      organizations: [],
      message: 'API-ключ не указан. Синхронизация iiko пропущена, приложение работает на локальных бронях и сменах.'
    });
  }

  try {
    const authData = await iikoCloudRequest('/api/1/access_token', { apiLogin });
    const token = authData.token || authData.accessToken || authData.access_token;
    if (!token) throw new Error('iiko не вернула токен доступа');
    const organizationsData = await iikoCloudRequest('/api/1/organizations', { returnAdditionalInfo: true, includeDisabled: false }, token);
    const organizations = organizationsData.organizations || [];
    const selectedOrganization = integration.organization_id
      ? organizations.find(org => org.id === integration.organization_id)
      : organizations[0];

    if (selectedOrganization && !integration.organization_id) integration.organization_id = selectedOrganization.id;
    integration.status = 'connected';
    integration.last_sync_at = nowIso();
    integration.last_error = '';
    integration.updated_at = nowIso();
    integrationEvent(rid, 'cloud_sync', { organizations_count: organizations.length, selected_organization_id: integration.organization_id }, 'processed');
    await persist();

    res.json({
      ok: true,
      integration: publicIntegration(integration),
      organizations,
      message: 'Базовая связь с iiko проверена. Следующий шаг — маппинг сотрудников, залов и столов.'
    });
  } catch (error) {
    integration.status = 'error';
    integration.last_error = error.message || 'Ошибка синхронизации iiko';
    integration.updated_at = nowIso();
    integrationEvent(rid, 'cloud_sync', { error: integration.last_error }, 'failed', integration.last_error);
    await persist();
    res.status(400).json({ error: integration.last_error });
  }
}));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'Resto Control MVP', time: nowIso() });
});

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body;
  const user = db.users.find(u => u.login === String(login || '').trim() && u.password_hash === hashPassword(String(password || '')) && u.active);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const restaurant = user.restaurant_id ? db.restaurants.find(r => r.id === user.restaurant_id) : null;
  res.json({ token: sign(user), user: publicUser(user), restaurant, restaurant_status: restaurantStatus(restaurant) });
});

app.post('/api/auth/register-restaurant', runAsync(async (req, res) => {
  const { restaurantName, ownerName, phone, email, city, login, password } = req.body;
  if (!restaurantName || !ownerName || !login || !password) return res.status(400).json({ error: 'Заполните ресторан, имя владельца, логин и пароль' });
  if (db.users.some(u => u.login === login)) return res.status(409).json({ error: 'Такой логин уже занят' });
  const restaurant = createRestaurantWithDefaults(db, {
    name: restaurantName,
    owner_name: ownerName,
    phone,
    email,
    city,
    login,
    password,
    subscription_status: 'trial',
    trial_ends_at: addDays(process.env.TRIAL_DAYS || 14)
  });
  await persist();
  const user = db.users.find(u => u.restaurant_id === restaurant.id && u.login === login);
  res.status(201).json({ token: sign(user), user: publicUser(user), restaurant, trial_days: Number(process.env.TRIAL_DAYS || 14) });
}));

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user), restaurant: req.restaurant, restaurant_status: restaurantStatus(req.restaurant) });
});

// SUPER ADMIN
app.get('/api/super/restaurants', auth, superOnly, (req, res) => {
  const rows = db.restaurants.map(r => {
    const users = db.users.filter(u => u.restaurant_id === r.id);
    const invoices = collection('billing_invoices')
      .filter(invoice => invoice.restaurant_id === r.id)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return {
      ...r,
      computed_status: restaurantStatus(r),
      users_count: users.length,
      checklist_runs_count: db.checklist_runs.filter(x => x.restaurant_id === r.id).length,
      billing_invoices_count: invoices.length,
      pending_transfer_count: invoices.filter(invoice => ['transfer_pending', 'payment_reported', 'payment_document_attached'].includes(invoice.status)).length,
      receipt_invoices_count: invoices.filter(invoice => invoice.receipt_url).length,
      latest_invoice: invoices[0] || null
    };
  });
  res.json(rows);
});

app.post('/api/super/restaurants', auth, superOnly, runAsync(async (req, res) => {
  const { name, owner_name, city, phone, email, login, password } = req.body;
  if (!name || !owner_name || !login || !password) return res.status(400).json({ error: 'Заполните ресторан, владельца, логин и пароль' });
  if (db.users.some(u => u.login === login)) return res.status(409).json({ error: 'Логин уже занят' });
  const restaurant = createRestaurantWithDefaults(db, { name, owner_name, city, phone, email, login, password });
  await persist();
  res.status(201).json(restaurant);
}));

app.patch('/api/super/restaurants/:id/subscription', auth, superOnly, runAsync(async (req, res) => {
  const restaurant = db.restaurants.find(r => r.id === req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Ресторан не найден' });
  const { status, days, plan } = req.body;
  if (status) restaurant.subscription_status = status;
  if (plan) restaurant.plan = plan;
  if (Number(days) > 0) {
    restaurant.subscription_status = 'active';
    restaurant.subscription_started_at = nowIso();
    restaurant.subscription_ends_at = addDays(Number(days));
  }
  await persist();
  res.json(restaurant);
}));

app.get('/api/super/billing/settings', auth, superOnly, (req, res) => {
  res.json(publicPlatformBillingSettings());
});

app.patch('/api/super/billing/settings', auth, superOnly, runAsync(async (req, res) => {
  const body = req.body || {};
  const settings = {
    seller: cleanBillingFields(body.seller_requisites || body.seller || {}, sellerRequisiteFields),
    transfer: cleanBillingFields(body.transfer_requisites || body.transfer || {}, transferRequisiteFields)
  };
  savePlatformBillingSettings(settings);
  await persist();
  res.json(publicPlatformBillingSettings());
}));

app.get('/api/super/support/tickets', auth, superOnly, (req, res) => {
  const rows = collection('support_tickets')
    .map(supportTicketDetails)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  res.json(rows);
});

app.post('/api/super/support/tickets/:id/messages', auth, superOnly, runAsync(async (req, res) => {
  const ticket = collection('support_tickets').find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Введите ответ' });
  const message = {
    id: uid('supmsg'),
    restaurant_id: ticket.restaurant_id,
    ticket_id: ticket.id,
    user_id: req.user.id,
    author_type: 'platform',
    body,
    created_at: nowIso()
  };
  collection('support_messages').push(message);
  ticket.status = 'answered';
  ticket.platform_read_at = message.created_at;
  ticket.updated_at = message.created_at;
  ticket.closed_at = null;
  notifyUsers(ticket.restaurant_id, db.users.filter(user => user.restaurant_id === ticket.restaurant_id && user.role === 'owner'), { title: 'Ответ техподдержки', body: ticket.subject, entity_type: 'support_ticket', entity_id: ticket.id });
  await persist();
  res.status(201).json(supportTicketDetails(ticket));
}));

app.patch('/api/super/support/tickets/:id', auth, superOnly, runAsync(async (req, res) => {
  const ticket = collection('support_tickets').find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
  const status = String(req.body?.status || '').trim();
  if (!['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: 'Некорректный статус обращения' });
  ticket.status = status;
  ticket.updated_at = nowIso();
  ticket.closed_at = status === 'closed' ? nowIso() : null;
  await persist();
  res.json(supportTicketDetails(ticket));
}));

app.post('/api/super/support/tickets/:id/read', auth, superOnly, runAsync(async (req, res) => {
  const ticket = collection('support_tickets').find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
  ticket.platform_read_at = nowIso();
  await persist();
  res.json(supportTicketDetails(ticket));
}));

app.get('/api/support/tickets', auth, (req, res) => {
  if (!canUseClientSupport(req)) return res.status(403).json({ error: 'Поддержка доступна владельцу и менеджеру ресторана' });
  const rows = sameRestaurant(collection('support_tickets'), req.user.restaurant_id)
    .map(supportTicketDetails)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  res.json(rows);
});

app.post('/api/support/tickets', auth, runAsync(async (req, res) => {
  if (!canUseClientSupport(req)) return res.status(403).json({ error: 'Поддержка доступна владельцу и менеджеру ресторана' });
  const subject = String(req.body?.subject || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!subject || !body) return res.status(400).json({ error: 'Введите тему и сообщение' });
  const createdAt = nowIso();
  const ticket = {
    id: uid('supt'),
    restaurant_id: req.user.restaurant_id,
    created_by: req.user.id,
    subject,
    status: 'open',
    client_read_at: createdAt,
    platform_read_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    closed_at: null
  };
  const message = {
    id: uid('supmsg'),
    restaurant_id: req.user.restaurant_id,
    ticket_id: ticket.id,
    user_id: req.user.id,
    author_type: 'client',
    body,
    created_at: createdAt
  };
  collection('support_tickets').push(ticket);
  collection('support_messages').push(message);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'support_ticket_created', title: `${req.user.name} написал в техподдержку`, entity_type: 'support_ticket', entity_id: ticket.id, metadata: { subject } });
  await persist();
  res.status(201).json(supportTicketDetails(ticket));
}));

app.post('/api/support/tickets/:id/messages', auth, runAsync(async (req, res) => {
  if (!canUseClientSupport(req)) return res.status(403).json({ error: 'Поддержка доступна владельцу и менеджеру ресторана' });
  const ticket = sameRestaurant(collection('support_tickets'), req.user.restaurant_id).find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Введите сообщение' });
  const message = {
    id: uid('supmsg'),
    restaurant_id: req.user.restaurant_id,
    ticket_id: ticket.id,
    user_id: req.user.id,
    author_type: 'client',
    body,
    created_at: nowIso()
  };
  collection('support_messages').push(message);
  ticket.status = 'open';
  ticket.client_read_at = message.created_at;
  ticket.updated_at = message.created_at;
  ticket.closed_at = null;
  await persist();
  res.status(201).json(supportTicketDetails(ticket));
}));

app.post('/api/support/tickets/:id/read', auth, runAsync(async (req, res) => {
  if (!canUseClientSupport(req)) return res.status(403).json({ error: 'Поддержка доступна владельцу и менеджеру ресторана' });
  const ticket = sameRestaurant(collection('support_tickets'), req.user.restaurant_id).find(item => item.id === req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено' });
  ticket.client_read_at = nowIso();
  await persist();
  res.json(supportTicketDetails(ticket));
}));

// RESTAURANT OVERVIEW
app.get('/api/admin/overview', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.is_super_admin ? req.query.restaurant_id : req.user.restaurant_id;
  const today = todayKey();
  const taskRange = normalizeDateRange(req.query, 'task_from', 'task_to');
  const now = Date.now();
  const restaurant = db.restaurants.find(r => r.id === rid);
  const staffUsers = sameRestaurant(db.users, rid).filter(u => !u.is_super_admin && u.role !== 'owner');
  const activeStaffUsers = staffUsers.filter(u => u.active !== false);
  const checklistRunsToday = sameRestaurant(db.checklist_runs, rid).filter(r => r.created_at?.slice(0, 10) === today);
  const activeChecklistTemplates = sameRestaurant(db.checklist_templates, rid).filter(t => t.active);
  const expectedChecklistKeys = new Set();
  activeStaffUsers.forEach(user => {
    activeChecklistTemplates
      .filter(template => checklistRoleMatchesUser(template.role, user.role))
      .forEach(template => expectedChecklistKeys.add(`${user.id}:${template.id}`));
  });
  const completedChecklistKeys = new Set(
    checklistRunsToday
      .filter(run => ['completed', 'done'].includes(run.status))
      .map(run => `${run.user_id}:${run.template_id}`)
      .filter(key => expectedChecklistKeys.has(key))
  );
  const inventoryRuns = sameRestaurant(db.inventory_runs, rid);
  const inventoryRunsToday = inventoryRuns.filter(r => isoDateKey(r.created_at) === today);
  const activeInventoryTemplates = sameRestaurant(db.inventory_templates, rid).filter(t => t.active !== false);
  const activeInventoryTemplateIds = new Set(activeInventoryTemplates.map(template => template.id));
  const inventoryAssignments = sameRestaurant(collection('inventory_assignments'), rid);
  const inventoryAssignmentsToday = inventoryAssignments
    .filter(assignment => assignment.status !== 'cancelled')
    .filter(assignment => assignment.due_date === today)
    .filter(assignment => activeInventoryTemplateIds.has(assignment.template_id));
  const inventoryAssignmentRowsToday = inventoryAssignmentsToday.map(inventoryAssignmentDetails);
  const readyInventoryAssignmentRows = inventoryAssignmentRowsToday.filter(assignment => assignment.status === 'completed');
  const activeDocuments = sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active);
  const requiredDocuments = activeDocuments.filter(d => d.requires_acknowledgement);
  const pendingAcknowledgements = requiredDocuments.reduce((total, doc) => {
    const targets = activeStaffUsers.filter(u => hasRoleAccess(u, doc.allowed_roles));
    const targetIds = new Set(targets.map(u => u.id));
    const acknowledged = db.knowledge_acknowledgements
      .filter(a => a.document_id === doc.id && a.version === doc.version && targetIds.has(a.user_id))
      .length;
    return total + Math.max(0, targets.length - acknowledged);
  }, 0);
  const activeTasks = sameRestaurant(db.tasks, rid).filter(task => task.active !== false);
  const taskAssignments = sameRestaurant(db.task_assignments, rid);
  const techRequests = sameRestaurant(db.tech_requests, rid);
  const openTechRequests = techRequests.filter(request => !['done', 'cancelled'].includes(request.status));
  const doneTechRequests = techRequests.filter(request => request.status === 'done');
  const taskById = new Map(activeTasks.map(task => [task.id, task]));
  const periodTaskAssignments = taskAssignments
    .filter(assignment => taskById.has(assignment.task_id))
    .filter(assignment => taskTouchesRange(taskById.get(assignment.task_id), assignment, taskRange));
  const isPeriodAssignmentOverdue = (assignment) => {
    const task = taskById.get(assignment.task_id);
    const dueTime = task?.due_at ? new Date(task.due_at).getTime() : NaN;
    return !assignment.done && dateKeyInRange(task?.due_at, taskRange) && Number.isFinite(dueTime) && dueTime < now;
  };
  const openPeriodTaskAssignments = periodTaskAssignments.filter(assignment => !assignment.done && !isPeriodAssignmentOverdue(assignment));
  const overduePeriodTaskAssignments = periodTaskAssignments.filter(isPeriodAssignmentOverdue);
  const taskSummary = {
    new: openPeriodTaskAssignments.length,
    done: periodTaskAssignments.filter(assignment => assignment.done).length,
    not_done: openPeriodTaskAssignments.length,
    overdue: overduePeriodTaskAssignments.length,
    open: openPeriodTaskAssignments.length
  };
  void openTechRequests;
  void doneTechRequests;
  const checklistSummary = {
    done: completedChecklistKeys.size,
    not_done: Math.max(0, expectedChecklistKeys.size - completedChecklistKeys.size),
    total: expectedChecklistKeys.size
  };
  const documentSummary = {
    total: activeDocuments.length,
    required: requiredDocuments.length,
    pending: pendingAcknowledgements
  };
  const inventorySummary = {
    ready: readyInventoryAssignmentRows.length,
    not_ready: Math.max(0, inventoryAssignmentRowsToday.length - readyInventoryAssignmentRows.length),
    today: inventoryAssignmentsToday.length,
    total: inventoryAssignments.length,
    active_templates: activeInventoryTemplates.length
  };
  const activeTaskIds = new Set(activeTasks.map(task => task.id));
  const employeeMetrics = activeStaffUsers
    .map(user => {
      const userChecklistTemplates = activeChecklistTemplates.filter(template => checklistRoleMatchesUser(template.role, user.role));
      const completedChecklistRuns = checklistRunsToday
        .filter(run => run.user_id === user.id && ['completed', 'done'].includes(run.status));
      const latestChecklistRunByTemplate = new Map();
      completedChecklistRuns.forEach(run => {
        const current = latestChecklistRunByTemplate.get(run.template_id);
        if (!current || String(run.created_at || '').localeCompare(String(current.created_at || '')) > 0) {
          latestChecklistRunByTemplate.set(run.template_id, run);
        }
      });
      const userChecklistDoneKeys = new Set(
        Array.from(latestChecklistRunByTemplate.keys())
          .map(templateId => `${user.id}:${templateId}`)
          .filter(key => userChecklistTemplates.some(template => key === `${user.id}:${template.id}`))
      );
      const checklistDetails = userChecklistTemplates.map(template => {
        const run = latestChecklistRunByTemplate.get(template.id);
        const items = db.checklist_items
          .filter(item => item.template_id === template.id)
          .sort((a, b) => a.sort_order - b.sort_order);
        const answers = run ? db.checklist_answers.filter(answer => answer.run_id === run.id) : [];
        const checklistItems = items.map(item => {
          const answer = answers.find(candidate => candidate.item_id === item.id);
          return {
            id: item.id,
            text: item.text,
            required: item.required !== false,
            done: Boolean(answer?.done),
            comment: answer?.comment || '',
            photo_url: answer?.photo_url || ''
          };
        });
        return {
          id: template.id,
          title: template.title,
          type: template.type,
          status: run ? 'done' : 'not_done',
          completed_at: run?.completed_at || run?.created_at || null,
          items: checklistItems,
          done_items: checklistItems.filter(item => item.done),
          not_done_items: checklistItems.filter(item => !item.done)
        };
      });
      const userTaskAssignments = periodTaskAssignments.filter(assignment => assignment.user_id === user.id && activeTaskIds.has(assignment.task_id));
      const userTaskDetails = userTaskAssignments.map(assignment => {
        const task = taskById.get(assignment.task_id);
        return {
          id: task?.id || assignment.task_id,
          title: task?.title || 'Задача',
          description: task?.description || '',
          due_at: task?.due_at || null,
          created_at: task?.created_at || null,
          done: Boolean(assignment.done),
          completed_at: assignment.completed_at || null,
          comment: assignment.comment || '',
          overdue: !assignment.done && task?.due_at && new Date(task.due_at).getTime() < now
        };
      });
      const combinedTaskDetails = userTaskDetails
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      const openUserTechRequests = [];
      const userInventoryAssignments = inventoryAssignmentRowsToday.filter(assignment => assignment.department === user.department);
      const inventoryDetails = userInventoryAssignments.map(assignment => ({
        id: assignment.id,
        template_id: assignment.template_id,
        title: assignment.template?.title || 'Инвентаризация',
        department: assignment.department,
        due_date: assignment.due_date,
        status: assignment.status === 'completed' ? 'ready' : 'not_ready',
        completed_at: assignment.completed_at || null,
        completed_by: assignment.completed_by || null
      }));
      const userReadyInventoryTemplateIds = new Set(inventoryDetails.filter(item => item.status === 'ready').map(item => item.id));
      const userInventoryTemplates = inventoryDetails;
      const userRequiredDocuments = requiredDocuments.filter(doc => hasRoleAccess(user, doc.allowed_roles));
      const documentDetails = userRequiredDocuments.map(doc => {
        const acknowledgement = db.knowledge_acknowledgements.find(a => (
          a.document_id === doc.id && a.user_id === user.id && a.version === doc.version
        ));
        return {
          id: doc.id,
          title: doc.title,
          category_id: doc.category_id,
          version: doc.version,
          status: acknowledgement ? 'acknowledged' : 'pending',
          acknowledged_at: acknowledgement?.acknowledged_at || null
        };
      });
      const acknowledgedDocuments = documentDetails.filter(doc => doc.status === 'acknowledged');
      return {
        user: publicUser(user),
        checklists: {
          done: userChecklistDoneKeys.size,
          not_done: Math.max(0, userChecklistTemplates.length - userChecklistDoneKeys.size),
          details: checklistDetails
        },
        tasks: {
          new: userTaskAssignments.filter(assignment => !assignment.done && !isPeriodAssignmentOverdue(assignment)).length,
          done: userTaskAssignments.filter(assignment => assignment.done).length,
          not_done: userTaskAssignments.filter(assignment => !assignment.done && !isPeriodAssignmentOverdue(assignment)).length,
          details: combinedTaskDetails
        },
        documents: {
          pending: Math.max(0, userRequiredDocuments.length - acknowledgedDocuments.length),
          acknowledged: acknowledgedDocuments.length,
          details: documentDetails
        },
        inventories: {
          ready: userReadyInventoryTemplateIds.size,
          not_ready: Math.max(0, userInventoryTemplates.length - userReadyInventoryTemplateIds.size),
          details: inventoryDetails
        }
      };
    })
    .sort((a, b) => (a.user.name || '').localeCompare(b.user.name || '', 'ru'));
  const activeStaffUserIds = new Set(activeStaffUsers.map(user => user.id));
  const openShifts = sameRestaurant(collection('shifts'), rid)
    .filter(shift => shift.status === 'open' && activeStaffUserIds.has(shift.user_id))
    .map(shift => ({
      ...shift,
      user: publicUser(activeStaffUsers.find(user => user.id === shift.user_id))
    }))
    .sort((a, b) => String(a.opened_at || '').localeCompare(String(b.opened_at || '')));
  const openShiftsToday = openShifts;
  res.json({
    restaurant,
    users: activeStaffUsers.length,
    users_total: staffUsers.length,
    employees: activeStaffUsers
      .map(publicUser)
      .sort((a, b) => (a?.name || '').localeCompare(b?.name || '', 'ru')),
    employee_limit: employeeLimitForRestaurant(restaurant),
    checklists_today: checklistSummary.done,
    inventories: inventoryRuns.length,
    tasks_open: taskSummary.open,
    docs: documentSummary.total,
    summary: {
      users: {
        active: activeStaffUsers.length,
        inactive: staffUsers.filter(u => u.active === false).length,
        total: staffUsers.length,
        limit: employeeLimitForRestaurant(restaurant)
      },
      checklists: checklistSummary,
      tasks: taskSummary,
      documents: documentSummary,
      inventories: inventorySummary
    },
    employee_metrics: employeeMetrics,
    task_period: taskRange,
    inventory_assignments_today: inventoryAssignmentRowsToday,
    open_shifts: openShifts,
    open_shifts_today: openShiftsToday
  });
});

// USERS
app.get('/api/admin/users', auth, ensureRestaurantActive, operationalEditorOnly, (req, res) => {
  const rid = req.user.restaurant_id || req.query.restaurant_id;
  const manageableDepartmentName = manageableDepartment(req.user);
  const includeInactive = String(req.query.include_inactive || '') === '1';
  const rows = sameRestaurant(db.users, rid)
    .filter(u => !u.is_super_admin)
    .filter(u => includeInactive || u.active !== false)
    .filter(u => !manageableDepartmentName || u.department === manageableDepartmentName || canManageRole(req.user, u.role))
    .map(user => serializeAdminUser(user, req.user));
  res.json(rows);
});

app.post('/api/admin/users', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id || req.body.restaurant_id;
  const { name, login, password, role, department } = req.body;
  const normalizedRole = normalizeStaffRole(role);
  if (!name || !login || !password || !normalizedRole) return res.status(400).json({ error: 'Заполните имя, логин, пароль и выберите роль сотрудника' });
  if (db.users.some(u => u.login === login)) return res.status(409).json({ error: 'Такой логин уже есть' });
  const user = {
    id: uid('user'),
    restaurant_id: rid,
    name: String(name || '').trim(),
    login: String(login || '').trim(),
    password_hash: hashPassword(password),
    access_password: String(password || ''),
    role: normalizedRole,
    department: department || roleToDepartment(normalizedRole),
    active: true,
    is_super_admin: false,
    created_at: nowIso()
  };
  db.users.push(user);
  await persist();
  res.status(201).json(serializeAdminUser(user, req.user));
}));

app.patch('/api/admin/users/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const user = db.users.find(u => u.id === req.params.id && u.restaurant_id === req.user.restaurant_id);
  if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (user.is_super_admin || user.role === 'owner') return res.status(403).json({ error: 'Нельзя редактировать владельца через список сотрудников' });
  if (req.body.login !== undefined) {
    const nextLogin = String(req.body.login || '').trim();
    if (!nextLogin) return res.status(400).json({ error: 'Логин не может быть пустым' });
    if (db.users.some(existing => existing.id !== user.id && existing.login === nextLogin)) {
      return res.status(409).json({ error: 'Такой логин уже есть' });
    }
    user.login = nextLogin;
  }
  if (req.body.name !== undefined) {
    const nextName = String(req.body.name || '').trim();
    if (!nextName) return res.status(400).json({ error: 'Имя не может быть пустым' });
    user.name = nextName;
  }
  if (req.body.role !== undefined) {
    const nextRole = normalizeStaffRole(req.body.role);
    if (!nextRole) return res.status(400).json({ error: 'Выберите корректную роль сотрудника' });
    user.role = nextRole;
    if (req.body.department === undefined) user.department = roleToDepartment(nextRole);
  }
  if (req.body.department !== undefined) user.department = String(req.body.department || '').trim() || roleToDepartment(user.role);
  if (req.body.active !== undefined) {
    if (user.id === req.user.id && !req.body.active) return res.status(400).json({ error: 'Нельзя отключить собственный аккаунт' });
    user.active = Boolean(req.body.active);
  }
  if (req.body.password) {
    user.password_hash = hashPassword(req.body.password);
    user.access_password = String(req.body.password || '');
  }
  await persist();
  res.json(serializeAdminUser(user, req.user));
}));

app.delete('/api/admin/users/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const user = db.users.find(u => u.id === req.params.id && u.restaurant_id === req.user.restaurant_id);
  if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });
  if (user.is_super_admin || user.role === 'owner') return res.status(403).json({ error: 'Нельзя удалить владельца через список сотрудников' });
  if (user.id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить собственный аккаунт' });
  user.active = false;
  user.login = `${user.login}__deleted__${Date.now()}`;
  user.name = `${user.name} (удален)`;
  await persist();
  res.json({ ok: true });
}));

// CHECKLISTS
app.get('/api/checklists/templates', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const manageableRoles = manageableRolesForUser(req.user).filter(role => CHECKLIST_ROLES.includes(role));
  const role = MANAGER_ROLES.includes(req.user.role) ? req.query.role : req.user.role;
  const templates = sameRestaurant(db.checklist_templates, rid)
    .filter(t => t.active)
    .filter(t => {
      if (MANAGER_ROLES.includes(req.user.role)) return !role || t.role === role || role === req.user.role;
      if (SENIOR_ROLES.includes(req.user.role)) return manageableRoles.includes(t.role);
      return checklistRoleMatchesUser(t.role, req.user.role);
    })
    .map(t => ({ ...t, items: db.checklist_items.filter(i => i.template_id === t.id).sort((a, b) => a.sort_order - b.sort_order) }));
  res.json(templates);
});

app.post('/api/admin/checklists/templates', auth, ensureRestaurantActive, operationalEditorOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const { title, role, type, items } = req.body;
  if (!title || !role || !type) return res.status(400).json({ error: 'Нужны название, роль и тип' });
  if (!CHECKLIST_ROLES.includes(String(role))) return res.status(400).json({ error: 'Чек-лист можно назначить только группе: повара, бармены, хостес, официанты или клининг' });
  if (!canManageChecklistRole(req.user, String(role))) return res.status(403).json({ error: 'Можно редактировать чек-листы только своего подразделения' });
  const normalized = normalizeChecklistTemplateItems(items);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const template = { id: uid('cltpl'), restaurant_id: rid, title, role, type, active: true, created_at: nowIso() };
  db.checklist_templates.push(template);
  normalized.items.forEach(item => db.checklist_items.push({ ...item, restaurant_id: rid, template_id: template.id }));
  await persist();
  res.status(201).json({ ...template, items: db.checklist_items.filter(i => i.template_id === template.id) });
}));

app.patch('/api/admin/checklists/templates/:id', auth, ensureRestaurantActive, operationalEditorOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const template = db.checklist_templates.find(t => t.id === req.params.id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Чек-лист не найден' });

  const nextTitle = req.body.title !== undefined ? String(req.body.title || '').trim() : template.title;
  const nextRole = req.body.role !== undefined ? String(req.body.role || '').trim() : template.role;
  const nextType = req.body.type !== undefined ? String(req.body.type || '').trim() : template.type;
  if (!nextTitle || !nextRole || !nextType) {
    return res.status(400).json({ error: 'Нужны название, роль и тип' });
  }
  if (!CHECKLIST_ROLES.includes(nextRole)) {
    return res.status(400).json({ error: 'Чек-лист можно назначить только группе: повара, бармены, хостес, официанты или клининг' });
  }
  if (!canManageChecklistRole(req.user, template.role) || !canManageChecklistRole(req.user, nextRole)) {
    return res.status(403).json({ error: 'Можно редактировать чек-листы только своего подразделения' });
  }

  template.title = nextTitle;
  template.role = nextRole;
  template.type = nextType;
  if (req.body.active !== undefined) template.active = Boolean(req.body.active);

  if (req.body.items !== undefined) {
    const normalized = normalizeChecklistTemplateItems(req.body.items);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    const existingItems = db.checklist_items.filter(item => item.template_id === template.id);
    const nextIds = new Set(normalized.items.map(item => item.id));
    const removedItemIds = existingItems
      .filter(item => !nextIds.has(item.id))
      .map(item => item.id);

    normalized.items.forEach(item => {
      const current = existingItems.find(existing => existing.id === item.id);
      if (current) {
        current.text = item.text;
        current.required = item.required;
        current.needs_comment = item.needs_comment;
        current.needs_photo = item.needs_photo;
        current.sort_order = item.sort_order;
      } else {
        db.checklist_items.push({
          ...item,
          restaurant_id: rid,
          template_id: template.id
        });
      }
    });

    if (removedItemIds.length) {
      const removedSet = new Set(removedItemIds);
      db.checklist_answers = db.checklist_answers.filter(answer => !removedSet.has(answer.item_id));
    }
    db.checklist_items = db.checklist_items.filter(item => item.template_id !== template.id || nextIds.has(item.id));
  }

  await persist();
  res.json({
    ...template,
    items: db.checklist_items
      .filter(item => item.template_id === template.id)
      .sort((a, b) => a.sort_order - b.sort_order)
  });
}));

app.delete('/api/admin/checklists/templates/:id', auth, ensureRestaurantActive, operationalEditorOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const template = db.checklist_templates.find(t => t.id === req.params.id && t.restaurant_id === rid && t.active);
  if (!template) return res.status(404).json({ error: 'Чек-лист не найден' });
  if (!canManageChecklistRole(req.user, template.role)) {
    return res.status(403).json({ error: 'Можно удалять чек-листы только своего подразделения' });
  }

  template.active = false;
  await persist();
  res.json({ ok: true });
}));

app.get('/api/checklists/runs', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const today = String(req.query.date || new Date().toISOString().slice(0, 10));
  const rows = sameRestaurant(db.checklist_runs, rid)
    .filter(run => run.user_id === req.user.id)
    .filter(run => String(run.created_at || '').slice(0, 10) === today)
    .map(run => ({
      ...run,
      template: db.checklist_templates.find(t => t.id === run.template_id),
      answers: db.checklist_answers.filter(answer => answer.run_id === run.id)
    }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(rows);
});

app.post('/api/checklists/runs', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const { template_id, answers, comment } = req.body;
  const template = db.checklist_templates.find(t => t.id === template_id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Чек-лист не найден' });
  if (req.user.role === 'owner') return res.status(403).json({ error: 'Владелец редактирует чек-листы, но не выполняет их' });
  if (req.user.role !== 'manager' && !checklistRoleMatchesUser(template.role, req.user.role)) return res.status(403).json({ error: 'Этот чек-лист не для вашей роли' });
  const currentShift = currentOpenShiftFor(req.user);
  if (!currentShift) return res.status(400).json({ error: 'Сначала начните смену' });
  const templateItems = db.checklist_items.filter(i => i.template_id === template.id);
  const answerValue = (item) => answers?.[item.id] || {};
  const answerStatus = (item) => {
    const value = answerValue(item);
    const status = String(value.status || (value.done ? 'ok' : '')).trim();
    return status === 'na' ? '' : status;
  };
  const missingRequiredItem = templateItems.find(item => item.required && !['ok', 'problem'].includes(answerStatus(item)));
  if (missingRequiredItem) return res.status(400).json({ error: `Выберите статус для обязательного пункта "${missingRequiredItem.text}"` });
  const missingPhotoItem = templateItems.find(item => {
    const value = answerValue(item);
    return Boolean(item.needs_photo) && answerStatus(item) === 'ok' && !value.photo_url;
  });
  if (missingPhotoItem) return res.status(400).json({ error: `Для пункта "${missingPhotoItem.text}" нужно сделать фото` });
  const missingCommentItem = templateItems.find(item => {
    const value = answerValue(item);
    const status = answerStatus(item);
    return status === 'problem' && !String(value.comment || '').trim();
  });
  if (missingCommentItem) return res.status(400).json({ error: `Для пункта "${missingCommentItem.text}" нужен комментарий` });

  const run = { id: uid('clrun'), restaurant_id: rid, template_id, user_id: req.user.id, status: 'completed', comment: comment || '', created_at: nowIso(), completed_at: nowIso() };
  db.checklist_runs.push(run);
  const problemItems = [];
  try {
    templateItems.forEach(item => {
      const value = answerValue(item);
      const status = answerStatus(item);
      const done = status === 'ok';
      const photo_url = status === 'ok' && value.photo_url ? saveChecklistPhoto(value.photo_url, rid, run.id, item.id) : '';
      const savedComment = status === 'problem' ? `Проблема: ${String(value.comment || '').trim()}`.trim() : '';
      db.checklist_answers.push({ id: uid('clans'), restaurant_id: rid, run_id: run.id, item_id: item.id, done, comment: savedComment, photo_url });
      if (status === 'problem') problemItems.push({ item, comment: String(value.comment || '').trim() });
    });
  } catch (error) {
    db.checklist_runs = db.checklist_runs.filter(savedRun => savedRun.id !== run.id);
    return res.status(400).json({ error: error.message || 'Не удалось сохранить фото' });
  }
  problemItems.forEach(({ item, comment: itemComment }) => {
    const request = {
      id: uid('tech'),
      restaurant_id: rid,
      created_by: req.user.id,
      title: `Проблема в чек-листе: ${item.text}`,
      description: itemComment || `Пункт отмечен как проблема в чек-листе "${template.title}"`,
      category: 'other',
      status: 'new',
      manager_comment: '',
      started_at: null,
      resolved_at: null,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    db.tech_requests.push(request);
    notifyManagers(rid, { title: 'Проблема в чек-листе', body: `${req.user.name}: ${item.text}`, entity_type: 'tech_request', entity_id: request.id });
  });
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'checklist_completed', title: `${req.user.name} завершил чек-лист "${template.title}"`, entity_type: 'checklist_run', entity_id: run.id, metadata: { total: templateItems.length, problems: problemItems.length } });
  notifyManagers(rid, { title: problemItems.length ? 'Чек-лист выполнен с проблемами' : 'Чек-лист выполнен', body: `${req.user.name}: ${template.title}`, entity_type: 'checklist_run', entity_id: run.id });
  let closedShift = null;
  if (template.type === 'close') {
    currentShift.status = 'closed';
    currentShift.closed_at = currentShift.closed_at || run.completed_at;
    currentShift.comment = String(comment || `Автоматически закрыта чек-листом "${template.title}"`).trim();
    closedShift = currentShift;
    logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'shift_closed', title: `${req.user.name} закрыл смену`, entity_type: 'shift', entity_id: currentShift.id, metadata: { checklist_run_id: run.id, checklist_template_id: template.id } });
    notifyManagers(rid, { title: 'Смена закрыта', body: `${req.user.name} завершил смену чек-листом`, entity_type: 'shift', entity_id: currentShift.id });
  }
  await persist();
  res.status(201).json({ ...run, shift_closed: closedShift });
}));

app.get('/api/admin/checklists/runs', auth, ensureRestaurantActive, operationalEditorOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const rows = sameRestaurant(db.checklist_runs, rid).map(run => ({
    ...run,
    user: publicUser(db.users.find(u => u.id === run.user_id)),
    template: db.checklist_templates.find(t => t.id === run.template_id),
    answers: db.checklist_answers.filter(a => a.run_id === run.id)
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const visibleRows = SENIOR_ROLES.includes(req.user.role) ? rows.filter(row => canManageChecklistRole(req.user, row.template?.role)) : rows;
  res.json(visibleRows);
});

// PRODUCTS
app.get('/api/products', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const ownDepartment = req.user.department || roleDepartment(req.user.role);
  const department = req.user.is_super_admin || MANAGER_ROLES.includes(req.user.role)
    ? (req.query.department || null)
    : ownDepartment;
  const rows = sameRestaurant(db.products, rid).filter(p => p.active && (!department || p.department === department));
  res.json(rows);
});

app.post('/api/admin/products', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const { name, unit, department, category, supplier } = req.body;
  if (!name || !unit || !department) return res.status(400).json({ error: 'Нужны название, единица и отдел' });
  const product = {
    id: uid('prod'),
    restaurant_id: req.user.restaurant_id,
    name: String(name || '').trim(),
    unit: String(unit || '').trim(),
    department,
    category: category || '',
    supplier: String(supplier || '').trim() || 'Без поставщика',
    active: true,
    created_at: nowIso()
  };
  db.products.push(product);
  syncProductWithInventoryTemplates(db, product);
  await persist();
  res.status(201).json(product);
}));

app.patch('/api/admin/products/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const product = db.products.find(p => p.id === req.params.id && p.restaurant_id === req.user.restaurant_id);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });

  const nextName = req.body.name !== undefined ? String(req.body.name).trim() : product.name;
  const nextUnit = req.body.unit !== undefined ? String(req.body.unit).trim() : product.unit;
  const nextDepartment = req.body.department !== undefined ? String(req.body.department).trim() : product.department;
  const nextCategory = req.body.category !== undefined ? String(req.body.category).trim() : product.category;
  const nextSupplier = req.body.supplier !== undefined ? String(req.body.supplier).trim() || 'Без поставщика' : product.supplier || 'Без поставщика';

  if (!nextName || !nextUnit || !nextDepartment) {
    return res.status(400).json({ error: 'Нужны название, единица и отдел' });
  }

  const previousDepartment = product.department;
  product.name = nextName;
  product.unit = nextUnit;
  product.department = nextDepartment;
  product.category = nextCategory;
  product.supplier = nextSupplier;

  moveProductBetweenInventoryTemplates(db, product, previousDepartment);
  await persist();
  res.json(product);
}));

app.delete('/api/admin/products/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const product = db.products.find(p => p.id === req.params.id && p.restaurant_id === req.user.restaurant_id);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  product.active = false;
  removeProductFromInventoryTemplates(db, product.id);
  await persist();
  res.json({ ok: true });
}));

// INVENTORY
app.post('/api/admin/inventory/import-template', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const sectionId = String(req.body.section || 'bar');
  const section = inventoryImportSections[sectionId] || inventoryImportSections.bar;
  const dryRun = req.body.dry_run === true || req.body.dry_run === 'true';
  const parsed = await parseInventoryImportFile(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const existing = new Set(sameRestaurant(db.products, rid)
    .filter(product => product.department === section.department)
    .map(product => `${productKey(product.name)}::${normalizeInventoryUnit(product.unit)}::${productKey(product.category || '')}`));

  const added = [];
  const skipped = [];
  const preview = [];
  for (const item of parsed.items) {
    const key = `${productKey(item.name)}::${normalizeInventoryUnit(item.unit)}::${productKey(section.defaultCategory)}`;
    if (existing.has(key)) {
      skipped.push(item);
      preview.push({ ...item, status: 'duplicate', category: section.defaultCategory });
      continue;
    }
    preview.push({ ...item, status: 'new', category: section.defaultCategory });
    if (dryRun) continue;
    const product = {
      id: uid('prod'), restaurant_id: rid, department: section.department,
      name: item.name, unit: item.unit, category: section.defaultCategory,
      supplier: 'Без поставщика', active: true, created_at: nowIso()
    };
    db.products.push(product);
    syncProductWithInventoryTemplates(db, product);
    existing.add(key);
    added.push(product);
  }

  if (dryRun) {
    return res.json({ detected: parsed.items, added: [], skipped, preview, will_add: preview.filter(item => item.status === 'new') });
  }

  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'inventory_template_imported', title: `${req.user.name} загрузил бланк инвентаризации: ${section.title}`, entity_type: 'inventory_template', entity_id: null, metadata: { section: sectionId, detected: parsed.items.length, added: added.length, skipped: skipped.length } });
  await persist();
  res.status(201).json({ detected: parsed.items, added, skipped, preview });
}));

app.get('/api/inventory/templates', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const assignable = String(req.query.assignable || '') === '1';
  const today = isDateKey(req.query.date) ? String(req.query.date) : todayKey();
  const isManager = MANAGER_ROLES.includes(req.user.role) || req.user.is_super_admin;
  const seniorDepartment = manageableDepartment(req.user);
  const department = req.query.department || (isManager ? null : req.user.department);
  let templates = sameRestaurant(db.inventory_templates, rid)
    .filter(t => t.active !== false)
    .filter(t => !department || t.department === department);

  if (assignable) {
    if (!isManager && !seniorDepartment) return res.status(403).json({ error: 'Назначать инвентаризацию может менеджер или старший подразделения' });
    templates = templates.filter(t => isManager || t.department === seniorDepartment);
  } else if (!isManager) {
    const openAssignments = sameRestaurant(collection('inventory_assignments'), rid)
      .filter(assignment => assignment.status === 'open')
      .filter(assignment => assignment.department === req.user.department)
      .filter(assignment => assignment.due_date === today);
    const assignedTemplateIds = new Set(openAssignments.map(assignment => assignment.template_id));
    templates = templates.filter(t => assignedTemplateIds.has(t.id));
  }

  const assignmentByTemplateId = new Map(
    sameRestaurant(collection('inventory_assignments'), rid)
      .filter(assignment => assignment.due_date === today && assignment.status !== 'cancelled')
      .map(assignment => [assignment.template_id, inventoryAssignmentDetails(assignment)])
  );
  const rows = templates
    .map(t => ({
      ...t,
      assignment: assignmentByTemplateId.get(t.id) || null,
      items: db.inventory_template_items
        .filter(i => i.template_id === t.id)
        .map(i => ({ ...i, product: db.products.find(p => p.id === i.product_id) }))
    }));
  res.json(rows);
});

app.get('/api/admin/inventory/assignments', auth, ensureRestaurantActive, operationalEditorOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const range = normalizeDateRange(req.query, 'from', 'to');
  const department = SENIOR_ROLES.includes(req.user.role) ? manageableDepartment(req.user) : String(req.query.department || '');
  const rows = sameRestaurant(collection('inventory_assignments'), rid)
    .filter(assignment => assignment.status !== 'cancelled')
    .filter(assignment => assignment.due_date >= range.from && assignment.due_date <= range.to)
    .filter(assignment => !department || assignment.department === department)
    .map(inventoryAssignmentDetails)
    .sort((a, b) => String(b.due_date || '').localeCompare(String(a.due_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(rows);
});

app.post('/api/admin/inventory/assignments', auth, ensureRestaurantActive, operationalEditorOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const template = db.inventory_templates.find(t => t.id === req.body?.template_id && t.restaurant_id === rid && t.active !== false);
  if (!template) return res.status(404).json({ error: 'Бланк инвентаризации не найден' });
  const seniorDepartment = manageableDepartment(req.user);
  if (seniorDepartment && template.department !== seniorDepartment) {
    return res.status(403).json({ error: 'Старший может назначать инвентаризацию только своему подразделению' });
  }
  const dueDate = isDateKey(req.body?.due_date) ? String(req.body.due_date) : todayKey();
  const assignments = collection('inventory_assignments');
  let assignment = assignments.find(item => (
    item.restaurant_id === rid
    && item.template_id === template.id
    && item.department === template.department
    && item.due_date === dueDate
    && item.status !== 'cancelled'
  ));
  if (!assignment) {
    assignment = {
      id: uid('invass'),
      restaurant_id: rid,
      template_id: template.id,
      department: template.department,
      assigned_by: req.user.id,
      due_date: dueDate,
      status: 'open',
      created_at: nowIso(),
      completed_at: null
    };
    assignments.push(assignment);
  } else if (assignment.status === 'completed') {
    assignment.status = 'open';
    assignment.completed_at = null;
  }
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'inventory_assigned', title: `${req.user.name} назначил инвентаризацию "${template.title}"`, entity_type: 'inventory_assignment', entity_id: assignment.id, metadata: { template_id: template.id, department: template.department, due_date: dueDate } });
  notifyUsers(rid, db.users.filter(user => user.active && user.department === template.department && !MANAGER_ROLES.includes(user.role)), { title: 'Назначена инвентаризация', body: `${template.title} · ${departments[template.department] || template.department}`, entity_type: 'inventory_assignment', entity_id: assignment.id });
  await persist();
  res.status(201).json(inventoryAssignmentDetails(assignment));
}));

app.post('/api/inventory/runs', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const { template_id, values, comment } = req.body;
  const template = db.inventory_templates.find(t => t.id === template_id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Бланк инвентаризации не найден' });
  const isManager = ['owner', 'manager'].includes(req.user.role);
  if (!isManager && template.department !== req.user.department) return res.status(403).json({ error: 'Нет доступа к этой инвентаризации' });
  const today = todayKey();
  const assignment = sameRestaurant(collection('inventory_assignments'), rid)
    .find(item => item.template_id === template.id && item.department === template.department && item.due_date === today && item.status === 'open');
  if (!isManager && !assignment) return res.status(403).json({ error: 'Инвентаризация не назначена на сегодня' });

  const parsedValues = [];
  for (const [product_id, value] of Object.entries(values || {})) {
    const parsed = parseInventoryQuantity(value);
    if (parsed.error) {
      const product = db.products.find(p => p.id === product_id);
      return res.status(400).json({ error: `${product?.name || 'Позиция'}: ${parsed.error}` });
    }
    parsedValues.push({ product_id, qty: parsed.qty, expression: parsed.expression, comment: typeof value === 'object' && value !== null ? value.comment || '' : '' });
  }

  const run = { id: uid('invrun'), restaurant_id: rid, template_id, user_id: req.user.id, department: template.department, comment: comment || '', status: 'completed', created_at: nowIso(), assignment_id: assignment?.id || null };
  db.inventory_runs.push(run);
  parsedValues.forEach(value => {
    const savedComment = [value.expression, value.comment].filter(Boolean).join(' · ');
    db.inventory_values.push({ id: uid('invv'), restaurant_id: rid, inventory_run_id: run.id, product_id: value.product_id, qty: value.qty, comment: savedComment });
  });
  if (assignment) {
    assignment.status = 'completed';
    assignment.completed_at = run.created_at;
  }
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'inventory_completed', title: `${req.user.name} отправил инвентаризацию "${template.title}"`, entity_type: 'inventory_run', entity_id: run.id, metadata: { template_id, department: template.department, assignment_id: assignment?.id || null } });
  notifyManagers(rid, { title: 'Инвентаризация отправлена', body: `${req.user.name}: ${template.title}`, entity_type: 'inventory_run', entity_id: run.id });
  await persist();
  res.status(201).json(run);
}));

app.get('/api/inventory/runs', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const today = String(req.query.date || new Date().toISOString().slice(0, 10));
  const rows = sameRestaurant(db.inventory_runs, rid)
    .filter(run => run.user_id === req.user.id)
    .filter(run => String(run.created_at || '').slice(0, 10) === today)
    .map(run => ({
      ...run,
      template: db.inventory_templates.find(t => t.id === run.template_id),
      values: db.inventory_values.filter(value => value.inventory_run_id === run.id)
    }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(rows);
});

app.get('/api/admin/inventory/runs', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const rows = sameRestaurant(db.inventory_runs, rid).map(run => ({
    ...run,
    template: db.inventory_templates.find(t => t.id === run.template_id),
    user: publicUser(db.users.find(u => u.id === run.user_id)),
    values: db.inventory_values.filter(v => v.inventory_run_id === run.id).map(v => ({ ...v, product: db.products.find(p => p.id === v.product_id) }))
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(rows);
});

app.get('/api/admin/inventory/runs/:id/export.xlsx', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const run = db.inventory_runs.find(r => r.id === req.params.id && r.restaurant_id === rid);
  if (!run) return res.status(404).json({ error: 'Инвентаризация не найдена' });
  const template = db.inventory_templates.find(t => t.id === run.template_id);
  const runDate = String(run.created_at || '').slice(0, 10);
  const sameDayRuns = sameRestaurant(db.inventory_runs, rid)
    .filter(item => item.template_id === run.template_id && item.status === 'completed' && String(item.created_at || '').slice(0, 10) === runDate);
  const runIds = new Set(sameDayRuns.map(item => item.id));
  const participants = sameDayRuns.map(item => db.users.find(u => u.id === item.user_id)?.name).filter(Boolean).join(', ');
  const totals = new Map();

  db.inventory_values
    .filter(value => runIds.has(value.inventory_run_id))
    .forEach(value => {
      const product = db.products.find(p => p.id === value.product_id);
      const current = totals.get(value.product_id) || { product, qty: 0, comments: [] };
      current.qty += Number(value.qty || 0);
      const sourceRun = sameDayRuns.find(item => item.id === value.inventory_run_id);
      const sourceUser = db.users.find(u => u.id === sourceRun?.user_id)?.name || 'Сотрудник';
      if (value.comment) current.comments.push(`${sourceUser}: ${value.comment}`);
      totals.set(value.product_id, current);
    });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Общая инвентаризация');
  sheet.addRow(['Ресторан', req.restaurant.name]);
  sheet.addRow(['Бланк', template?.title || '']);
  sheet.addRow(['Отдел', run.department]);
  sheet.addRow(['Дата', new Date(run.created_at).toLocaleDateString('ru-RU')]);
  sheet.addRow(['Сотрудники', participants || '']);
  sheet.addRow([]);
  sheet.addRow(['Товар', 'Категория', 'Ед.', 'Итого', 'Подсчёты']);
  Array.from(totals.values())
    .sort((a, b) => String(a.product?.name || '').localeCompare(String(b.product?.name || ''), 'ru'))
    .forEach(item => sheet.addRow([item.product?.name || '', item.product?.category || '', item.product?.unit || '', Math.round(item.qty * 1000) / 1000, item.comments.join('; ')]));
  sheet.columns.forEach(c => { c.width = 26; });
  sheet.getRow(7).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=inventory-summary-${runDate}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
}));

// BOOKINGS / FLOOR PLAN
app.get('/api/bookings/tables', auth, ensureRestaurantActive, (req, res) => {
  res.json(activeFloorTables(req.user.restaurant_id));
});

app.post('/api/admin/bookings/tables/bulk', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const count = Math.max(0, Number(req.body.count || 0));
  if (!count) return res.status(400).json({ error: 'Укажите количество столов' });

  const seats = Math.max(1, Number(req.body.seats || 4) || 4);
  const zone = String(req.body.zone || '').trim() || 'Основной зал';
  const prefix = String(req.body.prefix || '').trim() || 'Стол';
  const tables = activeFloorTables(req.user.restaurant_id);
  let nextSortOrder = tables.reduce((max, table) => Math.max(max, Number(table.sort_order) || 0), 0) + 1;
  let nextIndex = tables.length + 1;

  const created = Array.from({ length: count }).map(() => {
    const table = {
      id: uid('tbl'),
      restaurant_id: req.user.restaurant_id,
      label: `${prefix} ${nextIndex++}`,
      seats,
      zone,
      sort_order: nextSortOrder++,
      active: true,
      created_at: nowIso()
    };
    collection('floor_tables').push(table);
    return table;
  });

  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'floor_plan_updated', title: `${req.user.name} добавил столы в план зала`, entity_type: 'floor_table', entity_id: created[0]?.id || '', metadata: { count, zone } });
  await persist();
  res.status(201).json(created);
}));

app.patch('/api/admin/bookings/tables/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const table = collection('floor_tables').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!table) return res.status(404).json({ error: 'Стол не найден' });

  const nextLabel = req.body.label !== undefined ? String(req.body.label || '').trim() : table.label;
  const nextSeats = req.body.seats !== undefined ? Number(req.body.seats) : table.seats;
  const nextZone = req.body.zone !== undefined ? String(req.body.zone || '').trim() : table.zone;

  if (!nextLabel) return res.status(400).json({ error: 'Название стола не может быть пустым' });
  if (!Number.isFinite(nextSeats) || nextSeats <= 0) return res.status(400).json({ error: 'Укажите корректную вместимость стола' });

  table.label = nextLabel;
  table.seats = Math.round(nextSeats);
  table.zone = nextZone || 'Основной зал';
  if (req.body.sort_order !== undefined && Number.isFinite(Number(req.body.sort_order))) table.sort_order = Number(req.body.sort_order);
  if (req.body.active !== undefined) table.active = Boolean(req.body.active);

  await persist();
  res.json(table);
}));

app.delete('/api/admin/bookings/tables/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const table = collection('floor_tables').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!table) return res.status(404).json({ error: 'Стол не найден' });
  table.active = false;
  await persist();
  res.json({ ok: true });
}));


app.post('/api/bookings/tables/:id/seat', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const table = collection('floor_tables').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id && item.active);
  if (!table) return res.status(404).json({ error: 'Стол не найден' });
  if (currentTableReservation(req.user.restaurant_id, table.id)) return res.status(400).json({ error: 'Стол уже занят' });

  const guestsCount = Math.max(1, Math.round(Number(req.body.guests_count || 1) || 1));
  const openedAt = nowIso();
  const reservation = {
    id: uid('book'),
    restaurant_id: req.user.restaurant_id,
    created_by: req.user.id,
    table_ids: [table.id],
    reserved_for: openedAt,
    duration_minutes: 600,
    guests_count: guestsCount,
    guest_name: String(req.body.guest_name || '').trim() || 'Гости без брони',
    guest_phone: String(req.body.guest_phone || '').trim(),
    comment: String(req.body.comment || 'Посадка без брони').trim(),
    status: 'seated',
    created_at: openedAt,
    updated_at: openedAt
  };
  collection('table_reservations').push(reservation);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'booking_seated', title: `${req.user.name} отметил стол занятым`, entity_type: 'booking', entity_id: reservation.id, metadata: { table_id: table.id } });
  await persist();
  res.status(201).json(serializeReservation(reservation));
}));

app.post('/api/bookings/tables/:id/free', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const table = collection('floor_tables').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id && item.active);
  if (!table) return res.status(404).json({ error: 'Стол не найден' });
  const reservation = currentTableReservation(req.user.restaurant_id, table.id);
  if (!reservation) return res.status(404).json({ error: 'На этом столе нет активной посадки' });
  reservation.status = 'completed';
  reservation.updated_at = nowIso();
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'booking_completed', title: `${req.user.name} освободил стол`, entity_type: 'booking', entity_id: reservation.id, metadata: { table_id: table.id } });
  await persist();
  res.json(serializeReservation(reservation));
}));

app.get('/api/bookings', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const rows = sameRestaurant(collection('table_reservations'), rid)
    .map(serializeReservation)
    .sort((a, b) => String(a.reserved_for || '').localeCompare(String(b.reserved_for || '')));
  res.json(rows);
});

app.post('/api/bookings', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const normalized = normalizeReservationPayload(req.user.restaurant_id, req.body);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  const reservation = {
    id: uid('book'),
    restaurant_id: req.user.restaurant_id,
    created_by: req.user.id,
    ...normalized.payload,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  collection('table_reservations').push(reservation);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'booking_created', title: `${req.user.name} создал бронь`, entity_type: 'booking', entity_id: reservation.id, metadata: { tables: reservation.table_ids.length, reserved_for: reservation.reserved_for, guests_count: reservation.guests_count } });
  notifyManagers(req.user.restaurant_id, { title: 'Новая бронь', body: `${req.user.name}: ${reservation.guests_count} гостей`, entity_type: 'booking', entity_id: reservation.id });
  await persist();
  res.status(201).json(serializeReservation(reservation));
}));

app.patch('/api/bookings/:id', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const reservation = collection('table_reservations').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!reservation) return res.status(404).json({ error: 'Бронь не найдена' });
  const requestKeys = Object.keys(req.body || {});
  const statusOnlyUpdate = requestKeys.length === 1 && requestKeys[0] === 'status' && ['seated', 'completed'].includes(String(req.body.status || ''));
  if (!MANAGER_ROLES.includes(req.user.role) && reservation.created_by !== req.user.id && !statusOnlyUpdate) return res.status(403).json({ error: 'Можно редактировать только свои брони' });

  if (statusOnlyUpdate) {
    const nextStatus = String(req.body.status || '').trim();
    const nextValues = { status: nextStatus, updated_at: nowIso() };

    if (nextStatus === 'seated') {
      const tableIds = Array.isArray(reservation.table_ids) ? reservation.table_ids : [];
      const seatedAt = nowIso();
      const durationMinutes = Math.max(30, Math.min(600, Number(reservation.duration_minutes || 120) || 120));
      const nextInterval = {
        start: new Date(seatedAt).getTime(),
        end: new Date(seatedAt).getTime() + durationMinutes * 60000
      };
      const conflictingReservation = sameRestaurant(collection('table_reservations'), req.user.restaurant_id)
        .filter(item => item.id !== reservation.id)
        .filter(item => ['booked', 'seated'].includes(item.status))
        .find(item => {
          const itemTableIds = Array.isArray(item.table_ids) ? item.table_ids : [];
          return itemTableIds.some(tableId => tableIds.includes(tableId)) && intervalsOverlap(nextInterval, reservationInterval(item));
        });
      if (conflictingReservation) return res.status(400).json({ error: 'На это время стол уже занят другой бронью' });
      nextValues.reserved_for = seatedAt;
    }

    Object.assign(reservation, nextValues);
    logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'booking_updated', title: `${req.user.name} обновил бронь`, entity_type: 'booking', entity_id: reservation.id, metadata: { status: reservation.status, guests_count: reservation.guests_count } });
    await persist();
    return res.json(serializeReservation(reservation));
  }

  const mergedPayload = {
    table_ids: req.body.table_ids !== undefined ? req.body.table_ids : reservation.table_ids,
    reserved_for: req.body.reserved_for !== undefined ? req.body.reserved_for : reservation.reserved_for,
    duration_minutes: req.body.duration_minutes !== undefined ? req.body.duration_minutes : reservation.duration_minutes,
    guests_count: req.body.guests_count !== undefined ? req.body.guests_count : reservation.guests_count,
    guest_name: req.body.guest_name !== undefined ? req.body.guest_name : reservation.guest_name,
    guest_phone: req.body.guest_phone !== undefined ? req.body.guest_phone : reservation.guest_phone,
    comment: req.body.comment !== undefined ? req.body.comment : reservation.comment,
    status: req.body.status !== undefined ? req.body.status : reservation.status
  };
  const normalized = normalizeReservationPayload(req.user.restaurant_id, mergedPayload, reservation.id);
  if (normalized.error) return res.status(400).json({ error: normalized.error });

  Object.assign(reservation, normalized.payload, { updated_at: nowIso() });
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'booking_updated', title: `${req.user.name} обновил бронь`, entity_type: 'booking', entity_id: reservation.id, metadata: { status: reservation.status, guests_count: reservation.guests_count } });
  await persist();
  res.json(serializeReservation(reservation));
}));

app.delete('/api/bookings/:id', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const reservation = collection('table_reservations').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!reservation) return res.status(404).json({ error: 'Бронь не найдена' });
  if (!MANAGER_ROLES.includes(req.user.role) && reservation.created_by !== req.user.id) return res.status(403).json({ error: 'Можно отменять только свои брони' });
  reservation.status = 'cancelled';
  reservation.updated_at = nowIso();
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'booking_cancelled', title: `${req.user.name} отменил бронь`, entity_type: 'booking', entity_id: reservation.id, metadata: { guest_phone: reservation.guest_phone } });
  await persist();
  res.json({ ok: true });
}));

// TASKS
app.get('/api/tasks', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const manage = String(req.query.manage || '') === '1';
  let rows;
  if (MANAGER_ROLES.includes(req.user.role) || (manage && SENIOR_ROLES.includes(req.user.role))) {
    const department = manage && SENIOR_ROLES.includes(req.user.role) ? manageableDepartment(req.user) : '';
    rows = sameRestaurant(db.tasks, rid)
      .filter(task => !department || task.target_department === department || task.created_by === req.user.id)
      .map(task => ({
        ...task,
        assignments: db.task_assignments.filter(a => a.task_id === task.id).map(a => ({ ...a, user: publicUser(db.users.find(u => u.id === a.user_id)) }))
      }));
  } else {
    const assignments = db.task_assignments.filter(a => a.restaurant_id === rid && a.user_id === req.user.id);
    rows = assignments.map(a => ({ ...db.tasks.find(t => t.id === a.task_id), assignment: a })).filter(Boolean);
  }
  res.json(rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
});

app.post('/api/tasks', auth, ensureRestaurantActive, operationalEditorOnly, runAsync(async (req, res) => {
  const { title, description, target_type, target_role, target_user_id, due_at } = req.body;
  if (!title || !target_type) return res.status(400).json({ error: 'Нужны название и получатель задачи' });

  let targetDepartment = null;
  if (SENIOR_ROLES.includes(req.user.role)) {
    targetDepartment = manageableDepartment(req.user);
    const recipientRoles = taskRecipientRolesForUser(req.user);
    if (target_type === 'role' && !recipientRoles.includes(target_role)) {
      return res.status(403).json({ error: 'Старший сотрудник может ставить задачи только сотрудникам своего подразделения' });
    }
    if (target_type === 'user') {
      const targetUser = db.users.find(user => user.id === target_user_id && user.restaurant_id === req.user.restaurant_id && user.active);
      if (!targetUser || targetUser.department !== targetDepartment || !recipientRoles.includes(targetUser.role)) {
        return res.status(403).json({ error: 'Можно выбрать только сотрудника своего подразделения' });
      }
    }
  } else if (target_type === 'role' && !canAssignTaskToRole(req.user, target_role)) {
    return res.status(403).json({ error: 'Нельзя назначить задачу этой роли' });
  }

  const task = {
    id: uid('task'),
    restaurant_id: req.user.restaurant_id,
    title: String(title || '').trim(),
    description: description || '',
    target_type,
    target_role: target_role || null,
    target_user_id: target_user_id || null,
    target_department: targetDepartment,
    due_at: due_at || null,
    created_by: req.user.id,
    created_at: nowIso(),
    active: true
  };
  db.tasks.push(task);
  makeAssignmentsForTask(task);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'task_created', title: `${req.user.name} создал задачу "${title}"`, entity_type: 'task', entity_id: task.id, metadata: { target_type, target_role, target_user_id, target_department: targetDepartment } });
  notifyAssignees(task, { title: 'Новая задача', body: title, entity_type: 'task', entity_id: task.id });
  await persist();
  res.status(201).json(task);
}));

app.patch('/api/tasks/:id/done', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const assignment = db.task_assignments.find(a => a.task_id === req.params.id && a.user_id === req.user.id && a.restaurant_id === req.user.restaurant_id);
  if (!assignment) return res.status(404).json({ error: 'Задача не найдена' });
  assignment.done = true;
  assignment.comment = req.body.comment || '';
  assignment.completed_at = nowIso();
  const task = db.tasks.find(item => item.id === assignment.task_id);
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'task_completed', title: `${req.user.name} выполнил задачу "${task?.title || 'Задача'}"`, entity_type: 'task', entity_id: assignment.task_id, metadata: { comment: assignment.comment } });
  notifyManagers(req.user.restaurant_id, { title: 'Задача выполнена', body: `${req.user.name}: ${task?.title || 'Задача'}`, entity_type: 'task', entity_id: assignment.task_id });
  await persist();
  res.json(assignment);
}));

// TECH REQUESTS
app.get('/api/tech-requests', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const isAdmin = ['owner', 'manager'].includes(req.user.role);
  const rows = sameRestaurant(db.tech_requests, rid)
    .filter(request => isAdmin || request.created_by === req.user.id)
    .map(request => ({
      ...request,
      created_by_user: publicUser(db.users.find(user => user.id === request.created_by))
    }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  res.json(rows);
});

app.post('/api/tech-requests', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || 'other').trim() || 'other';

  if (!title) return res.status(400).json({ error: 'Нужно указать тему проблемы' });

  const request = {
    id: uid('tech'),
    restaurant_id: rid,
    created_by: req.user.id,
    title,
    description,
    category,
    status: 'new',
    manager_comment: '',
    started_at: null,
    resolved_at: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  db.tech_requests.push(request);
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'tech_request_created', title: `${req.user.name} создал проблему "${title}"`, entity_type: 'tech_request', entity_id: request.id, metadata: { category } });
  notifyManagers(rid, { title: 'Новая проблема', body: `${req.user.name}: ${title}`, entity_type: 'tech_request', entity_id: request.id });
  await persist();
  res.status(201).json(request);
}));

app.patch('/api/tech-requests/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const request = db.tech_requests.find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!request) return res.status(404).json({ error: 'Проблема не найдена' });

  const allowedStatuses = ['new', 'in_progress', 'done', 'cancelled'];
  const nextStatus = req.body.status !== undefined ? String(req.body.status).trim() : request.status;
  if (!allowedStatuses.includes(nextStatus)) return res.status(400).json({ error: 'Некорректный статус' });

  request.status = nextStatus;
  if (req.body.manager_comment !== undefined) {
    request.manager_comment = String(req.body.manager_comment || '').trim();
  }
  if (nextStatus === 'in_progress' && !request.started_at) {
    request.started_at = nowIso();
  }
  if (nextStatus === 'done') {
    request.started_at = request.started_at || nowIso();
    request.resolved_at = nowIso();
  }
  if (nextStatus !== 'done') {
    request.resolved_at = null;
  }
  request.updated_at = nowIso();
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'tech_request_updated', title: `${req.user.name} обновил проблему "${request.title}"`, entity_type: 'tech_request', entity_id: request.id, metadata: { status: request.status, manager_comment: request.manager_comment } });
  notifyUsers(req.user.restaurant_id, [db.users.find(user => user.id === request.created_by)], { title: 'Проблема обновлена', body: `${request.title}: ${techRequestStatuses[request.status] || request.status}`, entity_type: 'tech_request', entity_id: request.id });

  await persist();
  res.json({
    ...request,
    created_by_user: publicUser(db.users.find(user => user.id === request.created_by))
  });
}));

// KNOWLEDGE BASE
app.get('/api/knowledge', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const docs = sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active && hasRoleAccess(req.user, d.allowed_roles));
  const cats = sameRestaurant(db.knowledge_categories, rid).filter(c => hasRoleAccess(req.user, c.allowed_roles));
  res.json(cats.map(c => ({ ...c, documents: docs.filter(d => d.category_id === c.id).map(d => sanitizeTtkDocumentForResponse({ ...d, acknowledged: db.knowledge_acknowledgements.some(a => a.document_id === d.id && a.user_id === req.user.id && a.version === d.version) })) })));
});

app.post('/api/admin/knowledge/categories', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const { title, allowed_roles } = req.body;
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return res.status(400).json({ error: 'Название обязательно' });
  const cat = { id: uid('kcat'), restaurant_id: req.user.restaurant_id, title: cleanTitle, allowed_roles: Array.isArray(allowed_roles) ? allowed_roles : [], sort_order: sameRestaurant(db.knowledge_categories, req.user.restaurant_id).length + 1 };
  db.knowledge_categories.push(cat);
  await persist();
  res.status(201).json(cat);
}));

app.patch('/api/admin/knowledge/categories/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const category = db.knowledge_categories.find(c => c.id === req.params.id && c.restaurant_id === req.user.restaurant_id);
  if (!category) return res.status(404).json({ error: 'Папка не найдена' });
  const cleanTitle = String(req.body.title || '').trim();
  if (!cleanTitle) return res.status(400).json({ error: 'Название папки обязательно' });
  category.title = cleanTitle;
  if (Array.isArray(req.body.allowed_roles)) category.allowed_roles = req.body.allowed_roles;
  if (Number.isFinite(Number(req.body.sort_order))) category.sort_order = Number(req.body.sort_order);
  await persist();
  res.json(category);
}));

app.delete('/api/admin/knowledge/categories/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const category = db.knowledge_categories.find(c => c.id === req.params.id && c.restaurant_id === req.user.restaurant_id);
  if (!category) return res.status(404).json({ error: 'Папка не найдена' });

  const docsToDelete = db.knowledge_documents
    .filter(d => d.restaurant_id === req.user.restaurant_id && d.category_id === category.id)
    .map(d => d.id);
  const deletedDocs = docsToDelete.length;

  db.knowledge_acknowledgements = db.knowledge_acknowledgements
    .filter(a => !(a.restaurant_id === req.user.restaurant_id && docsToDelete.includes(a.document_id)));
  db.knowledge_views = db.knowledge_views
    .filter(v => !(v.restaurant_id === req.user.restaurant_id && docsToDelete.includes(v.document_id)));
  db.knowledge_documents = db.knowledge_documents
    .filter(d => !(d.restaurant_id === req.user.restaurant_id && d.category_id === category.id));
  db.knowledge_categories = db.knowledge_categories
    .filter(c => !(c.id === category.id && c.restaurant_id === req.user.restaurant_id));

  await persist();
  res.json({ ok: true, deleted_documents: deletedDocs });
}));

app.post('/api/admin/knowledge/documents', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const { category_id, title, content, allowed_roles, requires_acknowledgement, type, file_url, file, photo } = req.body;
  const category = db.knowledge_categories.find(c => c.id === category_id && c.restaurant_id === req.user.restaurant_id);
  if (!category) return res.status(400).json({ error: 'Выберите папку для документа' });

  const docType = String(type || 'text').trim() || 'text';
  const pdfLike = ['pdf', 'ttk', 'service_book'].includes(docType);
  let storedPdf = null;
  let storedPhoto = null;
  let parsedTtk = null;

  try {
    if (file?.data) {
      storedPdf = saveKnowledgeFile(file, req.user.restaurant_id, 'pdf');
      if (docType === 'ttk') parsedTtk = await parseTtkPdfBuffer(storedPdf.buffer);
    }
    if (photo?.data) storedPhoto = saveKnowledgeFile(photo, req.user.restaurant_id, 'image');
  } catch (error) {
    const fallback = docType === 'ttk'
      ? 'PDF загружен, но состав ТТК не удалось прочитать. Загрузите PDF с текстом, не скан.'
      : 'Не удалось загрузить файл. Проверьте формат PDF или изображения.';
    return res.status(400).json({ error: error.message || fallback });
  }

  if (pdfLike && !storedPdf?.url && !file_url) {
    return res.status(400).json({ error: 'Выберите PDF-файл' });
  }

  const uploadedName = String(storedPdf?.filename || file?.file_name || file?.name || '').trim();
  const fallbackTitle = uploadedName ? path.basename(uploadedName, path.extname(uploadedName)) : '';
  const cleanTitle = String(title || (docType === 'ttk' ? '' : fallbackTitle)).trim();
  const common = {
    restaurant_id: req.user.restaurant_id,
    category_id,
    type: docType,
    file_url: storedPdf?.url || file_url || '',
    photo_url: storedPhoto?.url || '',
    allowed_roles: Array.isArray(allowed_roles) ? allowed_roles : [],
    requires_acknowledgement: requires_acknowledgement !== false,
    version: 1,
    is_active: true,
    created_by: req.user.id,
    created_at: nowIso(),
    updated_at: nowIso(),
    sort_order: sameRestaurant(db.knowledge_documents, req.user.restaurant_id).filter(d => d.category_id === category_id).length + 1
  };

  if (docType === 'ttk') {
    const cards = parsedTtk?.cards?.length ? parsedTtk.cards : [];
    if (!cards.length) return res.status(400).json({ error: 'Не удалось найти ТТК в PDF' });
    const docs = cards.map((card, index) => ({
      id: uid('kdoc'),
      ...common,
      title: cleanTitle && cards.length === 1 ? cleanTitle : (card.title || cleanTitle || 'ТТК ' + (index + 1)),
      content: buildTtkContent(card),
      ingredients: card.ingredients || [],
      sort_order: common.sort_order + index
    }));
    docs.forEach(doc => db.knowledge_documents.push(doc));
    await persist();
    return res.status(201).json(cards.length === 1 ? docs[0] : { created: docs.length, documents: docs });
  }

  if (!cleanTitle) return res.status(400).json({ error: 'Укажите название документа' });
  const doc = {
    id: uid('kdoc'),
    ...common,
    title: cleanTitle,
    content: content || '',
    ingredients: []
  };
  db.knowledge_documents.push(doc);
  await persist();
  res.status(201).json(doc);
}));

app.patch('/api/admin/knowledge/documents/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const doc = db.knowledge_documents.find(d => d.id === req.params.id && d.restaurant_id === req.user.restaurant_id && d.is_active);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  const { category_id, title, content, allowed_roles, requires_acknowledgement, type, file_url, file, photo } = req.body;
  const nextCategoryId = category_id || doc.category_id;
  const category = db.knowledge_categories.find(c => c.id === nextCategoryId && c.restaurant_id === req.user.restaurant_id);
  if (!category) return res.status(400).json({ error: 'Выберите папку для документа' });

  const nextType = String(type || doc.type || 'text').trim() || 'text';
  const pdfLike = ['pdf', 'ttk', 'service_book'].includes(nextType);
  let storedPdf = null;
  let storedPhoto = null;
  let parsedTtk = null;

  try {
    if (file?.data) {
      storedPdf = saveKnowledgeFile(file, req.user.restaurant_id, 'pdf');
      if (nextType === 'ttk') parsedTtk = await parseTtkPdfBuffer(storedPdf.buffer);
    }
    if (photo?.data) storedPhoto = saveKnowledgeFile(photo, req.user.restaurant_id, 'image');
  } catch (error) {
    const fallback = nextType === 'ttk'
      ? 'PDF загружен, но состав ТТК не удалось прочитать. Загрузите PDF с текстом, не скан.'
      : 'Не удалось загрузить файл. Проверьте формат PDF или изображения.';
    return res.status(400).json({ error: error.message || fallback });
  }

  const nextFileUrl = storedPdf?.url || (typeof file_url === 'string' ? file_url : doc.file_url || '');
  if (pdfLike && !nextFileUrl) return res.status(400).json({ error: 'Выберите PDF-файл' });

  const uploadedName = String(storedPdf?.filename || file?.file_name || file?.name || '').trim();
  const fallbackTitle = uploadedName ? path.basename(uploadedName, path.extname(uploadedName)) : '';
  const cleanTitle = String(title || (nextType === 'ttk' ? '' : fallbackTitle)).trim();

  doc.category_id = nextCategoryId;
  doc.type = nextType;
  doc.allowed_roles = Array.isArray(allowed_roles) ? allowed_roles : doc.allowed_roles;
  doc.requires_acknowledgement = requires_acknowledgement !== false;
  doc.file_url = nextFileUrl;
  if (storedPhoto?.url) doc.photo_url = storedPhoto.url;

  if (nextType === 'ttk' && parsedTtk?.cards?.length) {
    const card = parsedTtk.cards[0];
    doc.title = cleanTitle || card.title || doc.title;
    doc.content = buildTtkContent(card);
    doc.ingredients = card.ingredients || [];
  } else {
    if (!cleanTitle) return res.status(400).json({ error: 'Укажите название документа' });
    doc.title = cleanTitle;
    doc.content = content || '';
    if (nextType !== 'ttk') doc.ingredients = [];
  }

  doc.version = Number(doc.version || 1) + 1;
  doc.updated_at = nowIso();
  await persist();
  res.json(doc);
}));

app.delete('/api/admin/knowledge/documents/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const doc = db.knowledge_documents.find(d => d.id === req.params.id && d.restaurant_id === req.user.restaurant_id && d.is_active);
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  doc.is_active = false;
  doc.updated_at = nowIso();
  await persist();
  res.json({ ok: true });
}));

app.post('/api/knowledge/:id/view', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const doc = db.knowledge_documents.find(d => d.id === req.params.id && d.restaurant_id === req.user.restaurant_id);
  if (!doc || !hasRoleAccess(req.user, doc.allowed_roles)) return res.status(404).json({ error: 'Документ не найден' });
  db.knowledge_views.push({ id: uid('kview'), restaurant_id: req.user.restaurant_id, document_id: doc.id, user_id: req.user.id, viewed_at: nowIso() });
  await persist();
  res.json({ ok: true });
}));

app.post('/api/knowledge/:id/ack', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const doc = db.knowledge_documents.find(d => d.id === req.params.id && d.restaurant_id === req.user.restaurant_id);
  if (!doc || !hasRoleAccess(req.user, doc.allowed_roles)) return res.status(404).json({ error: 'Документ не найден' });
  const exists = db.knowledge_acknowledgements.find(a => a.document_id === doc.id && a.user_id === req.user.id && a.version === doc.version);
  if (!exists) {
    db.knowledge_acknowledgements.push({ id: uid('kack'), restaurant_id: req.user.restaurant_id, document_id: doc.id, user_id: req.user.id, version: doc.version, acknowledged_at: nowIso() });
    logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'knowledge_acknowledged', title: `${req.user.name} ознакомился с "${doc.title}"`, entity_type: 'knowledge_document', entity_id: doc.id, metadata: { version: doc.version } });
  }
  await persist();
  res.json({ ok: true });
}));

app.get('/api/admin/knowledge/stats', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const docs = sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active);
  const employees = sameRestaurant(db.users, rid).filter(user => user.active !== false && !user.is_super_admin && user.role !== 'owner');
  res.json(docs.map(d => {
    const targets = d.requires_acknowledgement === false ? [] : employees.filter(employee => hasRoleAccess(employee, d.allowed_roles));
    const ackUserIds = new Set(db.knowledge_acknowledgements
      .filter(a => a.document_id === d.id && a.version === d.version)
      .map(a => a.user_id));
    return {
      ...d,
      views: db.knowledge_views.filter(v => v.document_id === d.id).length,
      acknowledgements: targets.length ? targets.filter(employee => ackUserIds.has(employee.id)).length : 0,
      targets_count: targets.length,
      pending_users: targets.filter(employee => !ackUserIds.has(employee.id)).map(publicUser)
    };
  }));
});


app.get('/api/billing', auth, billingAccess, (req, res) => {
  const rid = req.user.restaurant_id;
  const restaurant = db.restaurants.find(r => r.id === rid);
  res.json({
    restaurant,
    plans: billingPlans,
    seller_requisites_ready: sellerRequisitesReady(),
    transfer_requisites_ready: transferRequisitesReady(),
    transfer_requisites: currentTransferRequisites(),
    profile: publicBillingProfile(getBillingProfile(rid)),
    invoices: sameRestaurant(collection('billing_invoices'), rid).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    payments: sameRestaurant(collection('payments'), rid).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    documents: sameRestaurant(collection('closing_documents'), rid).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  });
});

app.patch('/api/billing/requisites', auth, billingAccess, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const body = req.body || {};
  let profile = getBillingProfile(rid);
  const payload = {
    customer_type: ['ip', 'ooo'].includes(String(body.customer_type)) ? String(body.customer_type) : 'ip',
    legal_name: String(body.legal_name || '').trim(),
    inn: String(body.inn || '').trim(),
    kpp: String(body.kpp || '').trim(),
    ogrn: String(body.ogrn || '').trim(),
    legal_address: String(body.legal_address || '').trim(),
    bank_name: String(body.bank_name || '').trim(),
    bik: String(body.bik || '').trim(),
    checking_account: String(body.checking_account || '').trim(),
    correspondent_account: String(body.correspondent_account || '').trim(),
    edo_operator: String(body.edo_operator || '').trim(),
    edo_id: String(body.edo_id || '').trim(),
    email: String(body.email || '').trim(),
    phone: String(body.phone || '').trim(),
    updated_at: nowIso()
  };
  if (!profile) {
    profile = { id: uid('billprof'), restaurant_id: rid, ...payload, created_at: nowIso() };
    collection('billing_profiles').push(profile);
  } else {
    Object.assign(profile, payload);
  }
  await persist();
  res.json(profile);
}));

app.post('/api/billing/invoices', auth, billingAccess, runAsync(async (req, res) => {
  res.status(403).json({ error: 'Счёт выставляет владелец приложения после заполнения реквизитов ресторана' });
}));

app.post('/api/billing/transfer-requests', auth, billingAccess, runAsync(async (req, res) => {
  res.status(403).json({ error: 'Сначала дождитесь выставленного счёта, затем отметьте его как оплаченный' });
}));

app.post('/api/billing/invoices/:id/report-paid', auth, billingAccess, runAsync(async (req, res) => {
  const invoice = collection('billing_invoices').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
  if (invoice.status === 'paid') return res.json(invoice);
  if (!['issued', 'payment_rejected', 'payment_document_attached', 'transfer_pending'].includes(invoice.status)) {
    return res.status(400).json({ error: 'По этому счёту уже отправлено уведомление об оплате' });
  }
  invoice.status = 'payment_reported';
  invoice.updated_at = nowIso();
  logActivity({ restaurant_id: invoice.restaurant_id, actor_id: req.user.id, type: 'invoice_payment_reported', title: `${req.user.name} отметил счёт № ${invoice.number} как оплаченный`, entity_type: 'billing_invoice', entity_id: invoice.id, metadata: { amount: invoice.amount } });
  notifyPlatformBilling(invoice, 'Клиент отметил оплату', `${req.restaurant?.name || 'Ресторан'}: счёт № ${invoice.number}, ${money(invoice.amount)}`);
  await persist();
  res.json(invoice);
}));

app.post('/api/billing/invoices/:id/payment-order', auth, billingAccess, runAsync(async (req, res) => {
  const invoice = collection('billing_invoices').find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Счёт уже оплачен' });
  let receipt;
  try {
    receipt = saveBillingReceipt(req.body?.receipt || req.body?.receipt_file, invoice.restaurant_id);
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Не удалось сохранить платёжное поручение' });
  }
  invoice.status = 'payment_document_attached';
  invoice.receipt_url = receipt.url;
  invoice.receipt_name = receipt.name;
  invoice.receipt_mime = receipt.mime_type;
  invoice.receipt_uploaded_at = receipt.uploaded_at;
  invoice.updated_at = nowIso();
  logActivity({ restaurant_id: invoice.restaurant_id, actor_id: req.user.id, type: 'payment_order_attached', title: `${req.user.name} прикрепил платёжное поручение к счёту № ${invoice.number}`, entity_type: 'billing_invoice', entity_id: invoice.id, metadata: { receipt_name: receipt.name } });
  notifyPlatformBilling(invoice, 'Платёжное поручение прикреплено', `${req.restaurant?.name || 'Ресторан'}: счёт № ${invoice.number}`);
  await persist();
  res.json(invoice);
}));

app.get('/api/billing/invoices/:id/html', auth, billingAccess, (req, res) => {
  const invoice = collection('billing_invoices').find(item => item.id === req.params.id && (req.user.is_super_admin || item.restaurant_id === req.user.restaurant_id));
  if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
  const restaurant = db.restaurants.find(r => r.id === invoice.restaurant_id);
  const rows = [{
    name: `Доступ к сервису Resto Control, тариф «${invoice.plan_title}», период ${dateOnly(invoice.period_start)} — ${dateOnly(invoice.period_end)}`,
    qty: `${invoice.months} мес.`,
    price: Number(invoice.amount || 0) / Math.max(1, Number(invoice.months || 1)),
    amount: invoice.amount
  }];
  const html = billingDocumentHtml({
    title: 'Счёт на оплату',
    number: invoice.number,
    restaurant,
    customer: invoice.customer_requisites || {},
    seller: invoice.seller_requisites || {},
    rows,
    total: invoice.amount,
    footerTitle: 'Назначение платежа',
    footerText: `Оплата по счёту № ${invoice.number} за доступ к сервису Resto Control. ${invoice.seller_requisites?.tax_note || 'Без НДС'}.`
  });
  sendHtml(res, `invoice-${invoice.number}.html`, html);
});

app.get('/api/billing/documents/:id/html', auth, billingAccess, (req, res) => {
  const doc = collection('closing_documents').find(item => item.id === req.params.id && (req.user.is_super_admin || item.restaurant_id === req.user.restaurant_id));
  if (!doc) return res.status(404).json({ error: 'Документ не найден' });
  const invoice = collection('billing_invoices').find(item => item.id === doc.invoice_id && (req.user.is_super_admin || item.restaurant_id === req.user.restaurant_id));
  if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
  const restaurant = db.restaurants.find(r => r.id === invoice.restaurant_id);
  const rows = [{
    name: `Услуги доступа к сервису Resto Control, тариф «${invoice.plan_title}», период ${dateOnly(doc.period_start)} — ${dateOnly(doc.period_end)}`,
    qty: `${invoice.months} мес.`,
    price: Number(doc.amount || 0) / Math.max(1, Number(invoice.months || 1)),
    amount: doc.amount
  }];
  const html = billingDocumentHtml({
    title: doc.type === 'upd' ? 'УПД' : 'Акт оказанных услуг',
    number: doc.number,
    restaurant,
    customer: invoice.customer_requisites || {},
    seller: invoice.seller_requisites || {},
    rows,
    total: doc.amount,
    footerTitle: 'Основание',
    footerText: `Услуги оказаны за период ${dateOnly(doc.period_start)} — ${dateOnly(doc.period_end)}. Претензий по объёму и качеству услуг нет.`
  });
  sendHtml(res, `${doc.type}-${doc.number}.html`, html);
});

app.get('/api/super/billing/invoices', auth, superOnly, (req, res) => {
  const rows = collection('billing_invoices')
    .map(invoice => ({
      ...invoice,
      restaurant: db.restaurants.find(r => r.id === invoice.restaurant_id) || null,
      payments: collection('payments').filter(payment => payment.invoice_id === invoice.id),
      documents: collection('closing_documents').filter(doc => doc.invoice_id === invoice.id)
    }))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  res.json(rows);
});

app.post('/api/super/billing/invoices', auth, superOnly, runAsync(async (req, res) => {
  let invoice;
  try {
    invoice = buildBillingInvoice({
      restaurantId: String(req.body?.restaurant_id || '').trim(),
      planId: req.body?.plan,
      months: req.body?.months,
      periodStartValue: req.body?.period_start
    });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message || 'Не удалось выставить счёт' });
  }
  collection('billing_invoices').push(invoice);
  const restaurant = db.restaurants.find(r => r.id === invoice.restaurant_id);
  logActivity({ restaurant_id: invoice.restaurant_id, actor_id: req.user.id, type: 'invoice_issued_by_platform', title: `Выставлен счёт № ${invoice.number}`, entity_type: 'billing_invoice', entity_id: invoice.id, metadata: { amount: invoice.amount, plan: invoice.plan, months: invoice.months } });
  notifyUsers(invoice.restaurant_id, restaurantBillingUsers(invoice.restaurant_id), {
    title: 'Выставлен счёт на оплату',
    body: `Счёт № ${invoice.number} на ${money(invoice.amount)} доступен в разделе оплаты`,
    entity_type: 'billing_invoice',
    entity_id: invoice.id
  });
  await persist();
  res.status(201).json({ ...invoice, restaurant });
}));

app.post('/api/super/billing/invoices/:id/mark-paid', auth, superOnly, runAsync(async (req, res) => {
  const invoice = collection('billing_invoices').find(item => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
  let payment = collection('payments').find(item => item.invoice_id === invoice.id);
  if (invoice.status === 'paid' && payment) {
    const restaurant = db.restaurants.find(r => r.id === invoice.restaurant_id);
    const document = collection('closing_documents').find(doc => doc.invoice_id === invoice.id) || null;
    return res.json({ invoice, payment, document, restaurant });
  }
  invoice.status = 'paid';
  invoice.paid_at = String(req.body?.paid_at || nowIso());
  invoice.updated_at = nowIso();
  if (!payment) {
    payment = {
      id: uid('pay'),
      restaurant_id: invoice.restaurant_id,
      invoice_id: invoice.id,
      amount: invoice.amount,
      currency: invoice.currency || 'RUB',
      method: invoice.seller_requisites?.payment_method === 'manual_transfer' ? 'manual_transfer' : 'bank_transfer',
      reference: String(req.body?.reference || '').trim(),
      comment: String(req.body?.comment || '').trim(),
      paid_at: invoice.paid_at,
      created_by: req.user.id,
      created_at: nowIso()
    };
    collection('payments').push(payment);
  }
  let closingDocument = collection('closing_documents').find(doc => doc.invoice_id === invoice.id);
  if (!closingDocument) {
    closingDocument = {
      id: uid('close'),
      restaurant_id: invoice.restaurant_id,
      invoice_id: invoice.id,
      type: 'act',
      number: closingDocumentNumber('act'),
      status: 'issued',
      period_start: invoice.period_start,
      period_end: invoice.period_end,
      amount: invoice.amount,
      currency: invoice.currency || 'RUB',
      issued_at: invoice.period_end,
      signed_at: null,
      created_at: nowIso()
    };
    collection('closing_documents').push(closingDocument);
  }
  const restaurant = db.restaurants.find(r => r.id === invoice.restaurant_id);
  if (restaurant) {
    restaurant.plan = invoice.plan;
    restaurant.subscription_status = 'active';
    restaurant.subscription_started_at = invoice.period_start;
    restaurant.subscription_ends_at = invoice.period_end;
  }
  notifyUsers(invoice.restaurant_id, restaurantBillingUsers(invoice.restaurant_id), {
    title: 'Оплата подтверждена',
    body: `Подписка по счёту № ${invoice.number} активирована до ${dateOnly(invoice.period_end)}`,
    entity_type: 'billing_invoice',
    entity_id: invoice.id
  });
  await persist();
  res.json({ invoice, payment, document: closingDocument, restaurant });
}));

app.post('/api/super/billing/invoices/:id/no-payment', auth, superOnly, runAsync(async (req, res) => {
  const invoice = collection('billing_invoices').find(item => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Счёт не найден' });
  if (invoice.status === 'paid') return res.status(400).json({ error: 'Счёт уже оплачен' });
  invoice.status = 'payment_rejected';
  invoice.paid_at = null;
  invoice.updated_at = nowIso();
  const comment = String(req.body?.comment || '').trim();
  logActivity({ restaurant_id: invoice.restaurant_id, actor_id: req.user.id, type: 'invoice_payment_rejected', title: `Платёж по счёту № ${invoice.number} не найден`, entity_type: 'billing_invoice', entity_id: invoice.id, metadata: { comment } });
  notifyUsers(invoice.restaurant_id, restaurantBillingUsers(invoice.restaurant_id), {
    title: 'Платёж не прошёл',
    body: `По счёту № ${invoice.number} платёж не найден. Прикрепите платёжное поручение в разделе оплаты.`,
    entity_type: 'billing_invoice',
    entity_id: invoice.id
  });
  await persist();
  res.json({ invoice, restaurant: db.restaurants.find(r => r.id === invoice.restaurant_id) || null });
}));


app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

function setStaticCacheHeaders(res, filePath) {
  const filename = path.basename(filePath);
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  if (['index.html', 'app-version.json', 'manifest.webmanifest', 'manifest-bookings.webmanifest', 'sw.js'].includes(filename)) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
}

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(webDist, { setHeaders: setStaticCacheHeaders }));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(webDist, 'index.html'), err => {
    if (err) res.status(200).send('Resto Control API is running. Build webapp to serve UI.');
  });
});

app.listen(PORT, () => {
  console.log(`✅ Resto Control MVP started on port ${PORT}`);
  console.log(`Local API: http://localhost:${PORT}`);
  console.log(`Trial days: ${process.env.TRIAL_DAYS || 14}`);
  console.log(`Super admin: ${process.env.SUPER_ADMIN_LOGIN || 'admin'}`);
});
