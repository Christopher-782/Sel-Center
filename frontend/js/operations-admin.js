let adminCtx = null;
let sales = [];
let gateEntries = [];
let tickets = [];
let inventory = [];
let expenses = [];
let users = [];
let userOverrides = [];
let rolePermissions = [];
let audits = [];
let saleDraftItems = [];
let saleDraftType = 'kitchen';

const q = id => document.getElementById(id);
const esc = v => SELAccess.esc(v);
const money = v => SELAccess.money(v);
const norm = v => String(v ?? '').trim().toLowerCase();

const viewMeta = {
  dashboard: ['Dashboard', 'Business performance and operational overview.'],
  sales: ['Sales Management', 'Create, review, correct or delete Kitchen and Ticket sales.'],
  gate: ['Gate Entry Management', 'Review, create, correct or delete gate-entry records.'],
  tickets: ['Ticket Management', 'Manage ticket types, selling prices and stock.'],
  expenses: ['Expenses', 'Record operating expenses used in net-profit calculation.'],
  finance: ['Profit & Reports', 'Calculate revenue, gross profit and net profit.'],
  inventory: ['Kitchen Inventory', 'Manage Drinks, Meals and Desserts.'],
  audit: ['Audit Logs', 'Review recorded inventory and ticket changes.'],
  users: ['Users & Access', 'Create staff and control permissions.']
};

function notify(message, type = 'success') {
  SELAccess.alertBox(q('adminAlert'), message, type);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (type !== 'error') setTimeout(() => SELAccess.clearAlert(q('adminAlert')), 4200);
}

function showPanel(panel) {
  document.querySelectorAll('.side-link[data-panel]').forEach(el => el.classList.toggle('active', el.dataset.panel === panel));
  document.querySelectorAll('.admin-view').forEach(el => el.classList.remove('active'));
  q('panel-' + panel)?.classList.add('active');
  const meta = viewMeta[panel] || [panel, ''];
  q('viewTitle').textContent = meta[0];
  q('viewSubtitle').textContent = meta[1];
  q('adminSidebar').classList.remove('open');

  if (panel === 'dashboard') loadDashboard();
  if (panel === 'sales') loadSales();
  if (panel === 'gate') loadGateAdmin();
  if (panel === 'tickets') loadTickets();
  if (panel === 'expenses') loadExpenses();
  if (panel === 'finance') runFinance();
  if (panel === 'inventory') loadInventory();
  if (panel === 'audit') loadAudit();
  if (panel === 'users') loadUserData();
}

function openDrawer(title, subtitle, html) {
  q('drawerTitle').textContent = title;
  q('drawerSubtitle').textContent = subtitle || '';
  q('drawerBody').innerHTML = html;
  q('drawerBackdrop').classList.remove('hidden');
  q('adminDrawer').classList.add('open');
  q('adminDrawer').setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  q('drawerBackdrop').classList.add('hidden');
  q('adminDrawer').classList.remove('open');
  q('adminDrawer').setAttribute('aria-hidden', 'true');
  q('drawerBody').innerHTML = '';
  saleDraftItems = [];
}

function localDateTimeValue(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rangeBounds(kind) {
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);
  if (kind === 'today' || kind === 'daily') {
    start.setHours(0, 0, 0, 0);
    end = new Date(start); end.setDate(end.getDate() + 1);
  } else if (kind === 'week' || kind === 'weekly') {
    start.setHours(0, 0, 0, 0);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    end = new Date(start); end.setDate(end.getDate() + 7);
  } else if (kind === 'month' || kind === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  } else if (kind === 'year') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear() + 1, 0, 1);
  }
  return { start, end };
}

function customFinanceBounds() {
  const range = q('financeRange').value;
  if (range !== 'custom') return rangeBounds(range);
  const s = q('financeStart').value;
  const e = q('financeEnd').value;
  if (!s || !e) throw new Error('Choose both start and end dates.');
  const start = new Date(`${s}T00:00:00`);
  const end = new Date(`${e}T00:00:00`); end.setDate(end.getDate() + 1);
  if (end <= start) throw new Error('End date must be on or after start date.');
  return { start, end };
}

async function financialSummary(start, end) {
  const { data, error } = await SELAccess.db().rpc('get_admin_financial_summary', {
    p_start: start.toISOString(),
    p_end: end.toISOString()
  });
  if (error) throw error;
  return data || {};
}

function setFinancialMetrics(prefix, data) {
  q(prefix + 'Revenue').textContent = money(data.total_revenue || 0);
  q(prefix + 'Cogs').textContent = money(data.cogs || 0);
  q(prefix + 'Gross').textContent = money(data.gross_profit || 0);
  q(prefix + 'Expenses').textContent = money(data.expenses || 0);
  q(prefix + 'Net').textContent = money(data.net_profit || 0);
}

async function loadDashboard() {
  try {
    const { start, end } = rangeBounds(q('dashboardRange').value);
    const [summary] = await Promise.all([
      financialSummary(start, end),
      sales.length ? Promise.resolve() : loadSales(false),
      inventory.length && tickets.length ? Promise.resolve() : Promise.all([loadInventory(false), loadTickets(false)])
    ]);
    setFinancialMetrics('dash', summary);
    q('dashKitchen').textContent = money(summary.kitchen_revenue || 0);
    q('dashTicket').textContent = money(summary.ticket_revenue || 0);
    q('dashGate').textContent = money(summary.gate_revenue || 0);
    renderDashboardRecentSales();
    renderLowStock();
  } catch (err) {
    notify(err.message || 'Could not load dashboard.', 'error');
  }
}

function renderDashboardRecentSales() {
  const recent = [...sales].sort((a, b) => new Date(b.sale_date || b.created_at) - new Date(a.sale_date || a.created_at)).slice(0, 7);
  q('dashRecentSales').innerHTML = recent.length ? recent.map(s => `
    <tr>
      <td><strong>${esc(s.sale_reference)}</strong></td>
      <td>${new Date(s.sale_date || s.created_at).toLocaleString('en-NG')}</td>
      <td><span class="badge ${s.sale_type === 'kitchen' ? 'blue' : 'green'}">${esc(s.sale_type)}</span></td>
      <td>${esc(s.payment_mode)}</td>
      <td><strong>${money(s.total_amount)}</strong></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty">No sales recorded yet.</td></tr>';
}

function renderLowStock() {
  const items = [
    ...inventory.filter(x => Number(x.quantity) <= Number(x.low_stock_threshold)).map(x => ({ name: x.name, qty: x.quantity, kind: 'Kitchen' })),
    ...tickets.filter(x => Number(x.quantity) <= Number(x.low_stock_threshold)).map(x => ({ name: x.package_name, qty: x.quantity, kind: 'Ticket' }))
  ].sort((a, b) => Number(a.qty) - Number(b.qty)).slice(0, 8);
  q('lowStockList').innerHTML = items.length ? items.map(x => `
    <div class="activity-row"><div><strong>${esc(x.name)}</strong><span>${esc(x.kind)}</span></div><span class="stock-count ${Number(x.qty) <= 0 ? 'zero' : ''}">${Number(x.qty).toLocaleString('en-NG')} left</span></div>
  `).join('') : '<div class="empty-line">All tracked items are above their low-stock levels.</div>';
}

async function profileMap(ids = []) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await SELAccess.db().from('profiles').select('id,full_name,email').in('id', unique);
  return Object.fromEntries((data || []).map(p => [p.id, p.full_name || p.email || 'User']));
}

// -----------------------------------------------------------------------------
// Gate Entry report + CRUD
// -----------------------------------------------------------------------------
function gateAdminBounds() {
  const range = q('gateAdminRange').value;
  if (range !== 'custom') return rangeBounds(range);
  const s = q('gateAdminStart').value;
  const e = q('gateAdminEnd').value;
  if (!s || !e) throw new Error('Choose both start and end dates for the gate report.');
  const start = new Date(`${s}T00:00:00`);
  const end = new Date(`${e}T00:00:00`); end.setDate(end.getDate() + 1);
  if (end <= start) throw new Error('Gate report end date must be on or after the start date.');
  return { start, end };
}

async function loadGateAdmin(render = true) {
  try {
    const { start, end } = gateAdminBounds();
    const { data, error } = await SELAccess.db().from('gate_fee_records')
      .select('*')
      .gte('entry_at', start.toISOString())
      .lt('entry_at', end.toISOString())
      .order('entry_at', { ascending: false })
      .limit(5000);
    if (error) throw error;
    gateEntries = data || [];
    if (render) await renderGateAdmin();
  } catch (err) {
    if (render) notify(err.message || 'Could not load gate-entry report.', 'error');
  }
}

async function renderGateAdmin() {
  const search = norm(q('gateAdminSearch').value);
  const payment = q('gatePaymentFilter').value;
  const rows = gateEntries.filter(r =>
    (payment === 'all' || r.payment_mode === payment) &&
    (!search || norm(`${r.receipt_no} ${r.payer_name || ''} ${r.notes || ''}`).includes(search))
  );
  const names = await profileMap(rows.map(r => r.recorded_by));
  const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const visitors = rows.reduce((sum, r) => sum + Number(r.persons_count || 0), 0);
  const byPayment = mode => rows.filter(r => r.payment_mode === mode).reduce((sum, r) => sum + Number(r.amount || 0), 0);
  q('gateAdminRevenue').textContent = money(total);
  q('gateAdminTransactions').textContent = rows.length.toLocaleString('en-NG');
  q('gateAdminVisitors').textContent = visitors.toLocaleString('en-NG');
  q('gateAdminCash').textContent = money(byPayment('cash'));
  q('gateAdminCard').textContent = money(byPayment('card'));
  q('gateAdminTransfer').textContent = money(byPayment('transfer'));
  q('gateAdminRecordCount').textContent = rows.length.toLocaleString('en-NG');
  q('gateAdminRows').innerHTML = rows.length ? rows.map(r => `<tr>
    <td><strong>${esc(r.receipt_no)}</strong></td>
    <td>${new Date(r.entry_at).toLocaleString('en-NG')}</td>
    <td>${esc(r.payer_name || '—')}</td>
    <td>${Number(r.persons_count || 0).toLocaleString('en-NG')}</td>
    <td><span class="badge">${esc(r.payment_mode)}</span></td>
    <td>${r.payment_mode === 'cash' ? money(r.cash_received ?? r.amount) : '—'}</td>
    <td>${r.payment_mode === 'cash' ? money(r.change_given || 0) : '—'}</td>
    <td><strong>${money(r.amount)}</strong></td>
    <td>${esc(names[r.recorded_by] || 'User')}</td>
    <td><div class="row-actions"><button class="action-btn" onclick="openGateEditor(${r.id})" title="Edit gate entry"><i class="fa-solid fa-pen"></i></button><button class="action-btn danger" onclick="deleteGateEntry(${r.id})" title="Delete gate entry"><i class="fa-solid fa-trash"></i></button></div></td>
  </tr>`).join('') : '<tr><td colspan="10" class="empty">No gate-entry records found for this filter.</td></tr>';
}

function gateCashEditorPreview() {
  const pay = q('gateEditPayment')?.value;
  const cashBox = q('gateEditCashFields');
  if (!cashBox) return;
  cashBox.classList.toggle('hidden', pay !== 'cash');
  const amount = Number(q('gateEditAmount')?.value || 0);
  const cashInput = q('gateEditCashReceived');
  if (pay === 'cash' && cashInput && (!cashInput.value || Number(cashInput.value) < amount)) cashInput.value = amount ? amount.toFixed(2) : '';
  const change = pay === 'cash' ? Math.max(0, Number(cashInput?.value || 0) - amount) : 0;
  if (q('gateEditChange')) q('gateEditChange').textContent = money(change);
}

function openGateEditor(id = null) {
  const r = id ? gateEntries.find(x => Number(x.id) === Number(id)) : null;
  const date = localDateTimeValue(r?.entry_at || new Date());
  const cashReceived = r?.payment_mode === 'cash' ? Number(r.cash_received ?? r.amount ?? 0) : Number(r?.amount || 0);
  openDrawer(r ? 'Edit Gate Entry' : 'New Gate Entry', r ? `Correct ${r.receipt_no} while preserving its receipt reference.` : 'Create a gate-entry record from the Admin Dashboard.', `
    <form id="gateAdminForm" class="drawer-form"><input id="gateEditId" type="hidden" value="${r?.id || ''}">
      <div class="field"><label>Receipt Reference</label><input id="gateEditReceipt" value="${esc(r?.receipt_no || 'Auto-generated on save')}" ${r ? 'readonly' : 'readonly'}></div>
      <div class="form-grid">
        <div class="field"><label>Date & Time</label><input id="gateEditDate" type="datetime-local" required value="${date}"></div>
        <div class="field"><label>Visitors</label><input id="gateEditPersons" type="number" min="1" required value="${Number(r?.persons_count || 1)}"></div>
        <div class="field"><label>Amount (₦)</label><input id="gateEditAmount" type="number" min="0" step="0.01" required value="${Number(r?.amount || 0)}"></div>
        <div class="field"><label>Payment Method</label><select id="gateEditPayment"><option value="cash" ${!r || r.payment_mode === 'cash' ? 'selected' : ''}>Cash</option><option value="card" ${r?.payment_mode === 'card' ? 'selected' : ''}>Card / POS</option><option value="transfer" ${r?.payment_mode === 'transfer' ? 'selected' : ''}>Transfer</option></select></div>
      </div>
      <div id="gateEditCashFields" class="cash-tender-inline">
        <div><label>Cash Received (₦)</label><input id="gateEditCashReceived" type="number" min="0" step="0.01" value="${cashReceived}"></div>
        <div class="change-preview compact"><span>Customer Change</span><strong id="gateEditChange">₦0.00</strong></div>
      </div>
      <div class="field"><label>Payer / Group</label><input id="gateEditPayer" value="${esc(r?.payer_name || '')}" placeholder="Optional name or group"></div>
      <div class="field"><label>Notes</label><textarea id="gateEditNotes" rows="3" placeholder="Optional notes">${esc(r?.notes || '')}</textarea></div>
      <div class="drawer-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> ${r ? 'Save Changes' : 'Create Entry'}</button><button class="btn btn-secondary" type="button" id="cancelGateEdit">Cancel</button></div>
    </form>`);
  q('gateEditPayment').onchange = gateCashEditorPreview;
  q('gateEditAmount').oninput = gateCashEditorPreview;
  q('gateEditCashReceived').oninput = gateCashEditorPreview;
  q('gateAdminForm').onsubmit = saveGateEntry;
  q('cancelGateEdit').onclick = closeDrawer;
  gateCashEditorPreview();
}

async function saveGateEntry(e) {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true;
  const id = q('gateEditId').value;
  try {
    const amount = Number(q('gateEditAmount').value || 0);
    const payment = q('gateEditPayment').value;
    const cashReceived = payment === 'cash' ? Number(q('gateEditCashReceived').value || 0) : null;
    if (amount < 0) throw new Error('Gate amount cannot be negative.');
    if (payment === 'cash' && cashReceived < amount) throw new Error('Cash received cannot be less than the gate-entry amount.');
    const payload = {
      amount,
      persons_count: Number(q('gateEditPersons').value || 1),
      payment_mode: payment,
      payer_name: q('gateEditPayer').value.trim() || null,
      notes: q('gateEditNotes').value.trim() || null,
      entry_at: new Date(q('gateEditDate').value).toISOString(),
      cash_received: payment === 'cash' ? cashReceived : null,
      change_given: payment === 'cash' ? Math.max(0, cashReceived - amount) : 0,
      updated_at: new Date().toISOString(),
      updated_by: adminCtx.user.id
    };
    if (!id) {
      payload.receipt_no = `GATE-${Date.now()}`;
      payload.recorded_by = adminCtx.user.id;
    }
    const query = id
      ? SELAccess.db().from('gate_fee_records').update(payload).eq('id', Number(id))
      : SELAccess.db().from('gate_fee_records').insert(payload);
    const { error } = await query;
    if (error) throw error;
    closeDrawer(); notify(id ? 'Gate entry updated.' : 'Gate entry created.');
    await loadGateAdmin(); await loadDashboard();
  } catch (err) { notify(err.message || 'Could not save gate entry.', 'error'); }
  finally { btn.disabled = false; }
}

async function deleteGateEntry(id) {
  const r = gateEntries.find(x => Number(x.id) === Number(id));
  if (!r || !confirm(`Delete gate entry ${r.receipt_no} (${money(r.amount)})? This will remove it from revenue and reconciliation reports.`)) return;
  const { error } = await SELAccess.db().from('gate_fee_records').delete().eq('id', Number(id));
  if (error) return notify(error.message, 'error');
  notify('Gate entry deleted.'); await loadGateAdmin(); await loadDashboard();
}

// -----------------------------------------------------------------------------
// Sales CRUD
// -----------------------------------------------------------------------------
async function loadSales(render = true) {
  const { data, error } = await SELAccess.db().from('sales')
    .select('id,sale_reference,payment_mode,total_amount,cash_received,change_given,sold_by,sale_type,sale_date,created_at,sale_items(id,product_type,product_id,item_name,quantity,unit_price,unit_cost,total_price)')
    .order('sale_date', { ascending: false })
    .limit(1000);
  if (error) { if (render) notify(error.message, 'error'); return; }
  sales = data || [];
  if (render) await renderSales();
}

async function renderSales() {
  const search = norm(q('salesSearch').value);
  const type = q('salesTypeFilter').value;
  const rows = sales.filter(s => {
    const items = (s.sale_items || []).map(i => i.item_name).join(' ');
    return (type === 'all' || s.sale_type === type) && (!search || norm(`${s.sale_reference} ${s.payment_mode} ${items}`).includes(search));
  });
  const names = await profileMap(rows.map(s => s.sold_by));
  q('salesRows').innerHTML = rows.length ? rows.map(s => {
    const itemText = (s.sale_items || []).map(i => `${i.item_name} × ${i.quantity}`).join(', ') || '—';
    return `<tr>
      <td><strong>${esc(s.sale_reference)}</strong></td>
      <td>${new Date(s.sale_date || s.created_at).toLocaleString('en-NG')}</td>
      <td><span class="badge ${s.sale_type === 'kitchen' ? 'blue' : 'green'}">${esc(s.sale_type)}</span></td>
      <td class="item-summary" title="${esc(itemText)}">${esc(itemText)}</td>
      <td>${esc(s.payment_mode)}</td>
      <td><strong>${money(s.total_amount)}</strong></td>
      <td>${esc(names[s.sold_by] || 'User')}</td>
      <td><div class="row-actions"><button class="action-btn" onclick="openSaleEditor(${s.id})" title="Edit"><i class="fa-solid fa-pen"></i></button><button class="action-btn danger" onclick="deleteSale(${s.id})" title="Delete"><i class="fa-solid fa-trash"></i></button></div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty">No sales found.</td></tr>';
}

async function ensureSaleCatalog(type) {
  if (type === 'kitchen' && !inventory.length) await loadInventory(false);
  if (type === 'ticket' && !tickets.length) await loadTickets(false);
}

function saleCatalog(type) {
  return type === 'kitchen'
    ? inventory.filter(x => x.is_active || saleDraftItems.some(i => String(i.id) === String(x.id))).map(x => ({ id: x.id, name: x.name, price: Number(x.price), cost: Number(x.cost_price || 0), qty: Number(x.quantity) }))
    : tickets.filter(x => x.is_active || saleDraftItems.some(i => String(i.id) === String(x.id))).map(x => ({ id: x.id, name: x.package_name, price: Number(x.price), cost: 0, qty: Number(x.quantity) }));
}

async function openSaleEditor(id = null) {
  const sale = id ? sales.find(s => Number(s.id) === Number(id)) : null;
  saleDraftType = sale?.sale_type || 'kitchen';
  await ensureSaleCatalog(saleDraftType);
  saleDraftItems = sale ? (sale.sale_items || []).map(i => ({ id: i.product_id, name: i.item_name, quantity: Number(i.quantity), unit_price: Number(i.unit_price || 0), unit_cost: sale.sale_type === 'ticket' ? 0 : Number(i.unit_cost || 0) })) : [];
  const dateVal = localDateTimeValue(sale?.sale_date || sale?.created_at || new Date());
  openDrawer(sale ? 'Edit Sale' : 'New Sale', sale ? `Correct ${sale.sale_reference}. Stock will be reconciled automatically.` : 'Record a manual Kitchen or Ticket sale.', `
    <form id="saleForm" class="drawer-form">
      <input id="saleId" type="hidden" value="${sale?.id || ''}">
      ${sale ? `<div class="readonly-ref"><span>Reference</span><strong>${esc(sale.sale_reference)}</strong></div>` : ''}
      <div class="form-grid">
        <div class="field"><label>Sale Type</label><select id="saleType"><option value="kitchen" ${saleDraftType === 'kitchen' ? 'selected' : ''}>Kitchen</option><option value="ticket" ${saleDraftType === 'ticket' ? 'selected' : ''}>Ticket</option></select></div>
        <div class="field"><label>Payment</label><select id="salePayment"><option value="cash" ${sale?.payment_mode === 'cash' ? 'selected' : ''}>Cash</option><option value="card" ${sale?.payment_mode === 'card' ? 'selected' : ''}>Card</option><option value="transfer" ${sale?.payment_mode === 'transfer' ? 'selected' : ''}>Transfer</option></select></div>
        <div class="field full"><label>Sale Date & Time</label><input id="saleDate" type="datetime-local" value="${dateVal}" required></div>
        <div class="field full" id="adminSaleCashFields"><div class="cash-tender-inline"><div><label>Cash Received (₦)</label><input id="saleCashReceived" type="number" min="0" step="0.01" value="${Number(sale?.cash_received ?? sale?.total_amount ?? 0)}"></div><div class="change-preview compact"><span>Change to customer</span><strong id="saleChangePreview">₦0.00</strong></div></div></div>
      </div>
      <div class="drawer-divider"></div>
      <label class="section-label">Sale Items</label>
      <div class="inline-add"><select id="saleProduct"></select><input id="saleQty" type="number" min="1" value="1"><button type="button" class="btn btn-secondary" id="addSaleItem"><i class="fa-solid fa-plus"></i> Add</button></div>
      <div id="saleDraftList" class="draft-list"></div>
      <div class="drawer-total"><span>Calculated Total</span><strong id="saleDraftTotal">₦0.00</strong></div>
      <div class="drawer-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> ${sale ? 'Save Changes' : 'Create Sale'}</button><button class="btn btn-secondary" type="button" id="cancelSale">Cancel</button></div>
    </form>`);
  populateSaleProductSelect();
  renderSaleDraft();
  q('saleType').onchange = async e => {
    if (saleDraftItems.length && !confirm('Changing the sale type will clear the selected items. Continue?')) { e.target.value = saleDraftType; return; }
    saleDraftType = e.target.value;
    saleDraftItems = [];
    await ensureSaleCatalog(saleDraftType);
    populateSaleProductSelect(); renderSaleDraft();
  };
  q('addSaleItem').onclick = addSaleDraftItem;
  q('salePayment').onchange = updateAdminSaleCashPreview;
  q('saleCashReceived').oninput = updateAdminSaleCashPreview;
  q('saleForm').onsubmit = saveSale;
  q('cancelSale').onclick = closeDrawer;
  updateAdminSaleCashPreview();
}

function populateSaleProductSelect() {
  const el = q('saleProduct'); if (!el) return;
  const list = saleCatalog(saleDraftType);
  el.innerHTML = list.length ? list.map(p => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)} (${p.qty} available)</option>`).join('') : '<option value="">No available items</option>';
}

function addSaleDraftItem() {
  const id = q('saleProduct').value;
  const qty = Math.max(1, Number(q('saleQty').value || 1));
  if (!id) return;
  const product = saleCatalog(saleDraftType).find(p => String(p.id) === String(id));
  if (!product) return;
  const existing = saleDraftItems.find(i => String(i.id) === String(id));
  if (existing) existing.quantity += qty;
  else saleDraftItems.push({ id: String(product.id), name: product.name, quantity: qty, unit_price: Number(product.price || 0), unit_cost: Number(product.cost || 0) });
  q('saleQty').value = 1;
  renderSaleDraft();
}

function renderSaleDraft() {
  const list = q('saleDraftList'); if (!list) return;
  const catalog = saleCatalog(saleDraftType);
  list.innerHTML = saleDraftItems.length ? saleDraftItems.map((i, idx) => {
    const p = catalog.find(x => String(x.id) === String(i.id));
    const price = Number(i.unit_price ?? p?.price ?? 0);
    return `<div class="draft-row"><div><strong>${esc(i.name)}</strong><span>${money(price)} each</span></div><div class="draft-qty"><button type="button" onclick="changeSaleDraftQty(${idx},-1)">−</button><span>${i.quantity}</span><button type="button" onclick="changeSaleDraftQty(${idx},1)">+</button><button type="button" class="remove" onclick="removeSaleDraft(${idx})"><i class="fa-solid fa-xmark"></i></button></div></div>`;
  }).join('') : '<div class="empty-line">Add at least one item to the sale.</div>';
  const total = saleDraftItems.reduce((sum, i) => {
    const p = catalog.find(x => String(x.id) === String(i.id));
    return sum + Number(i.unit_price ?? p?.price ?? 0) * Number(i.quantity || 0);
  }, 0);
  if (q('saleDraftTotal')) q('saleDraftTotal').textContent = money(total);
  updateAdminSaleCashPreview();
}

function saleDraftTotalAmount() {
  const catalog = saleCatalog(saleDraftType);
  return saleDraftItems.reduce((sum, i) => {
    const p = catalog.find(x => String(x.id) === String(i.id));
    return sum + Number(i.unit_price ?? p?.price ?? 0) * Number(i.quantity || 0);
  }, 0);
}

function updateAdminSaleCashPreview() {
  const fields = q('adminSaleCashFields'), payment = q('salePayment'), input = q('saleCashReceived'), preview = q('saleChangePreview');
  if (!fields || !payment || !input || !preview) return;
  const isCash = payment.value === 'cash'; fields.classList.toggle('hidden', !isCash);
  if (!isCash) { preview.textContent = money(0); return; }
  const total = saleDraftTotalAmount(), received = Number(input.value || 0);
  preview.textContent = money(Math.max(0, received - total));
}

function changeSaleDraftQty(index, delta) {
  if (!saleDraftItems[index]) return;
  saleDraftItems[index].quantity = Math.max(1, Number(saleDraftItems[index].quantity) + delta);
  renderSaleDraft();
}

function removeSaleDraft(index) { saleDraftItems.splice(index, 1); renderSaleDraft(); }

async function saveSale(e) {
  e.preventDefault();
  if (!saleDraftItems.length) return notify('Add at least one item to the sale.', 'error');
  const btn = e.submitter; btn.disabled = true;
  const id = q('saleId').value;
  const payload = saleDraftItems.map(i => ({ id: String(i.id), quantity: Number(i.quantity), unit_price: Number(i.unit_price || 0), unit_cost: Number(i.unit_cost || 0) }));
  const saleDate = new Date(q('saleDate').value);
  const paymentMode = q('salePayment').value;
  const saleTotal = saleDraftTotalAmount();
  const cashReceived = paymentMode === 'cash' ? Number(q('saleCashReceived').value || 0) : null;
  if (paymentMode === 'cash' && cashReceived < saleTotal) { btn.disabled = false; return notify('Cash received cannot be less than the sale total.', 'error'); }
  try {
    let result;
    if (id) {
      result = await SELAccess.db().rpc('admin_replace_sale_v2', {
        p_sale_id: Number(id),
        p_sale_type: q('saleType').value,
        p_payment_mode: paymentMode,
        p_items: payload,
        p_sale_date: saleDate.toISOString(),
        p_cash_received: cashReceived
      });
    } else {
      result = await SELAccess.db().rpc('process_pos_sale_v2', {
        p_sale_type: q('saleType').value,
        p_payment_mode: paymentMode,
        p_items: payload,
        p_sale_date: saleDate.toISOString(),
        p_cash_received: cashReceived
      });
    }
    if (result.error) throw result.error;
    closeDrawer();
    notify(id ? 'Sale updated and stock reconciled.' : 'Sale created successfully.');
    await Promise.all([loadSales(), loadInventory(false), loadTickets(false)]);
  } catch (err) {
    notify(err.message || 'Could not save sale.', 'error');
  } finally { btn.disabled = false; }
}

async function deleteSale(id) {
  const sale = sales.find(s => Number(s.id) === Number(id));
  if (!sale || !confirm(`Delete sale ${sale.sale_reference}? Its item quantities will be returned to stock.`)) return;
  const { error } = await SELAccess.db().rpc('admin_delete_sale', { p_sale_id: Number(id) });
  if (error) return notify(error.message, 'error');
  notify('Sale deleted and stock restored.');
  await Promise.all([loadSales(), loadInventory(false), loadTickets(false)]);
}

// -----------------------------------------------------------------------------
// Ticket CRUD
// -----------------------------------------------------------------------------
async function loadTickets(render = true) {
  const { data, error } = await SELAccess.db().from('ticket_packages').select('*').order('package_name');
  if (error) { if (render) notify(error.message, 'error'); return; }
  tickets = data || [];
  if (render) renderTickets();
}

function renderTickets() {
  const search = norm(q('ticketSearch').value);
  const audience = q('ticketAudienceFilter').value;
  const rows = tickets.filter(t => (audience === 'all' || norm(t.audience) === audience) && (!search || norm(`${t.package_name} ${t.audience} ${t.ticket_type}`).includes(search)));
  q('ticketRows').innerHTML = rows.length ? rows.map(t => `
    <tr><td><strong>${esc(t.package_name)}</strong></td><td>${esc(t.audience || '—')}</td><td>${esc(t.ticket_type || '—')}</td><td>${money(t.price)}</td><td><strong>${Number(t.quantity || 0).toLocaleString('en-NG')}</strong></td><td>${Number(t.low_stock_threshold || 0)}</td><td><span class="badge ${t.is_active ? 'green' : 'red'}">${t.is_active ? 'Active' : 'Inactive'}</span></td><td><div class="row-actions"><button class="action-btn" onclick="openTicketEditor(${t.id})"><i class="fa-solid fa-pen"></i></button><button class="action-btn danger" onclick="deleteTicket(${t.id})"><i class="fa-solid fa-trash"></i></button></div></td></tr>
  `).join('') : '<tr><td colspan="8" class="empty">No tickets found.</td></tr>';
}

function openTicketEditor(id = null) {
  const t = id ? tickets.find(x => Number(x.id) === Number(id)) : null;
  openDrawer(t ? 'Edit Ticket' : 'New Ticket', 'Manage the ticket definition, pricing and stock.', `
    <form id="ticketForm" class="drawer-form">
      <input id="ticketId" type="hidden" value="${t?.id || ''}">
      <div class="field"><label>Ticket Name</label><input id="ticketName" required value="${esc(t?.package_name || '')}"></div>
      <div class="form-grid">
        <div class="field"><label>Group</label><select id="ticketAudience"><option value="kids" ${norm(t?.audience) === 'kids' ? 'selected' : ''}>Kids</option><option value="adult" ${norm(t?.audience) === 'adult' ? 'selected' : ''}>Adult</option></select></div>
        <div class="field"><label>Type</label><select id="ticketType"><option value="outdoor" ${norm(t?.ticket_type) === 'outdoor' ? 'selected' : ''}>Outdoor</option><option value="indoor" ${norm(t?.ticket_type) === 'indoor' ? 'selected' : ''}>Indoor</option><option value="swimming" ${norm(t?.ticket_type) === 'swimming' ? 'selected' : ''}>Swimming</option><option value="premium" ${norm(t?.ticket_type) === 'premium' ? 'selected' : ''}>Premium</option></select></div>
        <div class="field"><label>Selling Price (₦)</label><input id="ticketPrice" type="number" min="0" step="0.01" required value="${Number(t?.price || 0)}"></div>
        <div class="field"><label>Quantity</label><input id="ticketQty" type="number" min="0" required value="${Number(t?.quantity || 0)}"></div>
        <div class="field"><label>Low Stock Alert</label><input id="ticketLow" type="number" min="0" value="${Number(t?.low_stock_threshold || 20)}"></div>
      </div>
      <div class="field"><label>Description</label><textarea id="ticketDescription" rows="3">${esc(t?.description || '')}</textarea></div>
      <label class="toggle-row"><input id="ticketActive" type="checkbox" ${t?.is_active === false ? '' : 'checked'}><span>Ticket is active and available in POS</span></label>
      <div class="drawer-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Save Ticket</button><button class="btn btn-secondary" type="button" id="cancelTicket">Cancel</button></div>
    </form>`);
  q('ticketForm').onsubmit = saveTicket;
  q('cancelTicket').onclick = closeDrawer;
}

async function saveTicket(e) {
  e.preventDefault(); const btn = e.submitter; btn.disabled = true;
  const id = q('ticketId').value;
  const payload = {
    package_name: q('ticketName').value.trim(), audience: q('ticketAudience').value, ticket_type: q('ticketType').value,
    price: Number(q('ticketPrice').value || 0), quantity: Number(q('ticketQty').value || 0),
    low_stock_threshold: Number(q('ticketLow').value || 0), description: q('ticketDescription').value.trim() || null,
    is_active: q('ticketActive').checked, updated_at: new Date().toISOString()
  };
  const query = id ? SELAccess.db().from('ticket_packages').update(payload).eq('id', Number(id)) : SELAccess.db().from('ticket_packages').insert(payload);
  const { error } = await query;
  btn.disabled = false;
  if (error) return notify(error.message, 'error');
  closeDrawer(); notify(id ? 'Ticket updated.' : 'Ticket created.'); await loadTickets();
}

async function deleteTicket(id) {
  const t = tickets.find(x => Number(x.id) === Number(id));
  if (!t || !confirm(`Delete ${t.package_name}? Existing historical sales will remain, but this ticket will disappear from the POS.`)) return;
  const { error } = await SELAccess.db().from('ticket_packages').delete().eq('id', id);
  if (error) return notify(error.message, 'error');
  notify('Ticket deleted.'); await loadTickets();
}

// -----------------------------------------------------------------------------
// Expenses CRUD
// -----------------------------------------------------------------------------
async function loadExpenses(render = true) {
  const { data, error } = await SELAccess.db().from('expenses').select('*').order('expense_date', { ascending: false }).limit(1000);
  if (error) { if (render) notify(error.message, 'error'); return; }
  expenses = data || [];
  if (render) renderExpenses();
}

function renderExpenses() {
  const search = norm(q('expenseSearch').value);
  const cat = q('expenseCategoryFilter').value;
  const section = q('expenseSectionFilter').value;
  const categories = [...new Set(expenses.map(x => x.category).filter(Boolean))].sort();
  const current = cat;
  q('expenseCategoryFilter').innerHTML = '<option value="all">All categories</option>' + categories.map(c => `<option value="${esc(c)}" ${current === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const rows = expenses.filter(x => (current === 'all' || x.category === current) && (section === 'all' || (x.section || 'general') === section) && (!search || norm(`${x.expense_reference} ${x.section || 'general'} ${x.category} ${x.description} ${x.payment_mode}`).includes(search)));
  const total = rows.reduce((s, x) => s + Number(x.amount || 0), 0);
  q('expenseTotal').textContent = money(total); q('expenseCount').textContent = rows.length.toLocaleString('en-NG');
  q('expenseRows').innerHTML = rows.length ? rows.map(x => `
    <tr><td><strong>${esc(x.expense_reference)}</strong></td><td>${new Date(x.expense_date).toLocaleString('en-NG')}</td><td><span class="badge">${esc(({general:'General',kitchen:'Kitchen',ticket:'Tickets',gate:'Gate Entry'})[x.section || 'general'] || x.section || 'General')}</span></td><td><span class="badge">${esc(x.category)}</span></td><td>${esc(x.description)}</td><td>${esc(x.payment_mode)}</td><td><strong>${money(x.amount)}</strong></td><td><div class="row-actions"><button class="action-btn" onclick="openExpenseEditor(${x.id})"><i class="fa-solid fa-pen"></i></button><button class="action-btn danger" onclick="deleteExpense(${x.id})"><i class="fa-solid fa-trash"></i></button></div></td></tr>
  `).join('') : '<tr><td colspan="8" class="empty">No expenses found.</td></tr>';
}

function openExpenseEditor(id = null) {
  const x = id ? expenses.find(e => Number(e.id) === Number(id)) : null;
  openDrawer(x ? 'Edit Expense' : 'Record Expense', 'Expenses reduce net profit but do not affect gross profit.', `
    <form id="expenseForm" class="drawer-form">
      <input id="expenseId" type="hidden" value="${x?.id || ''}">
      ${x ? `<div class="readonly-ref"><span>Reference</span><strong>${esc(x.expense_reference)}</strong></div>` : ''}
      <div class="field"><label>Section</label><select id="expenseSection"><option value="general" ${(x?.section || 'general') === 'general' ? 'selected' : ''}>General</option><option value="kitchen" ${x?.section === 'kitchen' ? 'selected' : ''}>Kitchen</option><option value="ticket" ${x?.section === 'ticket' ? 'selected' : ''}>Tickets</option><option value="gate" ${x?.section === 'gate' ? 'selected' : ''}>Gate Entry</option></select></div>
      <div class="field"><label>Category</label><input id="expenseCategory" list="expenseCategories" required value="${esc(x?.category || '')}" placeholder="e.g. Utilities"><datalist id="expenseCategories"><option value="Utilities"><option value="Maintenance"><option value="Staff"><option value="Supplies"><option value="Transport"><option value="Marketing"><option value="Rent"><option value="Other"></datalist></div>
      <div class="field"><label>Description</label><input id="expenseDescription" required value="${esc(x?.description || '')}" placeholder="What was this expense for?"></div>
      <div class="form-grid">
        <div class="field"><label>Amount (₦)</label><input id="expenseAmount" type="number" min="0" step="0.01" required value="${Number(x?.amount || 0)}"></div>
        <div class="field"><label>Payment Method</label><select id="expensePayment"><option value="cash" ${x?.payment_mode === 'cash' ? 'selected' : ''}>Cash</option><option value="card" ${x?.payment_mode === 'card' ? 'selected' : ''}>Card</option><option value="transfer" ${x?.payment_mode === 'transfer' ? 'selected' : ''}>Transfer</option><option value="other" ${x?.payment_mode === 'other' ? 'selected' : ''}>Other</option></select></div>
        <div class="field full"><label>Expense Date & Time</label><input id="expenseDate" type="datetime-local" required value="${localDateTimeValue(x?.expense_date || new Date())}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea id="expenseNotes" rows="4">${esc(x?.notes || '')}</textarea></div>
      <div class="drawer-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Save Expense</button><button class="btn btn-secondary" type="button" id="cancelExpense">Cancel</button></div>
    </form>`);
  q('expenseForm').onsubmit = saveExpense; q('cancelExpense').onclick = closeDrawer;
}

async function saveExpense(e) {
  e.preventDefault(); const btn = e.submitter; btn.disabled = true;
  const id = q('expenseId').value;
  const payload = {
    section: q('expenseSection').value, category: q('expenseCategory').value.trim(), description: q('expenseDescription').value.trim(), amount: Number(q('expenseAmount').value || 0),
    payment_mode: q('expensePayment').value, expense_date: new Date(q('expenseDate').value).toISOString(), notes: q('expenseNotes').value.trim() || null,
    updated_at: new Date().toISOString()
  };
  if (!id) payload.recorded_by = adminCtx.user.id;
  const query = id ? SELAccess.db().from('expenses').update(payload).eq('id', Number(id)) : SELAccess.db().from('expenses').insert(payload);
  const { error } = await query; btn.disabled = false;
  if (error) return notify(error.message, 'error');
  closeDrawer(); notify(id ? 'Expense updated.' : 'Expense recorded.'); await loadExpenses();
}

async function deleteExpense(id) {
  const x = expenses.find(e => Number(e.id) === Number(id));
  if (!x || !confirm(`Delete expense ${x.expense_reference} (${money(x.amount)})?`)) return;
  const { error } = await SELAccess.db().from('expenses').delete().eq('id', id);
  if (error) return notify(error.message, 'error');
  notify('Expense deleted.'); await loadExpenses();
}

// -----------------------------------------------------------------------------
// Profit report
// -----------------------------------------------------------------------------
async function runFinance() {
  try {
    const { start, end } = customFinanceBounds();
    const data = await financialSummary(start, end);
    setFinancialMetrics('fin', data);
    q('finKitchen').textContent = money(data.kitchen_revenue || 0);
    q('finTicket').textContent = money(data.ticket_revenue || 0);
    q('finGate').textContent = money(data.gate_revenue || 0);
    await runDetailedFinanceReport(start, end);
  } catch (err) { notify(err.message || 'Could not calculate profit.', 'error'); }
}

async function runDetailedFinanceReport(start, end) {
  const type = q('financeReportType').value;
  let rows = [], total = 0;
  if (type === 'kitchen' || type === 'ticket') {
    const { data, error } = await SELAccess.db().from('sales')
      .select('id,sale_reference,payment_mode,total_amount,sold_by,sale_type,sale_date,created_at,sale_items(item_name,quantity,total_price)')
      .eq('sale_type', type).gte('sale_date', start.toISOString()).lt('sale_date', end.toISOString()).order('sale_date', { ascending: false });
    if (error) throw error;
    rows = data || []; total = rows.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const names = await profileMap(rows.map(r => r.sold_by));
    q('financeDetailTitle').textContent = type === 'ticket' ? 'Ticket Sales Report' : 'Kitchen Sales Report';
    q('financeDetailHead').innerHTML = '<tr><th>Reference</th><th>Date</th><th>Items</th><th>Payment</th><th>Sold By</th><th>Amount</th></tr>';
    q('financeDetailRows').innerHTML = rows.length ? rows.map(r => `<tr><td><strong>${esc(r.sale_reference)}</strong></td><td>${new Date(r.sale_date || r.created_at).toLocaleString('en-NG')}</td><td class="item-summary">${esc((r.sale_items || []).map(i => `${i.item_name} × ${i.quantity}`).join(', ') || '—')}</td><td>${esc(r.payment_mode)}</td><td>${esc(names[r.sold_by] || 'User')}</td><td><strong>${money(r.total_amount)}</strong></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No records for this period.</td></tr>';
  } else if (type === 'gate') {
    const { data, error } = await SELAccess.db().from('gate_fee_records').select('*').gte('entry_at', start.toISOString()).lt('entry_at', end.toISOString()).order('entry_at', { ascending: false });
    if (error) throw error;
    rows = data || []; total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    q('financeDetailTitle').textContent = 'Gate Entry Report';
    q('financeDetailHead').innerHTML = '<tr><th>Receipt</th><th>Date</th><th>Payer / Group</th><th>Visitors</th><th>Payment</th><th>Amount</th></tr>';
    q('financeDetailRows').innerHTML = rows.length ? rows.map(r => `<tr><td><strong>${esc(r.receipt_no)}</strong></td><td>${new Date(r.entry_at).toLocaleString('en-NG')}</td><td>${esc(r.payer_name || '—')}</td><td>${Number(r.persons_count || 0).toLocaleString('en-NG')}</td><td>${esc(r.payment_mode)}</td><td><strong>${money(r.amount)}</strong></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No records for this period.</td></tr>';
  } else {
    const { data, error } = await SELAccess.db().from('expenses').select('*').gte('expense_date', start.toISOString()).lt('expense_date', end.toISOString()).order('expense_date', { ascending: false });
    if (error) throw error;
    rows = data || []; total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    q('financeDetailTitle').textContent = 'Expense Report';
    q('financeDetailHead').innerHTML = '<tr><th>Reference</th><th>Date</th><th>Category</th><th>Description</th><th>Payment</th><th>Amount</th></tr>';
    q('financeDetailRows').innerHTML = rows.length ? rows.map(r => `<tr><td><strong>${esc(r.expense_reference)}</strong></td><td>${new Date(r.expense_date).toLocaleString('en-NG')}</td><td>${esc(r.category)}</td><td>${esc(r.description)}</td><td>${esc(r.payment_mode)}</td><td><strong>${money(r.amount)}</strong></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No records for this period.</td></tr>';
  }
  q('financeRecordCount').textContent = rows.length.toLocaleString('en-NG');
  q('financeRecordTotal').textContent = money(total);
}

// -----------------------------------------------------------------------------
// Kitchen inventory CRUD
// -----------------------------------------------------------------------------
async function loadInventory(render = true) {
  const { data, error } = await SELAccess.db().from('inventory_items').select('*').order('name');
  if (error) { if (render) notify(error.message, 'error'); return; }
  inventory = data || [];
  if (render) renderInventory();
}

function renderInventory() {
  const search = norm(q('inventorySearch').value);
  const cat = q('inventoryCategoryFilter').value;
  const rows = inventory.filter(p => (cat === 'all' || p.category === cat) && (!search || norm(`${p.name} ${p.sku} ${p.category}`).includes(search)));
  q('inventoryRows').innerHTML = rows.length ? rows.map(p => `
    <tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.sku || '—')}</td><td>${esc(p.category || '—')}</td><td>${money(p.price)}</td><td>${money(p.cost_price || 0)}</td><td><strong>${Number(p.quantity || 0).toLocaleString('en-NG')}</strong></td><td><span class="badge ${p.is_active ? 'green' : 'red'}">${p.is_active ? 'Active' : 'Inactive'}</span></td><td><div class="row-actions"><button class="action-btn" onclick="openProductEditor(${p.id})"><i class="fa-solid fa-pen"></i></button><button class="action-btn danger" onclick="deleteProduct(${p.id})"><i class="fa-solid fa-trash"></i></button></div></td></tr>
  `).join('') : '<tr><td colspan="8" class="empty">No kitchen products found.</td></tr>';
}

function openProductEditor(id = null) {
  const p = id ? inventory.find(x => Number(x.id) === Number(id)) : null;
  openDrawer(p ? 'Edit Kitchen Product' : 'New Kitchen Product', 'Manage pricing, cost, category and stock.', `
    <form id="productForm" class="drawer-form"><input id="productId" type="hidden" value="${p?.id || ''}">
      <div class="field"><label>Product Name</label><input id="productName" required value="${esc(p?.name || '')}"></div>
      <div class="form-grid"><div class="field"><label>SKU</label><input id="productSku" value="${esc(p?.sku || '')}"></div><div class="field"><label>Category</label><select id="productCategory"><option value="Drinks" ${p?.category === 'Drinks' ? 'selected' : ''}>Drinks</option><option value="Meals" ${p?.category === 'Meals' ? 'selected' : ''}>Meals</option><option value="Desserts" ${p?.category === 'Desserts' ? 'selected' : ''}>Desserts</option></select></div><div class="field"><label>Selling Price (₦)</label><input id="productPrice" type="number" min="0" step="0.01" required value="${Number(p?.price || 0)}"></div><div class="field"><label>Cost Price (₦)</label><input id="productCost" type="number" min="0" step="0.01" value="${Number(p?.cost_price || 0)}"></div><div class="field"><label>Quantity</label><input id="productQty" type="number" min="0" required value="${Number(p?.quantity || 0)}"></div><div class="field"><label>Low Stock Alert</label><input id="productLow" type="number" min="0" value="${Number(p?.low_stock_threshold || 5)}"></div></div>
      <div class="field"><label>Description</label><textarea id="productDescription" rows="3">${esc(p?.description || '')}</textarea></div>
      <label class="toggle-row"><input id="productActive" type="checkbox" ${p?.is_active === false ? '' : 'checked'}><span>Product is active and available in Kitchen POS</span></label>
      <div class="drawer-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> Save Product</button><button class="btn btn-secondary" type="button" id="cancelProduct">Cancel</button></div>
    </form>`);
  q('productForm').onsubmit = saveProduct; q('cancelProduct').onclick = closeDrawer;
}

async function saveProduct(e) {
  e.preventDefault(); const btn = e.submitter; btn.disabled = true;
  const id = q('productId').value;
  const payload = { name: q('productName').value.trim(), sku: q('productSku').value.trim() || null, category: q('productCategory').value, department: 'kitchen', price: Number(q('productPrice').value || 0), cost_price: Number(q('productCost').value || 0), quantity: Number(q('productQty').value || 0), low_stock_threshold: Number(q('productLow').value || 0), description: q('productDescription').value.trim() || null, is_active: q('productActive').checked, updated_at: new Date().toISOString() };
  const query = id ? SELAccess.db().from('inventory_items').update(payload).eq('id', Number(id)) : SELAccess.db().from('inventory_items').insert(payload);
  const { error } = await query; btn.disabled = false;
  if (error) return notify(error.message, 'error');
  closeDrawer(); notify(id ? 'Product updated.' : 'Product created.'); await loadInventory();
}

async function deleteProduct(id) {
  const p = inventory.find(x => Number(x.id) === Number(id));
  if (!p || !confirm(`Delete ${p.name}? Historical sale records remain available.`)) return;
  const { error } = await SELAccess.db().from('inventory_items').delete().eq('id', id);
  if (error) return notify(error.message, 'error');
  notify('Product deleted.'); await loadInventory();
}

// -----------------------------------------------------------------------------
// Audits
// -----------------------------------------------------------------------------
async function loadAudit() {
  const type = q('auditType').value;
  const table = type === 'tickets' ? 'ticket_audit_log' : 'inventory_audit_log';
  const { data, error } = await SELAccess.db().from(table).select('*').order('changed_at', { ascending: false }).limit(1000);
  if (error) return notify(error.message, 'error');
  audits = data || []; await renderAudit();
}

async function renderAudit() {
  const s = norm(q('auditSearch').value);
  const type = q('auditType').value;
  const rows = audits.filter(a => !s || norm(`${a.product_name || a.ticket_name || ''} ${a.action || ''}`).includes(s));
  const map = await profileMap(rows.map(x => x.changed_by));
  q('auditRows').innerHTML = rows.length ? rows.map(a => {
    const name = type === 'tickets' ? a.ticket_name : a.product_name;
    return `<tr><td>${new Date(a.changed_at).toLocaleString('en-NG')}</td><td><strong>${esc(name || 'Deleted item')}</strong></td><td><span class="badge">${esc(a.action)}</span></td><td>${a.old_data?.quantity ?? '—'}</td><td>${a.new_data?.quantity ?? '—'}</td><td>${esc(map[a.changed_by] || 'System')}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No audit entries found.</td></tr>';
}

// -----------------------------------------------------------------------------
// Users + permissions
// -----------------------------------------------------------------------------
async function loadUserData() {
  const [p, u, r] = await Promise.all([
    SELAccess.db().from('profiles').select('id,full_name,email,role').order('full_name'),
    SELAccess.db().from('user_permissions').select('*'),
    SELAccess.db().from('role_permissions').select('*')
  ]);
  if (p.error) return notify(p.error.message, 'error');
  users = p.data || []; userOverrides = u.data || []; rolePermissions = r.data || []; renderUsers();
}

function effectivePermissions(user) {
  if (norm(user.role) === 'admin') return Object.keys(SELAccess.labels);
  const base = rolePermissions.filter(r => r.role === user.role).map(r => r.permission_key);
  const over = userOverrides.filter(o => o.user_id === user.id);
  const set = new Set(base); over.forEach(o => o.granted ? set.add(o.permission_key) : set.delete(o.permission_key)); return [...set];
}

function renderUsers() {
  q('userRows').innerHTML = users.length ? users.map(u => {
    const perms = effectivePermissions(u);
    return `<tr><td><strong>${esc(u.full_name || '—')}</strong></td><td>${esc(u.email || '—')}</td><td><span class="badge ${norm(u.role) === 'admin' ? 'blue' : ''}">${esc(u.role || '—')}</span></td><td>${perms.length} permissions</td><td><button class="btn btn-secondary btn-small" onclick="openAccessEditor('${u.id}')"><i class="fa-solid fa-key"></i> Manage Access</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="empty">No user profiles found.</td></tr>';
}

function permissionGrid(selected = [], disableAll = false) {
  return Object.entries(SELAccess.labels).filter(([key]) => key !== 'admin_dashboard').map(([key, label]) => `
    <label class="permission-check"><input type="checkbox" value="${key}" ${selected.includes(key) ? 'checked' : ''} ${disableAll ? 'disabled' : ''}><span><strong>${esc(label)}</strong><small>${esc(key)}</small></span></label>`).join('');
}

function checkedPermissions(container) { return [...container.querySelectorAll('input[type=checkbox]:checked')].map(x => x.value); }

function roleDefaultPermissions(role) { return rolePermissions.filter(r => r.role === role).map(r => r.permission_key); }

function openCreateUser() {
  openDrawer('Create User', 'Create a Supabase login and assign operational access.', `
    <div class="alert alert-info">This uses the deployed <strong>admin-create-user</strong> Edge Function. Service-role credentials remain server-side.</div>
    <form id="createUserForm" class="drawer-form"><div class="field"><label>Full Name</label><input id="newUserName" required></div><div class="field"><label>Email</label><input id="newUserEmail" type="email" required></div><div class="form-grid"><div class="field"><label>Temporary Password</label><input id="newUserPassword" type="password" minlength="8" required></div><div class="field"><label>Role</label><select id="newUserRole"><option value="sale_associate">Sale Associate</option><option value="manager">Manager</option><option value="admin">Admin</option></select></div></div><label class="section-label">Assigned Access</label><div class="permission-grid" id="createPermissionGrid">${permissionGrid(roleDefaultPermissions('sale_associate'))}</div><div class="drawer-actions"><button class="btn btn-primary" type="submit"><i class="fa-solid fa-user-plus"></i> Create User</button><button class="btn btn-secondary" type="button" id="cancelUser">Cancel</button></div></form>`);
  q('newUserRole').onchange = e => {
    const role = e.target.value;
    q('createPermissionGrid').innerHTML = permissionGrid(role === 'admin' ? Object.keys(SELAccess.labels) : roleDefaultPermissions(role), role === 'admin');
  };
  q('createUserForm').onsubmit = createUser; q('cancelUser').onclick = closeDrawer;
}

async function createUser(e) {
  e.preventDefault(); const btn = e.submitter; btn.disabled = true;
  const permissions = checkedPermissions(q('createPermissionGrid'));
  try {
    const { data, error } = await SELAccess.db().functions.invoke('admin-create-user', { body: { full_name: q('newUserName').value.trim(), email: q('newUserEmail').value.trim(), password: q('newUserPassword').value, role: q('newUserRole').value, permissions } });
    if (error) throw error; if (data?.error) throw new Error(data.error);
    closeDrawer(); notify('User created and access assigned.'); await loadUserData();
  } catch (err) { notify('Could not create user: ' + err.message, 'error'); }
  finally { btn.disabled = false; }
}

function openAccessEditor(id) {
  const u = users.find(x => x.id === id); if (!u) return;
  const isAdmin = norm(u.role) === 'admin';
  openDrawer('Manage Access', `${u.full_name || u.email} · ${u.role}`, `
    ${isAdmin ? '<div class="alert alert-info">Administrators always retain every permission, including access to this dashboard.</div>' : ''}
    <div class="permission-grid" id="editPermissionGrid">${permissionGrid(effectivePermissions(u), isAdmin)}</div>
    <div class="drawer-actions"><button class="btn btn-primary" id="saveAccess" ${isAdmin ? 'disabled' : ''}>Save Access</button><button class="btn btn-secondary" id="cancelAccess">Cancel</button></div>`);
  q('cancelAccess').onclick = closeDrawer;
  q('saveAccess').onclick = async () => {
    const selected = new Set(checkedPermissions(q('editPermissionGrid')));
    const keys = Object.keys(SELAccess.labels).filter(k => k !== 'admin_dashboard');
    const rows = keys.map(k => ({ user_id: id, permission_key: k, granted: selected.has(k) }));
    const { error } = await SELAccess.db().from('user_permissions').upsert(rows, { onConflict: 'user_id,permission_key' });
    if (error) return notify(error.message, 'error');
    closeDrawer(); notify('User access updated.'); await loadUserData();
  };
}

// -----------------------------------------------------------------------------
// Event wiring
// -----------------------------------------------------------------------------
function bindEvents() {
  document.querySelectorAll('.side-link[data-panel]').forEach(b => b.onclick = () => showPanel(b.dataset.panel));
  document.querySelectorAll('[data-jump]').forEach(b => b.onclick = () => showPanel(b.dataset.jump));
  q('mobileMenu').onclick = () => q('adminSidebar').classList.toggle('open');
  q('drawerClose').onclick = closeDrawer; q('drawerBackdrop').onclick = closeDrawer;

  q('dashboardRange').onchange = loadDashboard; q('refreshDashboard').onclick = loadDashboard;
  q('newSale').onclick = () => openSaleEditor(); q('reloadSales').onclick = loadSales; q('salesSearch').oninput = renderSales; q('salesTypeFilter').onchange = renderSales;
  q('newGateEntry').onclick = () => openGateEditor(); q('reloadGateAdmin').onclick = loadGateAdmin; q('gateAdminSearch').oninput = renderGateAdmin; q('gatePaymentFilter').onchange = renderGateAdmin; q('gateAdminRange').onchange = () => { document.querySelectorAll('.gate-admin-custom').forEach(x => x.classList.toggle('hidden', q('gateAdminRange').value !== 'custom')); if (q('gateAdminRange').value !== 'custom') loadGateAdmin(); }; q('gateAdminStart').onchange = () => { if (q('gateAdminRange').value === 'custom' && q('gateAdminStart').value && q('gateAdminEnd').value) loadGateAdmin(); }; q('gateAdminEnd').onchange = () => { if (q('gateAdminRange').value === 'custom' && q('gateAdminStart').value && q('gateAdminEnd').value) loadGateAdmin(); };
  q('newTicket').onclick = () => openTicketEditor(); q('reloadTickets').onclick = loadTickets; q('ticketSearch').oninput = renderTickets; q('ticketAudienceFilter').onchange = renderTickets;
  q('newExpense').onclick = () => openExpenseEditor(); q('reloadExpenses').onclick = loadExpenses; q('expenseSearch').oninput = renderExpenses; q('expenseCategoryFilter').onchange = renderExpenses; q('expenseSectionFilter').onchange = renderExpenses;
  q('financeRange').onchange = () => document.querySelectorAll('.finance-custom').forEach(x => x.classList.toggle('hidden', q('financeRange').value !== 'custom')); q('financeReportType').onchange = runFinance; q('runFinance').onclick = runFinance;
  q('newProduct').onclick = () => openProductEditor(); q('reloadInventory').onclick = loadInventory; q('inventorySearch').oninput = renderInventory; q('inventoryCategoryFilter').onchange = renderInventory;
  q('auditType').onchange = loadAudit; q('auditSearch').oninput = renderAudit; q('reloadAudit').onclick = loadAudit;
  q('newUser').onclick = openCreateUser;
}

document.addEventListener('DOMContentLoaded', async () => {
  adminCtx = await SELAccess.ensureAuth('admin_dashboard');
  if (!adminCtx) return;
  bindEvents();
  await Promise.all([loadSales(false), loadTickets(false), loadInventory(false)]);
  await loadDashboard();
});

window.openGateEditor = openGateEditor;
window.deleteGateEntry = deleteGateEntry;
window.openSaleEditor = openSaleEditor;
window.deleteSale = deleteSale;
window.changeSaleDraftQty = changeSaleDraftQty;
window.removeSaleDraft = removeSaleDraft;
window.openTicketEditor = openTicketEditor;
window.deleteTicket = deleteTicket;
window.openExpenseEditor = openExpenseEditor;
window.deleteExpense = deleteExpense;
window.openProductEditor = openProductEditor;
window.deleteProduct = deleteProduct;
window.openAccessEditor = openAccessEditor;
