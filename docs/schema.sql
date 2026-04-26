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
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists product_requests (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  department text not null,
  created_by text not null references users(id),
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

create table if not exists tasks (
  id text primary key,
  restaurant_id text not null references restaurants(id) on delete cascade,
  title text not null,
  description text,
  target_type text not null,
  target_role text,
  target_user_id text references users(id),
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
create index if not exists idx_tasks_restaurant on tasks(restaurant_id);
create index if not exists idx_tech_requests_restaurant on tech_requests(restaurant_id);
create index if not exists idx_knowledge_restaurant on knowledge_documents(restaurant_id);
