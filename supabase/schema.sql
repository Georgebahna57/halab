-- شغّل هالسكربت من Supabase → SQL Editor

create table if not exists transactions (
  id uuid primary key,
  fund_id text not null,
  ledger text not null default 'fund',
  date date not null,
  currency text not null,
  kind text not null,
  amount numeric not null,
  party text not null,
  counterparty text,
  intermediary text,
  note text,
  status text not null default 'posted',
  batch_id uuid,
  link_id uuid,
  created_by_id uuid,
  created_by_email text,
  created_by_name text,
  last_edited_at timestamptz,
  last_edited_by_name text,
  last_edited_by_email text,
  edit_history jsonb,
  exchange_to_currency text,
  exchange_rate numeric,
  exchange_to_amount numeric,
  created_at timestamptz not null default now()
);

create table if not exists bills (
  id uuid primary key,
  fund_id text not null,
  invoice_no text,
  description text not null,
  amount numeric,
  currency text,
  paid_at date,
  created_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key,
  fund_id text not null,
  name text not null,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

alter table transactions enable row level security;
alter table bills enable row level security;
alter table customers enable row level security;

drop policy if exists "authenticated full access transactions" on transactions;
drop policy if exists "authenticated full access bills" on bills;
drop policy if exists "authenticated full access customers" on customers;

create policy "authenticated full access transactions"
  on transactions for all to authenticated using (true) with check (true);

create policy "authenticated full access bills"
  on bills for all to authenticated using (true) with check (true);

create policy "authenticated full access customers"
  on customers for all to authenticated using (true) with check (true);
