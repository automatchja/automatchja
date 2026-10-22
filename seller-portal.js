import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const config = window.AUTOMATCH_SUPABASE_CONFIG;
const notice = document.getElementById('notice');
const loginView = document.getElementById('loginView');
const dashboardView = document.getElementById('dashboardView');
const signOutButton = document.getElementById('signOut');
const statusOptions = ['draft', 'published', 'sold', 'archived'];
let supabase;
let sellers = [];
let activeSellerId = '';
let vehicleById = new Map();

function showNotice(message, kind = 'error') {
  notice.textContent = message;
  notice.className = `notice ${kind === 'success' ? 'success' : ''}`;
}

function clearNotice() {
  notice.textContent = '';
  notice.className = 'notice hidden';
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

  document.getElementById('welcomeTitle').textContent =
    `Welcome, ${user.email || 'seller'}`;
  document.getElementById('accessLabel').textContent = profile.role === 'master'
    ? 'Master access · You can switch between all seller workspaces.'
    : 'Seller access · This workspace is limited to your assigned business.';

  await loadSellerData();
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

document.getElementById('sellerPicker').addEventListener('change', async event => {
  activeSellerId = event.currentTarget.value;
  try {
    await loadSellerData();
  } catch (error) {
    showNotice(error.message);
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
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    showNotice(`Could not restore your session: ${error.message}`);
    return;
  }

  if (data.session) {
    try {
      await loadWorkspace(data.session.user);
    } catch (workspaceError) {
      showNotice(workspaceError.message);
    }
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) {
      loginView.classList.remove('hidden');
      dashboardView.classList.add('hidden');
      signOutButton.classList.add('hidden');
    }
  });
}

start();
