alter table public.inventory
  add column if not exists source_id text,
  add column if not exists usage_tags text[] not null default '{}',
  add column if not exists images text[] not null default '{}',
  add column if not exists image_folder_id text not null default '',
  add column if not exists deal jsonb not null default '{}',
  add column if not exists source_data jsonb not null default '{}';

create unique index if not exists inventory_seller_source_id_key
  on public.inventory (seller_id, source_id);
