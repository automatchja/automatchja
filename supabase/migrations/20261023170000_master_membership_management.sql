create or replace function public.master_list_seller_members(target_seller_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_master_admin() then
    raise exception using errcode = '42501', message = 'Master access required';
  end if;

  return query
    select memberships.user_id, users.email::text, memberships.role, memberships.is_active
    from public.seller_memberships as memberships
    join auth.users as users on users.id = memberships.user_id
    where memberships.seller_id = target_seller_id
    order by lower(users.email::text);
end;
$$;

create or replace function public.master_set_seller_membership(
  member_email text,
  target_seller_id uuid,
  membership_role text,
  membership_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  if not public.is_master_admin() then
    raise exception using errcode = '42501', message = 'Master access required';
  end if;

  if membership_role not in ('seller_admin', 'seller_staff') then
    raise exception using errcode = '22023', message = 'Invalid seller membership role';
  end if;

  if not exists (
    select 1 from public.sellers where id = target_seller_id
  ) then
    raise exception using errcode = '22023', message = 'Seller workspace not found';
  end if;

  select users.id into target_user_id
  from auth.users as users
  where lower(users.email) = lower(trim(member_email))
  limit 1;

  if target_user_id is null then
    raise exception using errcode = 'P0002', message = 'No AutoMatch account found for that email. Invite the user first.';
  end if;

  if membership_active then
    insert into public.seller_memberships (seller_id, user_id, role, is_active)
    values (target_seller_id, target_user_id, membership_role, true)
    on conflict (seller_id, user_id) do update
      set role = excluded.role,
          is_active = true;
  else
    update public.seller_memberships
    set is_active = false
    where seller_id = target_seller_id
      and user_id = target_user_id;
  end if;
end;
$$;

revoke all on function public.master_list_seller_members(uuid) from public, anon;
revoke all on function public.master_set_seller_membership(text, uuid, text, boolean) from public, anon;
grant execute on function public.master_list_seller_members(uuid) to authenticated;
grant execute on function public.master_set_seller_membership(text, uuid, text, boolean) to authenticated;
