-- Rate limiting support for public endpoints (primarily /api/public/find-portal,
-- which previously had zero throttling and could be used to enumerate
-- participants and leak their personal payment tokens).
create table rate_limit_events (
  id bigserial primary key,
  ip text not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_events_lookup_idx on rate_limit_events(ip, action, created_at);

alter table rate_limit_events enable row level security;
-- No policies created: this table is only ever touched via the service-role
-- key from API routes, so it is intentionally inaccessible to anon/authenticated roles.

-- Storage buckets for payment proof images (private) and QRIS codes (public).
insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('qris-codes', 'qris-codes', true)
on conflict (id) do nothing;
