-- PostgreSQL production schema draft for Resto Control.
-- MVP backend in this archive uses JSON storage for quick demo.
-- When moving to production, create these tables and replace repository layer with SQL queries.

create table if not exists restaurants (
  id text primary key,
  name text not null,
  city text,
  owner_name text,
  phone text,
  email text,
  status text not null default 'active',
  plan text not null default 'trial',
  subscription_status text not null default 'trial',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  subscription_started_at timestamptz,
  subscription_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  restaurant_id text references restaurants(id) on delete cascade,
  name text not null,
  login text not null unique,
  password_hash text not null,
  access_password text,
  role text not null,
  department text,
  active boolean not null default true,
  is_super_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists checklist_templates (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  role text not null,
  type text not null,
  title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists checklist_items (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  template_id text not null references checklist_templates(id) on delete cascade,
  text text not null,
  required boolean not null default true,
  needs_comment boolean not null default false,
  needs_photo boolean not null default false,
  sort_order int not null default 0
);

create table if not exists checklist_runs (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  template_id text not null references checklist_templates(id),
  user_id text not null references users(id),
  status text not null,
  comment text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists checklist_answers (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  run_id text not null references checklist_runs(id) on delete cascade,
  item_id text not null references checklist_items(id),
  done boolean not null default false,
  comment text,
  photo_url text
);

create table if not exists products (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  department text not null,
  name text not null,
  unit text not null,
  category text,
  supplier text not null default 'Без поставщика',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists product_requests (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  department text not null,
  created_by text not null references users(id),
  target_role text,
  target_user_id text references users(id),
  status text not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists request_items (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  request_id text not null references product_requests(id) on delete cascade,
  product_id text not null references products(id),
  qty_ordered numeric not null default 0,
  qty_received numeric not null default 0,
  status text not null default 'ordered',
  comment text
);

create table if not exists inventory_templates (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  department text not null,
  title text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists inventory_template_items (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  template_id text not null references inventory_templates(id) on delete cascade,
  product_id text not null references products(id),
  sort_order int not null default 0
);

create table if not exists inventory_runs (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  template_id text not null references inventory_templates(id),
  user_id text not null references users(id),
  department text not null,
  comment text,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists inventory_values (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  inventory_run_id text not null references inventory_runs(id) on delete cascade,
  product_id text not null references products(id),
  qty numeric not null default 0,
  comment text
);

create table if not exists floor_tables (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  label text not null,
  seats int not null default 4,
  zone text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists table_reservations (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  created_by text not null references users(id),
  table_ids jsonb not null default '[]',
  reserved_for timestamptz not null,
  duration_minutes int not null default 120,
  guests_count int not null default 1,
  guest_name text,
  guest_phone text not null,
  comment text,
  status text not null default 'booked',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  title text not null,
  description text,
  target_type text not null,
  target_role text,
  target_user_id text references users(id),
  target_department text,
  due_at timestamptz,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  active boolean not null default true
);

create table if not exists task_assignments (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  user_id text not null references users(id),
  done boolean not null default false,
  comment text,
  completed_at timestamptz
);

create table if not exists tech_requests (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  created_by text not null references users(id),
  title text not null,
  description text,
  category text not null default 'other',
  status text not null default 'new',
  manager_comment text,
  started_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists knowledge_categories (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  title text not null,
  allowed_roles jsonb not null default '[]',
  sort_order int not null default 0
);

create table if not exists knowledge_documents (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  category_id text not null references knowledge_categories(id) on delete cascade,
  title text not null,
  type text not null default 'text',
  content text,
  file_url text,
  photo_url text,
  ingredients jsonb not null default '[]',
  allowed_roles jsonb not null default '[]',
  requires_acknowledgement boolean not null default false,
  version int not null default 1,
  is_active boolean not null default true,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sort_order int not null default 0
);

create table if not exists knowledge_acknowledgements (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  document_id text not null references knowledge_documents(id) on delete cascade,
  user_id text not null references users(id),
  version int not null,
  acknowledged_at timestamptz not null default now()
);

create table if not exists knowledge_views (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  document_id text not null references knowledge_documents(id) on delete cascade,
  user_id text not null references users(id),
  viewed_at timestamptz not null default now()
);

create index if not exists idx_users_restaurant on users(restaurant_id);
create index if not exists idx_requests_restaurant on product_requests(restaurant_id);
create index if not exists idx_inventory_runs_restaurant on inventory_runs(restaurant_id);
create index if not exists idx_floor_tables_restaurant on floor_tables(restaurant_id);
create index if not exists idx_table_reservations_restaurant on table_reservations(restaurant_id);
create index if not exists idx_tasks_restaurant on tasks(restaurant_id);
create index if not exists idx_tech_requests_restaurant on tech_requests(restaurant_id);
create index if not exists idx_knowledge_restaurant on knowledge_documents(restaurant_id);


create table if not exists shifts (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text,
  department text,
  location text,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  comment text
);

create table if not exists notifications (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  title text not null,
  body text,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists activity_events (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  actor_id text references users(id) on delete set null,
  type text not null,
  title text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists comments (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  user_id text references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists support_tickets (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  created_by text references users(id),
  subject text not null,
  status text not null default 'open',
  client_read_at timestamptz,
  platform_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists support_messages (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  ticket_id text not null references support_tickets(id) on delete cascade,
  user_id text references users(id),
  author_type text not null default 'client',
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_restaurant on support_tickets(restaurant_id, status, updated_at);
create index if not exists idx_support_messages_ticket on support_messages(ticket_id, created_at);

create table if not exists integrations (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  provider text not null,
  status text not null default 'draft',
  api_login_encrypted text,
  organization_id text,
  terminal_group_id text,
  sync_interval_seconds int not null default 60,
  sync_bookings boolean not null default true,
  sync_shifts boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists external_mappings (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  provider text not null,
  entity_type text not null,
  local_id text not null,
  external_id text not null,
  label text,
  created_at timestamptz not null default now()
);

create table if not exists integration_events (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  provider text not null,
  event_type text not null,
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create unique index if not exists idx_integrations_restaurant_provider on integrations(restaurant_id, provider);
create unique index if not exists idx_external_mappings_provider_external on external_mappings(restaurant_id, provider, entity_type, external_id);
create index if not exists idx_integration_events_restaurant on integration_events(restaurant_id, provider, event_type, received_at);

create table if not exists platform_settings (
  id text primary key,
  key text unique not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists billing_profiles (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  customer_type text not null default 'ip',
  legal_name text,
  inn text,
  kpp text,
  ogrn text,
  legal_address text,
  bank_name text,
  bik text,
  checking_account text,
  correspondent_account text,
  edo_operator text,
  edo_id text,
  email text,
  phone text,
  updated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists billing_invoices (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  number text not null,
  status text not null default 'issued',
  plan text not null,
  plan_title text not null,
  months int not null default 1,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount numeric not null default 0,
  currency text not null default 'RUB',
  customer_requisites jsonb not null default '{}',
  seller_requisites jsonb not null default '{}',
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  invoice_id text not null references billing_invoices(id) on delete cascade,
  amount numeric not null default 0,
  currency text not null default 'RUB',
  method text not null default 'bank_transfer',
  reference text,
  comment text,
  paid_at timestamptz not null default now(),
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table if not exists closing_documents (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  invoice_id text not null references billing_invoices(id) on delete cascade,
  type text not null default 'act',
  number text not null,
  status text not null default 'issued',
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount numeric not null default 0,
  currency text not null default 'RUB',
  issued_at timestamptz not null default now(),
  signed_at timestamptz,
  created_at timestamptz not null default now()
);
