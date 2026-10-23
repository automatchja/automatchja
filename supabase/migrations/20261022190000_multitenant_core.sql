create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'seller_user'
    check (role in ('master', 'seller_user')),
  created_at timestamptz not null default now()
);

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active'
    check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);

create table public.seller_memberships (
  seller_id uuid not null references public.sellers (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  role text not null default 'seller_admin'
    check (role in ('seller_admin', 'seller_staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (seller_id, user_id)
);

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  year integer not null check (year between 1886 and 2100),
  make text not null check (length(trim(make)) > 0),
  model text not null check (length(trim(model)) > 0),
  trim text not null default '',
  price_jmd numeric(14, 2) not null check (price_jmd >= 0),
  mileage_km integer not null default 0 check (mileage_km >= 0),
  body_type text not null default '',
  colour text not null default '',
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'sold', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete restrict,
  inventory_id uuid references public.inventory (id) on delete set null,
  customer_name text not null,
  email text,
  phone text not null,
  preferred_contact text not null default '',
  message text not null default '',
  status text not null default 'new'
    check (status in ('new', 'contacted', 'closed')),
  created_at timestamptz not null default now(),
  constraint leads_customer_name_not_blank check (length(trim(customer_name)) > 0),
  constraint leads_phone_not_blank check (length(trim(phone)) > 0)
);

create index inventory_seller_status_idx
  on public.inventory (seller_id, status);
create index leads_seller_created_idx
  on public.leads (seller_id, created_at desc);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

create or replace function public.is_master_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles
    where id = (select auth.uid())
      and role = 'master'
  );
$$;

create or replace function public.has_seller_access(target_seller_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_master_admin()
    or exists (
      select 1
      from public.seller_memberships
      where seller_id = target_seller_id
        and user_id = (select auth.uid())
        and is_active
    );
$$;

alter table public.user_profiles enable row level security;
alter table public.sellers enable row level security;
alter table public.seller_memberships enable row level security;
alter table public.inventory enable row level security;
alter table public.leads enable row level security;

create policy "Users can read their own profile or master can read all"
  on public.user_profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_master_admin()));

create policy "Active sellers are publicly visible"
  on public.sellers for select to anon, authenticated
  using (status = 'active');
create policy "Members and master can read their sellers"
  on public.sellers for select to authenticated
  using ((select public.has_seller_access(id)));
create policy "Master can create sellers"
  on public.sellers for insert to authenticated
  with check ((select public.is_master_admin()));
create policy "Master can update sellers"
  on public.sellers for update to authenticated
  using ((select public.is_master_admin()))
  with check ((select public.is_master_admin()));
create policy "Master can delete sellers"
  on public.sellers for delete to authenticated
  using ((select public.is_master_admin()));

create policy "Users can read their memberships or master can read all"
  on public.seller_memberships for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_master_admin()));
create policy "Master can create seller memberships"
  on public.seller_memberships for insert to authenticated
  with check ((select public.is_master_admin()));
create policy "Master can update seller memberships"
  on public.seller_memberships for update to authenticated
  using ((select public.is_master_admin()))
  with check ((select public.is_master_admin()));
create policy "Master can delete seller memberships"
  on public.seller_memberships for delete to authenticated
  using ((select public.is_master_admin()));

create policy "Public can read published inventory from active sellers"
  on public.inventory for select to anon, authenticated
  using (
    status = 'published'
    and exists (
      select 1 from public.sellers
      where sellers.id = inventory.seller_id
        and sellers.status = 'active'
    )
  );
create policy "Seller members and master can read inventory"
  on public.inventory for select to authenticated
  using ((select public.has_seller_access(seller_id)));
create policy "Seller members and master can create inventory"
  on public.inventory for insert to authenticated
  with check ((select public.has_seller_access(seller_id)));
create policy "Seller members and master can update inventory"
  on public.inventory for update to authenticated
  using ((select public.has_seller_access(seller_id)))
  with check ((select public.has_seller_access(seller_id)));
create policy "Seller members and master can delete inventory"
  on public.inventory for delete to authenticated
  using ((select public.has_seller_access(seller_id)));

create policy "Seller members and master can read leads"
  on public.leads for select to authenticated
  using ((select public.has_seller_access(seller_id)));
create policy "Seller members and master can update leads"
  on public.leads for update to authenticated
  using ((select public.has_seller_access(seller_id)))
  with check ((select public.has_seller_access(seller_id)));

grant select on public.user_profiles to authenticated;
grant select, insert, update, delete on public.sellers to authenticated;
grant select, insert, update, delete on public.seller_memberships to authenticated;
grant select, insert, update, delete on public.inventory to authenticated;
grant select, update on public.leads to authenticated;
grant select on public.sellers, public.inventory to anon;
grant all on public.leads to service_role;

insert into public.sellers (name, slug)
values ('ATL Approved', 'atl-approved')
on conflict (slug) do nothing;
