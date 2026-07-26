-- Auto-create a public.admins profile row whenever a Supabase Auth user is
-- created. Keeps "create admin via Dashboard" and "create admin via API"
-- consistent — both just need to create an auth.users row and this fills in
-- the rest with defaults.
create or replace function handle_new_admin_user()
returns trigger as $$
begin
  insert into public.admins (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_admin_user();
