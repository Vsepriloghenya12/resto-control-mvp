import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
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
const MANAGER_ROLES = ['owner', 'manager'];
const SENIOR_ROLE_DEPARTMENT = { senior_waiter: 'hall', senior_bartender: 'bar', senior_cook: 'kitchen' };
const SENIOR_ROLES = Object.keys(SENIOR_ROLE_DEPARTMENT);
const DEPARTMENT_ROLE_MAP = {
  hall: ['senior_waiter', 'waiter', 'hostess'],
  bar: ['senior_bartender', 'bartender'],
  kitchen: ['senior_cook', 'cook'],
  common: ['manager']
};
const STAFF_ROLES = ['manager', 'senior_waiter', 'senior_bartender', 'senior_cook', 'hostess', 'waiter', 'bartender', 'cook'];
const departments = { hall: 'Зал', bar: 'Бар', kitchen: 'Кухня', common: 'Общее' };
const techRequestStatuses = { new: 'новая', in_progress: 'в работе', done: 'выполнена', cancelled: 'отклонена' };
const productRequestStatuses = { sent: 'отправлена', ordered: 'заказано', partial: 'частично пришло', received: 'получено', done: 'завершена', not_received: 'не получено', cancelled: 'отменена' };
const problemTypeLabels = { task: 'Задача', tech_request: 'Техзаявка', product_request: 'Заявка' };
const bookingStatuses = { booked: 'забронирован', seated: 'гости пришли', completed: 'завершён', cancelled: 'отменён' };
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

function normalizeRequestItems(restaurant_id, department, rawItems = []) {
  const positiveItems = Array.isArray(rawItems) ? rawItems.filter(i => Number(i?.qty_ordered) > 0) : [];
  if (!positiveItems.length) {
    return { error: 'Добавьте хотя бы одну позицию' };
  }

  const items = [];
  for (const item of positiveItems) {
    const product = db.products.find(p => p.id === item.product_id && p.restaurant_id === restaurant_id && p.active);
    if (!product) {
      return { error: 'Одна или несколько позиций не найдены' };
    }
    if (product.department !== department) {
      return { error: 'В заявке могут быть только товары выбранного отдела' };
    }
    items.push({
      product_id: product.id,
      qty_ordered: Number(item.qty_ordered),
      comment: item.comment || ''
    });
  }

  return { items };
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
    .replace(/^ИТОГО.*$/i, '')
    .trim();
}

function lineLooksLikeTtkName(line) {
  const text = normalizeTtkIngredientName(line);
  if (!text || /^\d/.test(text)) return false;
  if (/^(название|область|хранение|срок|органолептические|требования|итого|вес готового)/i.test(text)) return false;
  if (/^(№|наименование|ед\.?.*изм|брутто|вес|технология)/i.test(text)) return false;
  return /[а-яёa-z]/i.test(text);
}

function parseTtkBlock(block) {
  const source = String(block || '').replace(/\r/g, '');
  const number = cleanTtkText(source.match(/^(\s*\d+)/)?.[1] || source.match(/№\s*(\d+)/)?.[1] || '');
  const titleMatch = source.match(/(\d{2}\.\d{2}\.\d{4})\s+([\s\S]*?)(?:Название на чеке|Область применения|№\s+Наименование)/i);
  const date = titleMatch?.[1] || '';
  const title = cleanTtkText(titleMatch?.[2] || source.split('\n').slice(0, 3).join(' ')).replace(/^\d+\s*/, '');
  const lines = source.split('\n').map(line => cleanTtkText(line)).filter(Boolean);
  const ingredients = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const row = line.match(/^(\d+)\s+(.+)$/);
    if (!row) continue;
    const rest = row[2];
    const withName = rest.match(/^(.+?)\s+(кг|г|л|мл|шт\.?|порц\.?)\s+((?:\d+[,.]?\d*\s*)+)$/i);
    const noName = rest.match(/^(кг|г|л|мл|шт\.?|порц\.?)\s+((?:\d+[,.]?\d*\s*)+)$/i);
    let name = '';
    let unit = '';
    let amounts = [];

    if (withName) {
      name = normalizeTtkIngredientName(withName[1]);
      unit = withName[2];
      amounts = withName[3].trim().split(/\s+/);
    } else if (noName) {
      unit = noName[1];
      amounts = noName[2].trim().split(/\s+/);
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
        if (lineLooksLikeTtkName(lines[j])) {
          name = normalizeTtkIngredientName(lines[j]);
          break;
        }
      }
    }

    const qty = parseTtkNumber(amounts[amounts.length - 1]);
    if (name && unit && qty !== null) {
      const key = `${name.toLowerCase()}::${unit}::${qty}`;
      if (!ingredients.some(item => `${item.name.toLowerCase()}::${item.unit}::${item.qty}` === key)) {
        ingredients.push({ name, unit, qty, display_qty: String(amounts[amounts.length - 1] || '').replace('.', ',') });
      }
    }
  }

  return { number, date, title: title || (number ? `ТТК № ${number}` : 'ТТК'), ingredients };
}

async function parseTtkPdfBuffer(buffer) {
  const mod = await import('pdf-parse');
  const pdfParse = mod.default || mod;
  const parsed = await pdfParse(buffer);
  const text = parsed.text || '';
  const parts = text.split(/Технологическая карта\s*№/i).map(part => part.trim()).filter(Boolean);
  const cards = (parts.length ? parts : [text]).map(parseTtkBlock).filter(card => card.title || card.ingredients.length);
  return { text, cards };
}

function buildTtkContent(card) {
  const lines = [];
  lines.push(`Технологическая карта${card.number ? ` № ${card.number}` : ''}`);
  if (card.date) lines.push(`Дата: ${card.date}`);
  if (card.title) lines.push(`Блюдо/напиток: ${card.title}`);
  lines.push('');
  lines.push('Состав:');
  if (card.ingredients.length) {
    card.ingredients.forEach(item => lines.push(`- ${item.name}: ${item.display_qty || item.qty} ${item.unit}`));
  } else {
    lines.push('- Состав не удалось извлечь автоматически. Проверьте PDF и заполните вручную.');
  }
  return lines.join('\n');
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
  const openRequests = sameRestaurant(db.product_requests, rid).filter(r => !['received', 'done', 'cancelled'].includes(r.status));
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
    ...openTech.slice(0, 8).map(t => ({ id: `tech-${t.id}`, tone: t.status === 'new' ? 'warning' : 'info', title: t.title, subtitle: `Техзаявка · ${techRequestStatuses[t.status] || t.status}`, type: 'tech_request', type_label: problemTypeLabels.tech_request, entity_id: t.id })),
    ...openRequests.slice(0, 8).map(r => ({ id: `request-${r.id}`, tone: 'warning', title: `Заявка ${departments[r.department] || r.department}`, subtitle: `${productRequestStatuses[r.status] || r.status} · ${fmtDate(r.created_at)}`, type: 'product_request', type_label: problemTypeLabels.product_request, entity_id: r.id }))
  ];
  res.json({ metrics: { open_shifts: collection('shifts').filter(s => s.restaurant_id === rid && s.status === 'open').length, open_tasks: openAssignments.length, overdue_tasks: overdueAssignments.length, open_tech_requests: openTech.length, open_product_requests: openRequests.length, checklist_runs_today: sameRestaurant(db.checklist_runs, rid).filter(r => String(r.created_at||'').slice(0,10) === today).length, pending_acknowledgements: pendingAck }, problems: problems.slice(0,20) });
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
    return {
      ...r,
      computed_status: restaurantStatus(r),
      users_count: users.length,
      checklist_runs_count: db.checklist_runs.filter(x => x.restaurant_id === r.id).length,
      requests_count: db.product_requests.filter(x => x.restaurant_id === r.id).length
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

// RESTAURANT OVERVIEW
app.get('/api/admin/overview', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.is_super_admin ? req.query.restaurant_id : req.user.restaurant_id;
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    restaurant: db.restaurants.find(r => r.id === rid),
    users: sameRestaurant(db.users, rid).filter(u => !u.is_super_admin).length,
    checklists_today: sameRestaurant(db.checklist_runs, rid).filter(r => r.created_at?.slice(0, 10) === today).length,
    requests_open: sameRestaurant(db.product_requests, rid).filter(r => !['received', 'cancelled'].includes(r.status)).length,
    inventories: sameRestaurant(db.inventory_runs, rid).length,
    tasks_open: sameRestaurant(db.task_assignments, rid).filter(a => !a.done).length,
    docs: sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active).length
  });
});

// USERS
app.get('/api/admin/users', auth, ensureRestaurantActive, operationalEditorOnly, (req, res) => {
  const rid = req.user.restaurant_id || req.query.restaurant_id;
  const manageableDepartmentName = manageableDepartment(req.user);
  const rows = sameRestaurant(db.users, rid)
    .filter(u => !u.is_super_admin)
    .filter(u => !manageableDepartmentName || u.department === manageableDepartmentName || canManageRole(req.user, u.role))
    .map(publicUser);
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
    role: normalizedRole,
    department: department || roleToDepartment(normalizedRole),
    active: true,
    is_super_admin: false,
    created_at: nowIso()
  };
  db.users.push(user);
  await persist();
  res.status(201).json(publicUser(user));
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
  if (req.body.password) user.password_hash = hashPassword(req.body.password);
  await persist();
  res.json(publicUser(user));
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
  const manageableRoles = manageableRolesForUser(req.user);
  const role = MANAGER_ROLES.includes(req.user.role) ? req.query.role : req.user.role;
  const templates = sameRestaurant(db.checklist_templates, rid)
    .filter(t => t.active)
    .filter(t => {
      if (MANAGER_ROLES.includes(req.user.role)) return !role || t.role === role || role === req.user.role;
      if (SENIOR_ROLES.includes(req.user.role)) return manageableRoles.includes(t.role);
      return t.role === req.user.role;
    })
    .map(t => ({ ...t, items: db.checklist_items.filter(i => i.template_id === t.id).sort((a, b) => a.sort_order - b.sort_order) }));
  res.json(templates);
});

app.post('/api/admin/checklists/templates', auth, ensureRestaurantActive, operationalEditorOnly, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const { title, role, type, items } = req.body;
  if (!title || !role || !type) return res.status(400).json({ error: 'Нужны название, роль и тип' });
  if (!STAFF_ROLES.includes(String(role))) return res.status(400).json({ error: 'Чек-лист можно назначить только рабочей роли, не владельцу' });
  if (!canManageRole(req.user, String(role))) return res.status(403).json({ error: 'Можно редактировать чек-листы только своего подразделения' });
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
  if (!STAFF_ROLES.includes(nextRole)) {
    return res.status(400).json({ error: 'Чек-лист можно назначить только рабочей роли, не владельцу' });
  }
  if (!canManageRole(req.user, template.role) || !canManageRole(req.user, nextRole)) {
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

app.post('/api/checklists/runs', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const { template_id, answers, comment } = req.body;
  const template = db.checklist_templates.find(t => t.id === template_id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Чек-лист не найден' });
  if (req.user.role === 'owner') return res.status(403).json({ error: 'Владелец редактирует чек-листы, но не выполняет их' });
  if (!['manager', template.role].includes(req.user.role)) return res.status(403).json({ error: 'Этот чек-лист не для вашей роли' });
  const templateItems = db.checklist_items.filter(i => i.template_id === template.id);
  const missingRequiredItem = templateItems.find(item => item.required && !answers?.[item.id]?.done);
  if (missingRequiredItem) return res.status(400).json({ error: `Обязательный пункт "${missingRequiredItem.text}" не выполнен` });
  const missingPhotoItem = templateItems.find(item => {
    const value = answers?.[item.id] || {};
    return Boolean(item.needs_photo) && Boolean(value.done) && !value.photo_url;
  });
  if (missingPhotoItem) return res.status(400).json({ error: `Для пункта "${missingPhotoItem.text}" нужно сделать фото` });
  const missingCommentItem = templateItems.find(item => {
    const value = answers?.[item.id] || {};
    return Boolean(item.needs_comment) && Boolean(value.done) && !String(value.comment || '').trim();
  });
  if (missingCommentItem) return res.status(400).json({ error: `Для пункта "${missingCommentItem.text}" нужен комментарий` });

  const run = { id: uid('clrun'), restaurant_id: rid, template_id, user_id: req.user.id, status: 'completed', comment: comment || '', created_at: nowIso(), completed_at: nowIso() };
  db.checklist_runs.push(run);
  try {
    templateItems.forEach(item => {
      const value = answers?.[item.id] || {};
      const done = Boolean(value.done);
      const photo_url = done && value.photo_url ? saveChecklistPhoto(value.photo_url, rid, run.id, item.id) : '';
      db.checklist_answers.push({ id: uid('clans'), restaurant_id: rid, run_id: run.id, item_id: item.id, done, comment: value.comment || '', photo_url });
    });
  } catch (error) {
    db.checklist_runs = db.checklist_runs.filter(savedRun => savedRun.id !== run.id);
    return res.status(400).json({ error: error.message || 'Не удалось сохранить фото' });
  }
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'checklist_completed', title: `${req.user.name} завершил чек-лист "${template.title}"`, entity_type: 'checklist_run', entity_id: run.id, metadata: { total: templateItems.length } });
  notifyManagers(rid, { title: 'Чек-лист выполнен', body: `${req.user.name}: ${template.title}`, entity_type: 'checklist_run', entity_id: run.id });
  await persist();
  res.status(201).json(run);
}));

app.get('/api/admin/checklists/runs', auth, ensureRestaurantActive, operationalEditorOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const rows = sameRestaurant(db.checklist_runs, rid).map(run => ({
    ...run,
    user: publicUser(db.users.find(u => u.id === run.user_id)),
    template: db.checklist_templates.find(t => t.id === run.template_id),
    answers: db.checklist_answers.filter(a => a.run_id === run.id)
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const visibleRows = SENIOR_ROLES.includes(req.user.role) ? rows.filter(row => canManageRole(req.user, row.template?.role)) : rows;
  res.json(visibleRows);
});

// PRODUCTS
app.get('/api/products', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const department = req.query.department || (['owner', 'manager'].includes(req.user.role) ? null : req.user.department);
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

// REQUESTS
app.get('/api/requests', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const department = req.query.department || (['owner', 'manager'].includes(req.user.role) ? null : req.user.department);
  const rows = sameRestaurant(db.product_requests, rid)
    .filter(r => !department || r.department === department)
    .map(r => ({
      ...r,
      created_by_user: publicUser(db.users.find(u => u.id === r.created_by)),
      items: db.request_items.filter(i => i.request_id === r.id).map(i => ({ ...i, product: db.products.find(p => p.id === i.product_id) }))
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(rows);
});

app.post('/api/requests', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const department = req.body.department || req.user.department;
  if (!['owner', 'manager'].includes(req.user.role) && department !== req.user.department) return res.status(403).json({ error: 'Нельзя создавать заявки другого отдела' });
  const normalized = normalizeRequestItems(rid, department, req.body.items);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const request = { id: uid('req'), restaurant_id: rid, department, created_by: req.user.id, status: 'sent', comment: req.body.comment || '', created_at: nowIso(), updated_at: nowIso() };
  db.product_requests.push(request);
  normalized.items.forEach(i => {
    db.request_items.push({ id: uid('reqi'), restaurant_id: rid, request_id: request.id, product_id: i.product_id, qty_ordered: i.qty_ordered, qty_received: 0, status: 'ordered', comment: i.comment });
  });
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'request_created', title: `${req.user.name} создал заявку ${departments[department] || department}`, entity_type: 'product_request', entity_id: request.id, metadata: { department, items_count: normalized.items.length } });
  notifyManagers(rid, { title: 'Новая заявка', body: `${req.user.name} · ${departments[department] || department}`, entity_type: 'product_request', entity_id: request.id });
  await persist();
  res.status(201).json(request);
}));

app.patch('/api/requests/:id/receive', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const request = db.product_requests.find(r => r.id === req.params.id && r.restaurant_id === rid);
  if (!request) return res.status(404).json({ error: 'Заявка не найдена' });
  if (!['owner', 'manager'].includes(req.user.role) && request.department !== req.user.department) return res.status(403).json({ error: 'Нет доступа к этой заявке' });
  const received = req.body.received || {};
  const items = db.request_items.filter(i => i.request_id === request.id);
  items.forEach(i => {
    if (received[i.id] !== undefined) i.qty_received = Number(received[i.id] || 0);
    if (i.qty_received <= 0) i.status = 'not_received';
    else if (i.qty_received < i.qty_ordered) i.status = 'partial';
    else i.status = 'received';
  });
  const allReceived = items.every(i => i.status === 'received');
  const someReceived = items.some(i => ['received', 'partial'].includes(i.status));
  request.status = allReceived ? 'received' : someReceived ? 'partial' : 'sent';
  request.updated_at = nowIso();
  await persist();
  res.json({ ...request, items });
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
  const department = req.query.department || (['owner', 'manager'].includes(req.user.role) ? null : req.user.department);
  const rows = sameRestaurant(db.inventory_templates, rid)
    .filter(t => t.active && (!department || t.department === department))
    .map(t => ({ ...t, items: db.inventory_template_items.filter(i => i.template_id === t.id).map(i => ({ ...i, product: db.products.find(p => p.id === i.product_id) })) }));
  res.json(rows);
});

app.post('/api/inventory/runs', auth, ensureRestaurantActive, runAsync(async (req, res) => {
  const rid = req.user.restaurant_id;
  const { template_id, values, comment } = req.body;
  const template = db.inventory_templates.find(t => t.id === template_id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Бланк инвентаризации не найден' });
  if (!['owner', 'manager'].includes(req.user.role) && template.department !== req.user.department) return res.status(403).json({ error: 'Нет доступа к этой инвентаризации' });

  const parsedValues = [];
  for (const [product_id, value] of Object.entries(values || {})) {
    const parsed = parseInventoryQuantity(value);
    if (parsed.error) {
      const product = db.products.find(p => p.id === product_id);
      return res.status(400).json({ error: `${product?.name || 'Позиция'}: ${parsed.error}` });
    }
    parsedValues.push({ product_id, qty: parsed.qty, expression: parsed.expression, comment: typeof value === 'object' && value !== null ? value.comment || '' : '' });
  }

  const run = { id: uid('invrun'), restaurant_id: rid, template_id, user_id: req.user.id, department: template.department, comment: comment || '', status: 'completed', created_at: nowIso() };
  db.inventory_runs.push(run);
  parsedValues.forEach(value => db.inventory_values.push({ id: uid('invv'), restaurant_id: rid, inventory_run_id: run.id, product_id: value.product_id, qty: value.qty, comment: value.expression || value.comment || '' }));
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'inventory_completed', title: `${req.user.name} отправил инвентаризацию "${template.title}"`, entity_type: 'inventory_run', entity_id: run.id, metadata: { template_id, department: template.department } });
  notifyManagers(rid, { title: 'Инвентаризация отправлена', body: `${req.user.name}: ${template.title}`, entity_type: 'inventory_run', entity_id: run.id });
  await persist();
  res.status(201).json(run);
}));

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

  if (!title) return res.status(400).json({ error: 'Нужно указать тему заявки' });

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
  logActivity({ restaurant_id: rid, actor_id: req.user.id, type: 'tech_request_created', title: `${req.user.name} создал техзаявку "${title}"`, entity_type: 'tech_request', entity_id: request.id, metadata: { category } });
  notifyManagers(rid, { title: 'Новая техзаявка', body: `${req.user.name}: ${title}`, entity_type: 'tech_request', entity_id: request.id });
  await persist();
  res.status(201).json(request);
}));

app.patch('/api/tech-requests/:id', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const request = db.tech_requests.find(item => item.id === req.params.id && item.restaurant_id === req.user.restaurant_id);
  if (!request) return res.status(404).json({ error: 'Техзаявка не найдена' });

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
  logActivity({ restaurant_id: req.user.restaurant_id, actor_id: req.user.id, type: 'tech_request_updated', title: `${req.user.name} обновил техзаявку "${request.title}"`, entity_type: 'tech_request', entity_id: request.id, metadata: { status: request.status, manager_comment: request.manager_comment } });
  notifyUsers(req.user.restaurant_id, [db.users.find(user => user.id === request.created_by)], { title: 'Техзаявка обновлена', body: `${request.title}: ${techRequestStatuses[request.status] || request.status}`, entity_type: 'tech_request', entity_id: request.id });

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
  res.json(cats.map(c => ({ ...c, documents: docs.filter(d => d.category_id === c.id).map(d => ({ ...d, acknowledged: db.knowledge_acknowledgements.some(a => a.document_id === d.id && a.user_id === req.user.id && a.version === d.version) })) })));
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

app.post('/api/admin/knowledge/documents', auth, ensureRestaurantActive, adminOnly, runAsync(async (req, res) => {
  const { category_id, title, content, allowed_roles, requires_acknowledgement, type, file_url, file, photo } = req.body;
  const category = db.knowledge_categories.find(c => c.id === category_id && c.restaurant_id === req.user.restaurant_id);
  if (!category) return res.status(400).json({ error: 'Выберите папку для документа' });

  const docType = String(type || 'text').trim() || 'text';
  let storedPdf = null;
  let storedPhoto = null;
  let parsedTtk = null;

  if (file?.data) {
    storedPdf = saveKnowledgeFile(file, req.user.restaurant_id, 'pdf');
    if (docType === 'ttk') {
      try {
        parsedTtk = await parseTtkPdfBuffer(storedPdf.buffer);
      } catch (error) {
        return res.status(400).json({ error: 'PDF загружен, но состав ТТК не удалось прочитать. Загрузите PDF с текстом, не скан.' });
      }
    }
  }
  if (photo?.data) storedPhoto = saveKnowledgeFile(photo, req.user.restaurant_id, 'image');

  const cleanTitle = String(title || '').trim();
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
      title: cleanTitle && cards.length === 1 ? cleanTitle : (card.title || cleanTitle || `ТТК ${index + 1}`),
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
  res.json(docs.map(d => ({
    ...d,
    views: db.knowledge_views.filter(v => v.document_id === d.id).length,
    acknowledgements: db.knowledge_acknowledgements.filter(a => a.document_id === d.id && a.version === d.version).length
  })));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.use('/uploads', express.static(uploadsDir));
app.use(express.static(webDist));
app.get('*', (req, res) => {
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
