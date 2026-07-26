-- Smart Split Bill — initial Postgres schema for Supabase
-- Run via Supabase Dashboard SQL Editor, or `supabase db push` if using the Supabase CLI.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at helper trigger
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- admins
-- Auth is handled by Supabase Auth (auth.users). This table only holds the
-- admin-specific profile/settings; id is a 1:1 reference to auth.users(id).
-- ---------------------------------------------------------------------------
create table admins (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  active boolean not null default true,
  last_login timestamptz,
  currency text not null default 'IDR',
  locale text not null default 'id-ID',
  timezone text not null default 'Asia/Jakarta',
  require_proof boolean not null default true,
  rounding_policy text not null default 'rupiah_default' check (rounding_policy in ('rupiah_default', 'none')),
  introduction_template text not null default 'Thank you. Your name has been registered in Smart Split Bill. Any split bill involving {{participant_name}} will be integrated into Smart Split Bill. Here is your personal link: {{payment_link}}',
  reminder_template text not null default 'Hello, {{participant_name}}
This is a reminder regarding your outstanding balance for {{category_name}}.

Remaining balance: {{remaining_amount}}

Please open your Personal Payment Link to review the details and complete payment:
{{payment_link}}

Thank you, {{admin_name}}.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger admins_set_updated_at before update on admins
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  start_date date,
  end_date date,
  image_url text,
  status text not null default 'Draft' check (status in ('Draft', 'Ongoing', 'Completed', 'Archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_set_updated_at before update on categories
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- participants
-- ---------------------------------------------------------------------------
create table participants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  normalized_phone text not null,
  email text,
  nickname text,
  notes text,
  introduction_state text not null default 'NeverOpened' check (introduction_state in ('NeverOpened', 'Opened', 'ManuallyMarkedSent')),
  created_source text not null default 'manual' check (created_source in ('manual', 'transaction')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index participants_normalized_phone_idx on participants(normalized_phone);
create trigger participants_set_updated_at before update on participants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- category_participants
-- personal_token is intentionally non-expiring (per product decision) — it is
-- the sole credential for the public PayPortal link, revoked only via
-- token_state.
-- ---------------------------------------------------------------------------
create table category_participants (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  personal_token text not null unique,
  token_state text not null default 'Active' check (token_state in ('Active', 'Revoked', 'Expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, participant_id)
);
create index category_participants_token_idx on category_participants(personal_token);
create trigger category_participants_set_updated_at before update on category_participants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------------
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('bank', 'wallet', 'cash', 'custom', 'qris')),
  name text not null,
  account_holder text not null default '',
  account_number text not null default '',
  image_url text,
  instructions text,
  notes text,
  enabled boolean not null default true,
  preferred boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger payment_methods_set_updated_at before update on payment_methods
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions
-- payer_id holds either the literal 'administrator' or a participants.id —
-- kept as free text (no FK) to match that dual meaning.
-- ---------------------------------------------------------------------------
create table transactions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  title text not null,
  merchant text not null default '',
  date date not null default current_date,
  payer_id text not null,
  input_method text not null default 'manual' check (input_method in ('manual', 'ocr')),
  receipt_url text,
  subtotal integer not null default 0,
  tax integer not null default 0,
  service_charge integer not null default 0,
  discount integer not null default 0,
  other_fees integer not null default 0,
  total integer not null default 0,
  status text not null default 'Draft' check (status in ('Draft', 'Confirmed')),
  expense_classification text not null default 'Other' check (expense_classification in ('Food', 'Transportation', 'Accommodation', 'Entertainment', 'Shopping', 'Leisure', 'Other')),
  description text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index transactions_category_id_idx on transactions(category_id);
create trigger transactions_set_updated_at before update on transactions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- transaction_items
-- ---------------------------------------------------------------------------
create table transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  name text not null,
  quantity numeric not null default 1,
  unit_price integer not null default 0,
  line_total integer not null default 0,
  classification text not null default 'Other' check (classification in ('Food', 'Transportation', 'Accommodation', 'Entertainment', 'Shopping', 'Other')),
  sort_order integer not null default 0
);
create index transaction_items_transaction_id_idx on transaction_items(transaction_id);

-- ---------------------------------------------------------------------------
-- allocations
-- ---------------------------------------------------------------------------
create table allocations (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  item_id uuid references transaction_items(id) on delete cascade,
  charge_type text check (charge_type in ('tax', 'serviceCharge', 'discount', 'otherFees')),
  participant_id uuid not null references participants(id) on delete cascade,
  method text not null check (method in ('Equal', 'Ratio', 'Percentage', 'Custom', 'Quantity', 'Hybrid')),
  inputs numeric,
  raw_amount numeric not null default 0,
  rounded_amount integer not null default 0
);
create index allocations_transaction_id_idx on allocations(transaction_id);
create index allocations_participant_id_idx on allocations(participant_id);

-- ---------------------------------------------------------------------------
-- payment_submissions
-- ---------------------------------------------------------------------------
create table payment_submissions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references categories(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  method_snapshot jsonb not null default '{}'::jsonb,
  selected_obligations uuid[] not null default '{}',
  submitted_amount integer not null default 0,
  proof_url text,
  status text not null default 'Pending Verification' check (status in ('Pending Verification', 'Paid', 'Partially Paid', 'Failed', 'Rejected')),
  notes text,
  rejection_reason text,
  reference_number text,
  submission_date timestamptz not null default now(),
  verification_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_submissions_category_id_idx on payment_submissions(category_id);
create index payment_submissions_participant_id_idx on payment_submissions(participant_id);
create trigger payment_submissions_set_updated_at before update on payment_submissions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- payment_allocations
-- ---------------------------------------------------------------------------
create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_submission_id uuid not null references payment_submissions(id) on delete cascade,
  transaction_id uuid not null references transactions(id) on delete cascade,
  amount integer not null default 0
);
create index payment_allocations_submission_id_idx on payment_allocations(payment_submission_id);

-- ---------------------------------------------------------------------------
-- activities
-- entity_id is polymorphic (points at different tables depending on
-- entity_type), so it is left as a plain uuid with no FK.
-- ---------------------------------------------------------------------------
create table activities (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  entity_type text not null check (entity_type in ('category', 'transaction', 'participant', 'payment', 'token', 'method', 'admin', 'database')),
  entity_id text not null,
  action text not null,
  actor_type text not null check (actor_type in ('admin', 'participant')),
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index activities_entity_idx on activities(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- message_actions
-- ---------------------------------------------------------------------------
create table message_actions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  type text not null check (type in ('introduction', 'reminder')),
  generated_message text not null,
  link text not null,
  opened_at timestamptz,
  manually_marked_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index message_actions_participant_id_idx on message_actions(participant_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- The app never queries Supabase directly from the browser — all reads and
-- writes go through backend API routes using the service_role/secret key,
-- which bypasses RLS entirely. Participants authenticate to those routes via
-- their category_participants.personal_token, not a Supabase session, so
-- there is no participant-facing RLS policy to write.
--
-- These policies exist purely as defense-in-depth: if the anon/publishable
-- key is ever used directly (accidentally or by a future client-side
-- feature), it should see nothing unless the caller is a signed-in admin.
-- ---------------------------------------------------------------------------
create or replace function is_admin()
returns boolean as $$
  select exists (select 1 from admins where id = auth.uid());
$$ language sql stable security definer set search_path = public;

do $$
declare
  t text;
begin
  foreach t in array array[
    'admins', 'categories', 'participants', 'category_participants',
    'payment_methods', 'transactions', 'transaction_items', 'allocations',
    'payment_submissions', 'payment_allocations', 'activities', 'message_actions'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy admin_full_access on %I for all using (is_admin()) with check (is_admin())',
      t
    );
  end loop;
end $$;
