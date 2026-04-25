import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
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
  createRestaurantWithDefaults
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDist = path.resolve(__dirname, '../webapp/dist');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

let db = loadDb();

function persist() {
  saveDb(db);
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
  if (!['owner', 'manager'].includes(req.user?.role)) return res.status(403).json({ error: 'Доступ только для владельца или управляющего' });
  next();
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
  return items.filter(i => i.restaurant_id === restaurant_id);
}

function hasRoleAccess(user, allowedRoles = []) {
  if (!allowedRoles || allowedRoles.length === 0) return true;
  if (['owner', 'manager'].includes(user.role)) return true;
  return allowedRoles.includes(user.role);
}

function makeAssignmentsForTask(task) {
  const candidates = db.users.filter(u => u.restaurant_id === task.restaurant_id && u.active && !u.is_super_admin);
  const selected = candidates.filter(u => {
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

app.post('/api/auth/register-restaurant', (req, res) => {
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
  persist();
  const user = db.users.find(u => u.restaurant_id === restaurant.id && u.login === login);
  res.status(201).json({ token: sign(user), user: publicUser(user), restaurant, trial_days: Number(process.env.TRIAL_DAYS || 14) });
});

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

app.post('/api/super/restaurants', auth, superOnly, (req, res) => {
  const { name, owner_name, city, phone, email, login, password } = req.body;
  if (!name || !owner_name || !login || !password) return res.status(400).json({ error: 'Заполните ресторан, владельца, логин и пароль' });
  if (db.users.some(u => u.login === login)) return res.status(409).json({ error: 'Логин уже занят' });
  const restaurant = createRestaurantWithDefaults(db, { name, owner_name, city, phone, email, login, password });
  persist();
  res.status(201).json(restaurant);
});

app.patch('/api/super/restaurants/:id/subscription', auth, superOnly, (req, res) => {
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
  persist();
  res.json(restaurant);
});

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
app.get('/api/admin/users', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id || req.query.restaurant_id;
  res.json(sameRestaurant(db.users, rid).filter(u => !u.is_super_admin).map(publicUser));
});

app.post('/api/admin/users', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id || req.body.restaurant_id;
  const { name, login, password, role, department } = req.body;
  if (!name || !login || !password || !role) return res.status(400).json({ error: 'Заполните имя, логин, пароль и роль' });
  if (db.users.some(u => u.login === login)) return res.status(409).json({ error: 'Такой логин уже есть' });
  const user = { id: uid('user'), restaurant_id: rid, name, login, password_hash: hashPassword(password), role, department: department || roleToDepartment(role), active: true, is_super_admin: false, created_at: nowIso() };
  db.users.push(user);
  persist();
  res.status(201).json(publicUser(user));
});

app.patch('/api/admin/users/:id', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const user = db.users.find(u => u.id === req.params.id && u.restaurant_id === req.user.restaurant_id);
  if (!user) return res.status(404).json({ error: 'Сотрудник не найден' });
  ['name', 'role', 'department', 'active'].forEach(k => {
    if (req.body[k] !== undefined) user[k] = req.body[k];
  });
  if (req.body.password) user.password_hash = hashPassword(req.body.password);
  persist();
  res.json(publicUser(user));
});

// CHECKLISTS
app.get('/api/checklists/templates', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const role = ['owner', 'manager'].includes(req.user.role) ? req.query.role : req.user.role;
  const templates = sameRestaurant(db.checklist_templates, rid)
    .filter(t => t.active && (!role || t.role === role || ['owner', 'manager'].includes(req.user.role)))
    .map(t => ({ ...t, items: db.checklist_items.filter(i => i.template_id === t.id).sort((a, b) => a.sort_order - b.sort_order) }));
  res.json(templates);
});

app.post('/api/admin/checklists/templates', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const { title, role, type, items } = req.body;
  if (!title || !role || !type || !Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Нужны title, role, type и items' });
  const template = { id: uid('cltpl'), restaurant_id: rid, title, role, type, active: true, created_at: nowIso() };
  db.checklist_templates.push(template);
  items.forEach((it, idx) => db.checklist_items.push({ id: uid('cli'), restaurant_id: rid, template_id: template.id, text: typeof it === 'string' ? it : it.text, required: true, needs_comment: false, needs_photo: false, sort_order: idx + 1 }));
  persist();
  res.status(201).json({ ...template, items: db.checklist_items.filter(i => i.template_id === template.id) });
});

app.post('/api/checklists/runs', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const { template_id, answers, comment } = req.body;
  const template = db.checklist_templates.find(t => t.id === template_id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Чек-лист не найден' });
  if (!['owner', 'manager', template.role].includes(req.user.role)) return res.status(403).json({ error: 'Этот чек-лист не для вашей роли' });
  const run = { id: uid('clrun'), restaurant_id: rid, template_id, user_id: req.user.id, status: 'completed', comment: comment || '', created_at: nowIso(), completed_at: nowIso() };
  db.checklist_runs.push(run);
  Object.entries(answers || {}).forEach(([item_id, value]) => {
    db.checklist_answers.push({ id: uid('clans'), restaurant_id: rid, run_id: run.id, item_id, done: !!value.done, comment: value.comment || '', photo_url: value.photo_url || '' });
  });
  persist();
  res.status(201).json(run);
});

app.get('/api/admin/checklists/runs', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const rows = sameRestaurant(db.checklist_runs, rid).map(run => ({
    ...run,
    user: publicUser(db.users.find(u => u.id === run.user_id)),
    template: db.checklist_templates.find(t => t.id === run.template_id),
    answers: db.checklist_answers.filter(a => a.run_id === run.id)
  })).sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json(rows);
});

// PRODUCTS
app.get('/api/products', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const department = req.query.department || (['owner', 'manager'].includes(req.user.role) ? null : req.user.department);
  const rows = sameRestaurant(db.products, rid).filter(p => p.active && (!department || p.department === department));
  res.json(rows);
});

app.post('/api/admin/products', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const { name, unit, department, category } = req.body;
  if (!name || !unit || !department) return res.status(400).json({ error: 'Нужны название, единица и отдел' });
  const product = { id: uid('prod'), restaurant_id: req.user.restaurant_id, name, unit, department, category: category || '', active: true, created_at: nowIso() };
  db.products.push(product);
  persist();
  res.status(201).json(product);
});

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

app.post('/api/requests', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const department = req.body.department || req.user.department;
  if (!['owner', 'manager'].includes(req.user.role) && department !== req.user.department) return res.status(403).json({ error: 'Нельзя создавать заявки другого отдела' });
  const items = Array.isArray(req.body.items) ? req.body.items.filter(i => Number(i.qty_ordered) > 0) : [];
  if (!items.length) return res.status(400).json({ error: 'Добавьте хотя бы одну позицию' });
  const request = { id: uid('req'), restaurant_id: rid, department, created_by: req.user.id, status: 'sent', comment: req.body.comment || '', created_at: nowIso(), updated_at: nowIso() };
  db.product_requests.push(request);
  items.forEach(i => {
    const product = db.products.find(p => p.id === i.product_id && p.restaurant_id === rid);
    if (product) db.request_items.push({ id: uid('reqi'), restaurant_id: rid, request_id: request.id, product_id: product.id, qty_ordered: Number(i.qty_ordered), qty_received: 0, status: 'ordered', comment: i.comment || '' });
  });
  persist();
  res.status(201).json(request);
});

app.patch('/api/requests/:id/receive', auth, ensureRestaurantActive, (req, res) => {
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
  persist();
  res.json({ ...request, items });
});

// INVENTORY
app.get('/api/inventory/templates', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const department = req.query.department || (['owner', 'manager'].includes(req.user.role) ? null : req.user.department);
  const rows = sameRestaurant(db.inventory_templates, rid)
    .filter(t => t.active && (!department || t.department === department))
    .map(t => ({ ...t, items: db.inventory_template_items.filter(i => i.template_id === t.id).map(i => ({ ...i, product: db.products.find(p => p.id === i.product_id) })) }));
  res.json(rows);
});

app.post('/api/inventory/runs', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const { template_id, values, comment } = req.body;
  const template = db.inventory_templates.find(t => t.id === template_id && t.restaurant_id === rid);
  if (!template) return res.status(404).json({ error: 'Бланк инвентаризации не найден' });
  if (!['owner', 'manager'].includes(req.user.role) && template.department !== req.user.department) return res.status(403).json({ error: 'Нет доступа к этой инвентаризации' });
  const run = { id: uid('invrun'), restaurant_id: rid, template_id, user_id: req.user.id, department: template.department, comment: comment || '', status: 'completed', created_at: nowIso() };
  db.inventory_runs.push(run);
  Object.entries(values || {}).forEach(([product_id, value]) => db.inventory_values.push({ id: uid('invv'), restaurant_id: rid, inventory_run_id: run.id, product_id, qty: Number(value.qty || 0), comment: value.comment || '' }));
  persist();
  res.status(201).json(run);
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

app.get('/api/admin/inventory/runs/:id/export.xlsx', auth, ensureRestaurantActive, adminOnly, async (req, res) => {
  const rid = req.user.restaurant_id;
  const run = db.inventory_runs.find(r => r.id === req.params.id && r.restaurant_id === rid);
  if (!run) return res.status(404).json({ error: 'Инвентаризация не найдена' });
  const template = db.inventory_templates.find(t => t.id === run.template_id);
  const user = db.users.find(u => u.id === run.user_id);
  const values = db.inventory_values.filter(v => v.inventory_run_id === run.id).map(v => ({ ...v, product: db.products.find(p => p.id === v.product_id) }));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Инвентаризация');
  sheet.addRow(['Ресторан', req.restaurant.name]);
  sheet.addRow(['Бланк', template?.title || '']);
  sheet.addRow(['Отдел', run.department]);
  sheet.addRow(['Сотрудник', user?.name || '']);
  sheet.addRow(['Дата', new Date(run.created_at).toLocaleString('ru-RU')]);
  sheet.addRow([]);
  sheet.addRow(['Товар', 'Категория', 'Ед.', 'Остаток', 'Комментарий']);
  values.forEach(v => sheet.addRow([v.product?.name || '', v.product?.category || '', v.product?.unit || '', v.qty, v.comment || '']));
  sheet.columns.forEach(c => { c.width = 24; });
  sheet.getRow(7).font = { bold: true };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=inventory-${run.id}.xlsx`);
  await workbook.xlsx.write(res);
  res.end();
});

// TASKS
app.get('/api/tasks', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  let rows;
  if (['owner', 'manager'].includes(req.user.role)) {
    rows = sameRestaurant(db.tasks, rid).map(task => ({
      ...task,
      assignments: db.task_assignments.filter(a => a.task_id === task.id).map(a => ({ ...a, user: publicUser(db.users.find(u => u.id === a.user_id)) }))
    }));
  } else {
    const assignments = db.task_assignments.filter(a => a.restaurant_id === rid && a.user_id === req.user.id);
    rows = assignments.map(a => ({ ...db.tasks.find(t => t.id === a.task_id), assignment: a })).filter(Boolean);
  }
  res.json(rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')));
});

app.post('/api/tasks', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const { title, description, target_type, target_role, target_user_id, due_at } = req.body;
  if (!title || !target_type) return res.status(400).json({ error: 'Нужны title и target_type' });
  const task = { id: uid('task'), restaurant_id: req.user.restaurant_id, title, description: description || '', target_type, target_role: target_role || null, target_user_id: target_user_id || null, due_at: due_at || null, created_by: req.user.id, created_at: nowIso(), active: true };
  db.tasks.push(task);
  makeAssignmentsForTask(task);
  persist();
  res.status(201).json(task);
});

app.patch('/api/tasks/:id/done', auth, ensureRestaurantActive, (req, res) => {
  const assignment = db.task_assignments.find(a => a.task_id === req.params.id && a.user_id === req.user.id && a.restaurant_id === req.user.restaurant_id);
  if (!assignment) return res.status(404).json({ error: 'Задача не найдена' });
  assignment.done = true;
  assignment.comment = req.body.comment || '';
  assignment.completed_at = nowIso();
  persist();
  res.json(assignment);
});

// KNOWLEDGE BASE
app.get('/api/knowledge', auth, ensureRestaurantActive, (req, res) => {
  const rid = req.user.restaurant_id;
  const docs = sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active && hasRoleAccess(req.user, d.allowed_roles));
  const cats = sameRestaurant(db.knowledge_categories, rid).filter(c => hasRoleAccess(req.user, c.allowed_roles));
  res.json(cats.map(c => ({ ...c, documents: docs.filter(d => d.category_id === c.id).map(d => ({ ...d, acknowledged: db.knowledge_acknowledgements.some(a => a.document_id === d.id && a.user_id === req.user.id && a.version === d.version) })) })));
});

app.post('/api/admin/knowledge/categories', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const { title, allowed_roles } = req.body;
  if (!title) return res.status(400).json({ error: 'Название обязательно' });
  const cat = { id: uid('kcat'), restaurant_id: req.user.restaurant_id, title, allowed_roles: allowed_roles || [], sort_order: sameRestaurant(db.knowledge_categories, req.user.restaurant_id).length + 1 };
  db.knowledge_categories.push(cat);
  persist();
  res.status(201).json(cat);
});

app.post('/api/admin/knowledge/documents', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const { category_id, title, content, allowed_roles, requires_acknowledgement, type, file_url } = req.body;
  if (!category_id || !title) return res.status(400).json({ error: 'Нужны category_id и title' });
  const doc = { id: uid('kdoc'), restaurant_id: req.user.restaurant_id, category_id, title, type: type || 'text', content: content || '', file_url: file_url || '', allowed_roles: allowed_roles || [], requires_acknowledgement: !!requires_acknowledgement, version: 1, is_active: true, created_by: req.user.id, created_at: nowIso(), updated_at: nowIso() };
  db.knowledge_documents.push(doc);
  persist();
  res.status(201).json(doc);
});

app.post('/api/knowledge/:id/view', auth, ensureRestaurantActive, (req, res) => {
  const doc = db.knowledge_documents.find(d => d.id === req.params.id && d.restaurant_id === req.user.restaurant_id);
  if (!doc || !hasRoleAccess(req.user, doc.allowed_roles)) return res.status(404).json({ error: 'Документ не найден' });
  db.knowledge_views.push({ id: uid('kview'), restaurant_id: req.user.restaurant_id, document_id: doc.id, user_id: req.user.id, viewed_at: nowIso() });
  persist();
  res.json({ ok: true });
});

app.post('/api/knowledge/:id/ack', auth, ensureRestaurantActive, (req, res) => {
  const doc = db.knowledge_documents.find(d => d.id === req.params.id && d.restaurant_id === req.user.restaurant_id);
  if (!doc || !hasRoleAccess(req.user, doc.allowed_roles)) return res.status(404).json({ error: 'Документ не найден' });
  const exists = db.knowledge_acknowledgements.find(a => a.document_id === doc.id && a.user_id === req.user.id && a.version === doc.version);
  if (!exists) db.knowledge_acknowledgements.push({ id: uid('kack'), restaurant_id: req.user.restaurant_id, document_id: doc.id, user_id: req.user.id, version: doc.version, acknowledged_at: nowIso() });
  persist();
  res.json({ ok: true });
});

app.get('/api/admin/knowledge/stats', auth, ensureRestaurantActive, adminOnly, (req, res) => {
  const rid = req.user.restaurant_id;
  const docs = sameRestaurant(db.knowledge_documents, rid).filter(d => d.is_active);
  res.json(docs.map(d => ({
    ...d,
    views: db.knowledge_views.filter(v => v.document_id === d.id).length,
    acknowledgements: db.knowledge_acknowledgements.filter(a => a.document_id === d.id && a.version === d.version).length
  })));
});

app.use(express.static(webDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(webDist, 'index.html'), err => {
    if (err) res.status(200).send('Resto Control API is running. Build webapp to serve UI.');
  });
});

app.listen(PORT, () => {
  console.log(`✅ Resto Control MVP started on port ${PORT}`);
  console.log(`Trial days: ${process.env.TRIAL_DAYS || 14}`);
  console.log(`Super admin: ${process.env.SUPER_ADMIN_LOGIN || 'admin'}`);
});
