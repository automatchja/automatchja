import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.AUTOMATCH_SUPABASE_CONFIG;
const notice = document.getElementById('notice');
const loginView = document.getElementById('loginView');
const passwordResetView = document.getElementById('passwordResetView');
const passwordSetupView = document.getElementById('passwordSetupView');
const dashboardView = document.getElementById('dashboardView');
const signOutButton = document.getElementById('signOut');
const statusOptions = ['draft', 'published', 'sold', 'archived'];
const LEGACY_INVENTORY_API_URL = 'https://script.google.com/macros/s/AKfycbz2UAL-otaXKaDTHIzemtoto-5ZLsxZP4y-f0i40wB5WabQImIE_E1UdaXn-RhS1yjrjA/exec';
const authCallback = new URLSearchParams(window.location.hash.slice(1));
const authFlow = authCallback.get('type');
const needsPasswordSetup = authFlow === 'invite' || authFlow === 'recovery';
const authCallbackError = authCallback.get('error_code') || authCallback.get('error');
let supabase;
let sellers = [];
let activeSellerId = '';
let vehicleById = new Map();
let isSettingPassword = false;
let isMasterUser = false;

function showNotice(message, kind = 'error') {
  notice.textContent = message;
  notice.className = `notice ${kind === 'success' ? 'success' : ''}`;
}

function clearNotice() {
  notice.textContent = '';
  notice.className = 'notice hidden';
}

function showLogin() {
  loginView.classList.remove('hidden');
  passwordResetView.classList.add('hidden');
  passwordSetupView.classList.add('hidden');
  dashboardView.classList.add('hidden');
  signOutButton.classList.add('hidden');
}

function showPasswordReset(message) {
  showLogin();
  loginView.classList.add('hidden');
  passwordResetView.classList.remove('hidden');
  if (message) showNotice(message);
  document.getElementById('resetEmail').focus();
}

function showPasswordSetup() {
  loginView.classList.add('hidden');
  passwordResetView.classList.add('hidden');
  dashboardView.classList.add('hidden');
  passwordSetupView.classList.remove('hidden');
  signOutButton.classList.add('hidden');
  document.getElementById('newPassword').focus();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat('en-JM', {
    style: 'currency',
    currency: 'JMD',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function date(value) {
  return new Intl.DateTimeFormat('en-JM', { dateStyle: 'medium' })
    .format(new Date(value));
}

function setBusy(button, busy, busyLabel) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function loadWorkspace(user) {
  clearNotice();
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError) throw new Error(`Could not load account access: ${profileError.message}`);
  isMasterUser = profile.role === 'master';

  const { data: sellerRows, error: sellerError } = await supabase
    .from('sellers')
    .select('id,name,slug,status')
    .order('name');

  if (sellerError) throw new Error(`Could not load seller workspaces: ${sellerError.message}`);
  sellers = sellerRows || [];

  if (profile.role !== 'master') {
    const { data: memberships, error: membershipError } = await supabase
      .from('seller_memberships')
      .select('seller_id')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (membershipError) throw new Error(`Could not load seller access: ${membershipError.message}`);
    const permittedSellerIds = new Set((memberships || []).map(row => row.seller_id));
    sellers = sellers.filter(seller => permittedSellerIds.has(seller.id));
  }

  if (!sellers.length) {
    loginView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
    signOutButton.classList.remove('hidden');
    document.getElementById('welcomeTitle').textContent = 'Access not set up yet';
    document.getElementById('accessLabel').textContent =
      'Ask the AutoMatch master administrator to assign your seller workspace.';
    document.getElementById('sellerPicker').innerHTML = '';
    document.getElementById('sellerPicker').disabled = true;
    document.querySelector('.stats').classList.add('hidden');
    document.querySelectorAll('.content-card').forEach(section => section.classList.add('hidden'));
    return;
  }

  document.querySelector('.stats').classList.remove('hidden');
  document.querySelectorAll('.content-card').forEach(section => section.classList.remove('hidden'));
  document.getElementById('workspaceAccess').classList.toggle('hidden', !isMasterUser);
  const picker = document.getElementById('sellerPicker');
  picker.disabled = false;
  picker.innerHTML = sellers.map(seller =>
    `<option value="${escapeHtml(seller.id)}">${escapeHtml(seller.name)}</option>`
  ).join('');

  const preferredSeller = sellers.find(seller => seller.slug === 'atl-approved');
  activeSellerId = sellers.some(seller => seller.id === activeSellerId)
    ? activeSellerId
    : (preferredSeller || sellers[0]).id;
  picker.value = activeSellerId;
  updateInventoryImportVisibility();

  document.getElementById('welcomeTitle').textContent =
    `Welcome, ${user.email || 'seller'}`;
  document.getElementById('accessLabel').textContent = profile.role === 'master'
    ? 'Master access · You can switch between all seller workspaces.'
    : 'Seller access · This workspace is limited to your assigned business.';

  await loadSellerData();
  if (isMasterUser) await loadSellerMembers();
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  signOutButton.classList.remove('hidden');
}

async function loadSellerData() {
  clearNotice();
  const [inventoryResult, leadsResult] = await Promise.all([
    supabase.from('inventory')
      .select('id,year,make,model,price_jmd,status,created_at')
      .eq('seller_id', activeSellerId)
      .order('created_at', { ascending: false }),
    supabase.from('leads')
      .select('id,customer_name,email,phone,inventory_id,status,created_at')
      .eq('seller_id', activeSellerId)
      .order('created_at', { ascending: false })
  ]);

  if (inventoryResult.error) {
    throw new Error(`Could not load inventory: ${inventoryResult.error.message}`);
  }
  if (leadsResult.error) {
    throw new Error(`Could not load requests: ${leadsResult.error.message}`);
  }

  const inventory = inventoryResult.data || [];
  const leads = leadsResult.data || [];
  vehicleById = new Map(inventory.map(vehicle => [vehicle.id, vehicle]));
  document.getElementById('vehicleCount').textContent = String(inventory.length);
  document.getElementById('publishedCount').textContent =
    String(inventory.filter(vehicle => vehicle.status === 'published').length);
  document.getElementById('leadCount').textContent = String(leads.length);
  renderInventory(inventory);
  renderLeads(leads);
}

function updateInventoryImportVisibility() {
  const atlSeller = sellers.find(seller => seller.id === activeSellerId);
  document.getElementById('importExistingInventory')
    .classList.toggle('hidden', !isMasterUser || atlSeller?.slug !== 'atl-approved');
}

function legacyBootstrap() {
  return new Promise((resolve, reject) => {
    const callback = `__automatchImport_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      delete window[callback];
      script.remove();
      reject(new Error('The existing inventory feed took too long to respond.'));
    }, 30000);
    const cleanup = () => {
      clearTimeout(timer);
      delete window[callback];
      script.remove();
    };

    window[callback] = data => {
      cleanup();
      if (!data || data.ok === false) {
        reject(new Error(data?.error || 'The existing inventory feed returned an invalid response.'));
        return;
      }
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Could not connect to the existing inventory feed.'));
    };
    const query = new URLSearchParams({ action: 'bootstrap', callback });
    script.src = `${LEGACY_INVENTORY_API_URL}?${query.toString()}`;
    document.head.append(script);
  });
}

function mapLegacyVehicle(vehicle) {
  if (!vehicle.id || !vehicle.make || !vehicle.model ||
      !Number.isInteger(Number(vehicle.year)) ||
      !Number.isFinite(Number(vehicle.price)) ||
      !Number.isFinite(Number(vehicle.mileage))) {
    throw new Error(`Vehicle ${vehicle.id || '(missing ID)'} has incomplete listing data; nothing was imported.`);
  }

  return {
    seller_id: activeSellerId,
    source_id: String(vehicle.id),
    year: Number(vehicle.year),
    make: String(vehicle.make).trim(),
    model: String(vehicle.model).trim(),
    price_jmd: Number(vehicle.price),
    mileage_km: Number(vehicle.mileage),
    body_type: String(vehicle.bodyType || ''),
    colour: String(vehicle.colour || ''),
    status: 'published',
    usage_tags: Array.isArray(vehicle.usageTags) ? vehicle.usageTags.map(String) : [],
    images: Array.isArray(vehicle.images) ? vehicle.images.map(String) : [],
    image_folder_id: String(vehicle.imageFolderId || ''),
    deal: vehicle.deal && typeof vehicle.deal === 'object' ? vehicle.deal : {},
    source_data: vehicle
  };
}

async function importExistingInventory(button) {
  if (!isMasterUser || !sellers.some(seller =>
    seller.id === activeSellerId && seller.slug === 'atl-approved'
  )) {
    showNotice('Only a master can import stock into the ATL Approved workspace.');
    return;
  }
  if (!window.confirm('Import all currently available ATL Approved vehicles into Supabase as published listings? Existing imported rows will be left unchanged.')) {
    return;
  }

  setBusy(button, true, 'Loading existing stock...');
  clearNotice();
  try {
    const bootstrap = await legacyBootstrap();
    const availableVehicles = (Array.isArray(bootstrap.vehicles) ? bootstrap.vehicles : [])
      .filter(vehicle => String(vehicle.status || '').trim().toLowerCase() === 'available');
    if (!availableVehicles.length) {
      throw new Error('The existing feed returned no available vehicles, so nothing was imported.');
    }
    const rows = availableVehicles.map(mapLegacyVehicle);
    const ids = rows.map(row => row.source_id);
    if (new Set(ids).size !== ids.length) {
      throw new Error('The existing feed contains duplicate vehicle IDs; nothing was imported.');
    }

    const { data: existingSources, error: existingError } = await supabase
      .from('inventory')
      .select('source_id')
      .eq('seller_id', activeSellerId)
      .not('source_id', 'is', null);
    if (existingError) throw new Error(`Could not check for previously imported stock: ${existingError.message}`);

    const existingIds = new Set((existingSources || []).map(row => row.source_id));
    const newRows = rows.filter(row => !existingIds.has(row.source_id));
    if (newRows.length) {
      const { error } = await supabase.from('inventory').upsert(newRows, {
        onConflict: 'seller_id,source_id',
        ignoreDuplicates: true
      });
      if (error) throw new Error(`Could not import existing stock: ${error.message}`);
    }

    await loadSellerData();
    showNotice(
      newRows.length
        ? `Imported ${newRows.length} ATL Approved vehicles. ${rows.length - newRows.length} previously imported vehicles were left unchanged.`
        : `All ${rows.length} available ATL Approved vehicles were already imported; no changes were made.`,
      'success'
    );
  } catch (error) {
    showNotice(`Inventory import failed: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
}

async function loadSellerMembers() {
  const { data, error } = await supabase.rpc('master_list_seller_members', {
    target_seller_id: activeSellerId
  });
  if (error) throw new Error(`Could not load workspace members: ${error.message}`);

  const members = data || [];
  const rows = document.getElementById('membershipRows');
  document.getElementById('membersEmpty').classList.toggle('hidden', members.length > 0);
  rows.innerHTML = members.map(member => `
    <tr>
      <td>${escapeHtml(member.email)}</td>
      <td>${member.role === 'seller_admin' ? 'Seller admin' : 'Seller staff'}</td>
      <td>${member.is_active ? 'Active' : 'Revoked'}</td>
      <td>${member.is_active
        ? `<button class="remove-membership" type="button" data-member-id="${escapeHtml(member.user_id)}" data-member-email="${escapeHtml(member.email)}">Revoke</button>`
        : ''}</td>
    </tr>
  `).join('');

  rows.querySelectorAll('[data-member-id]').forEach(button => {
    button.addEventListener('click', () => changeMembership(button, false));
  });
}

async function changeMembership(button, isActive) {
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('master_set_seller_membership', {
      member_email: button.dataset.memberEmail || '',
      target_seller_id: activeSellerId,
      membership_role: 'seller_staff',
      membership_active: isActive
    });
    if (error) throw new Error(error.message);
    await loadSellerMembers();
    showNotice(isActive ? 'Workspace access approved.' : 'Workspace access revoked.', 'success');
  } catch (error) {
    showNotice(`Could not update workspace access: ${error.message}`);
  } finally {
    button.disabled = false;
  }
}

function renderInventory(inventory) {
  const rows = document.getElementById('inventoryRows');
  const empty = document.getElementById('inventoryEmpty');
  empty.classList.toggle('hidden', inventory.length > 0);
  rows.innerHTML = inventory.map(vehicle => `
    <tr>
      <td><strong>${escapeHtml(`${vehicle.year} ${vehicle.make} ${vehicle.model}`)}</strong></td>
      <td>${escapeHtml(money(vehicle.price_jmd))}</td>
      <td>
        <select data-inventory-status="${escapeHtml(vehicle.id)}"
          aria-label="Status for ${escapeHtml(`${vehicle.year} ${vehicle.make} ${vehicle.model}`)}">
          ${statusOptions.map(status =>
            `<option value="${status}" ${vehicle.status === status ? 'selected' : ''}>${status}</option>`
          ).join('')}
        </select>
      </td>
      <td>${escapeHtml(date(vehicle.created_at))}</td>
    </tr>
  `).join('');

  rows.querySelectorAll('[data-inventory-status]').forEach(select => {
    select.addEventListener('change', () => updateInventoryStatus(select));
  });
}

function renderLeads(leads) {
  const rows = document.getElementById('leadRows');
  const empty = document.getElementById('leadsEmpty');
  empty.classList.toggle('hidden', leads.length > 0);
  rows.innerHTML = leads.map(lead => {
    const vehicle = vehicleById.get(lead.inventory_id);
    const vehicleName = vehicle
      ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      : 'General request';
    return `
      <tr>
        <td>${escapeHtml(lead.customer_name)}</td>
        <td>${escapeHtml([lead.phone, lead.email].filter(Boolean).join(' · '))}</td>
        <td>${escapeHtml(vehicleName)}</td>
        <td>
          <select data-lead-status="${escapeHtml(lead.id)}"
            aria-label="Request status for ${escapeHtml(lead.customer_name)}">
            ${['new', 'contacted', 'closed'].map(status =>
              `<option value="${status}" ${lead.status === status ? 'selected' : ''}>${status}</option>`
            ).join('')}
          </select>
        </td>
        <td>${escapeHtml(date(lead.created_at))}</td>
      </tr>
    `;
  }).join('');

  rows.querySelectorAll('[data-lead-status]').forEach(select => {
    select.addEventListener('change', () => updateLeadStatus(select));
  });
}

async function updateInventoryStatus(select) {
  select.disabled = true;
  try {
    const { error } = await supabase.from('inventory')
      .update({ status: select.value, updated_at: new Date().toISOString() })
      .eq('id', select.dataset.inventoryStatus)
      .eq('seller_id', activeSellerId);
    if (error) throw new Error(error.message);
  } catch (error) {
    select.disabled = false;
    const message = `Could not update vehicle status: ${error.message}`;
    try {
      await loadSellerData();
    } catch (loadError) {
      showNotice(`${message} Refresh also failed: ${loadError.message}`);
      return;
    }
    showNotice(message);
    return;
  }

  try {
    await loadSellerData();
    showNotice('Vehicle status updated.', 'success');
  } catch (error) {
    showNotice(`Vehicle status was saved, but the inventory could not refresh: ${error.message}`);
  } finally {
    select.disabled = false;
  }
}

async function updateLeadStatus(select) {
  select.disabled = true;
  try {
    const { error } = await supabase.from('leads')
      .update({ status: select.value })
      .eq('id', select.dataset.leadStatus)
      .eq('seller_id', activeSellerId);
    if (error) throw new Error(error.message);
  } catch (error) {
    select.disabled = false;
    const message = `Could not update request status: ${error.message}`;
    try {
      await loadSellerData();
    } catch (loadError) {
      showNotice(`${message} Refresh also failed: ${loadError.message}`);
      return;
    }
    showNotice(message);
    return;
  }

  try {
    await loadSellerData();
    showNotice('Request status updated.', 'success');
  } catch (error) {
    showNotice(`Request status was saved, but requests could not refresh: ${error.message}`);
  } finally {
    select.disabled = false;
  }
}

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const button = document.getElementById('signIn');
  const form = new FormData(event.currentTarget);
  setBusy(button, true, 'Signing in...');

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(form.get('email')).trim(),
      password: String(form.get('password'))
    });
    if (error) {
      showNotice(`Sign-in failed: ${error.message}`);
      return;
    }
    await loadWorkspace(data.user);
  } catch (error) {
    showNotice(`Sign-in could not be completed: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

document.getElementById('showPasswordReset').addEventListener('click', () => {
  clearNotice();
  passwordResetView.classList.remove('hidden');
  loginView.classList.add('hidden');
  const loginEmail = document.getElementById('email').value.trim();
  document.getElementById('resetEmail').value = loginEmail;
  document.getElementById('resetEmail').focus();
});

document.getElementById('backToLogin').addEventListener('click', () => {
  clearNotice();
  passwordResetView.classList.add('hidden');
  loginView.classList.remove('hidden');
});

document.getElementById('passwordResetForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const form = new FormData(event.currentTarget);
  const email = String(form.get('email')).trim();
  const button = document.getElementById('sendPasswordReset');
  setBusy(button, true, 'Sending link...');

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${window.location.pathname}`
    });
    if (error) throw new Error(error.message);
    showNotice('If that email has an AutoMatch account, a password link will arrive shortly. Check your inbox and spam folder.', 'success');
  } catch (error) {
    showNotice(`Could not send a password link: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

document.getElementById('passwordSetupForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const form = new FormData(event.currentTarget);
  const password = String(form.get('password'));
  const confirmPassword = String(form.get('confirmPassword'));
  if (password !== confirmPassword) {
    showNotice('The passwords do not match.');
    return;
  }

  const button = document.getElementById('savePassword');
  setBusy(button, true, 'Saving password...');
  try {
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    isSettingPassword = false;
    passwordSetupView.classList.add('hidden');
    await loadWorkspace(data.user);
    showNotice('Password set. Your account is ready.', 'success');
  } catch (error) {
    showNotice(`Could not set password: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

document.getElementById('sellerPicker').addEventListener('change', async event => {
  activeSellerId = event.currentTarget.value;
  updateInventoryImportVisibility();
  try {
    await loadSellerData();
    if (isMasterUser) await loadSellerMembers();
  } catch (error) {
    showNotice(error.message);
  }
});

document.getElementById('importExistingInventory')
  .addEventListener('click', event => importExistingInventory(event.currentTarget));

document.getElementById('membershipForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const form = new FormData(event.currentTarget);
  const button = document.getElementById('assignMembership');
  setBusy(button, true, 'Approving...');

  try {
    const { error } = await supabase.rpc('master_set_seller_membership', {
      member_email: String(form.get('email')).trim(),
      target_seller_id: activeSellerId,
      membership_role: String(form.get('role')),
      membership_active: true
    });
    if (error) throw new Error(error.message);
    event.currentTarget.reset();
    await loadSellerMembers();
    showNotice('Workspace access approved for this account.', 'success');
  } catch (error) {
    showNotice(`Could not approve workspace access: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

document.getElementById('showVehicleForm').addEventListener('click', () => {
  document.getElementById('vehicleForm').classList.remove('hidden');
  document.getElementById('vehicleForm').elements.year.focus();
});

document.getElementById('cancelVehicleForm').addEventListener('click', () => {
  document.getElementById('vehicleForm').reset();
  document.getElementById('vehicleForm').classList.add('hidden');
});

document.getElementById('vehicleForm').addEventListener('submit', async event => {
  event.preventDefault();
  clearNotice();
  const form = event.currentTarget;
  const data = new FormData(form);
  const row = {
    seller_id: activeSellerId,
    year: Number(data.get('year')),
    make: String(data.get('make')).trim(),
    model: String(data.get('model')).trim(),
    price_jmd: Number(data.get('price_jmd')),
    mileage_km: Number(data.get('mileage_km')),
    status: 'draft'
  };
  const button = form.querySelector('[type="submit"]');
  setBusy(button, true, 'Saving...');
  try {
    const { error } = await supabase.from('inventory').insert(row);
    if (error) throw new Error(error.message);
  } catch (error) {
    showNotice(`Could not save vehicle: ${error.message}`);
    setBusy(button, false);
    return;
  }

  form.reset();
  form.classList.add('hidden');
  try {
    await loadSellerData();
    showNotice('Vehicle saved as a private draft.', 'success');
  } catch (error) {
    showNotice(`Vehicle was saved as a draft, but inventory could not refresh: ${error.message}`);
  } finally {
    setBusy(button, false);
  }
});

signOutButton.addEventListener('click', async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  } catch (error) {
    showNotice(`Could not sign out: ${error.message}`);
    return;
  }
  sellers = [];
  activeSellerId = '';
  loginView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
  signOutButton.classList.add('hidden');
  clearNotice();
});

async function start() {
  if (!config?.url || !config?.anonKey ||
      config.url.includes('YOUR_PROJECT_ID') ||
      config.anonKey.includes('YOUR_SUPABASE_')) {
    showNotice('Supabase is not configured. Follow the setup steps in supabase/SETUP.md.');
    document.getElementById('signIn').disabled = true;
    return;
  }

  supabase = createClient(config.url, config.anonKey);
  supabase.auth.onAuthStateChange(event => {
    if (event === 'SIGNED_OUT') {
      showLogin();
      clearNotice();
    } else if (event === 'PASSWORD_RECOVERY') {
      isSettingPassword = true;
      showPasswordSetup();
    }
  });

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showNotice(`Could not restore your session: ${error.message}`);
    return;
  }

  if (authCallbackError) {
    const message = authCallbackError === 'otp_expired'
      ? 'That password link has expired or was already used. Request a fresh link below, then open the newest email.'
      : 'That authentication link could not be verified. Request a fresh password link below.';
    showPasswordReset(message);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return;
  }

  if (data.session) {
    if (needsPasswordSetup) {
      isSettingPassword = true;
      showPasswordSetup();
    } else {
      try {
        await loadWorkspace(data.session.user);
      } catch (workspaceError) {
        showNotice(workspaceError.message);
      }
    }
  }

  if (!data.session && needsPasswordSetup) {
    showPasswordSetup();
  }
}

start();
