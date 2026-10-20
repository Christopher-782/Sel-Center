const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..', 'frontend');
const html = fs.readFileSync(path.join(root, 'sales-dashboard.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/sales-dashboard.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'operations-admin.html'), 'utf8');
const adminSaleSection = admin.split('<!-- Sales -->')[1].split('<!-- Gate Entry -->')[0];
const ids = [...adminSaleSection.matchAll(/\bid="([a-zA-Z][^\"]*)"/g)].map(x => x[1]);
for (const id of ids) assert.match(html, new RegExp(`\\bid="${id}"`), `Admin Sales ID ${id} exists on staff page`);
assert.match(html, /salesReadable/);
assert.match(html, /salesNoRead/);
assert.match(html, /sales\.read/);
assert.match(script, /rpc\('sales_save_sale'/);
assert.match(script, /rpc\('sales_delete_sale'/);
assert.doesNotMatch(script, /admin_replace_sale|admin_delete_sale|process_pos_sale_v2|unit_cost|cost_price/);

const sample = [
  { id: 1, sale_reference: 'KIT-001', sold_by: 'user1', sale_type: 'kitchen', payment_mode: 'cash', total_amount: 200, sale_date: '2026-10-01T08:00:00Z', sale_items: [{ product_id: 'x', item_name: 'Rice', quantity: 2, unit_price: 100 }] },
  { id: 2, sale_reference: 'TKT-002', sold_by: 'user1', sale_type: 'ticket', payment_mode: 'card', total_amount: 300, sale_date: '2026-10-02T10:00:00Z', sale_items: [{ product_id: 'y', item_name: 'Entrance', quantity: 1, unit_price: 300 }] },
];
async function simulate(permissions) {
  let onload;
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) {
      elements.set(id, { id, value: '', hidden: false, disabled: false, textContent: '', innerHTML: '', className: '', dataset: {},
        classList: { toggle() {} }, showModal() {}, close() {} });
    }
    return elements.get(id);
  };
  el('salesDateRange').value = 'all';
  el('salesTypeFilter').value = 'all';
  el('salesPaymentFilter').value = 'all';
  el('salesPageSize').value = '50';
  let salesReads = 0;
  let rpcReads = 0;
  const db = {
    from(table) {
      if (table === 'sales') {
        salesReads++;
        return { select() { return { order() { return this; }, range() { return Promise.resolve({ data: sample, error: null }); }, gte() { return this; }, lt() { return this; }, is() { return this; } }; } };
      }
      if (table === 'profiles') return { select() { return { in() { return Promise.resolve({ data: [{ id: 'user1', full_name: 'Jane' }], error: null }); } }; } };
      throw new Error(`Unexpected table ${table}`);
    },
    rpc(name) { rpcReads++; throw new Error(`Unexpected RPC ${name}`); },
  };
  const sandbox = {
    document: { getElementById: el, querySelectorAll() { return []; }, addEventListener(type, callback) { if (type === 'DOMContentLoaded') onload = callback; } },
    SELAccess: { ensureAuth: async () => ({ permissions }), db: () => db, esc: v => String(v), money: v => `NGN${Number(v).toFixed(2)}` },
    console, Date, Number, String, Set, Map, Promise, window: {}, confirm: () => false,
  };
  vm.runInNewContext(script, sandbox, { filename: 'sales-dashboard.js' });
  onload();
  await new Promise(resolve => setImmediate(resolve));
  return { el, get salesReads() { return salesReads; }, get rpcReads() { return rpcReads; } };
}
(async () => {
  const readOnly = await simulate(['sales.dashboard.view', 'sales.read']);
  assert.equal(readOnly.el('salesReadable').hidden, false);
  assert.equal(readOnly.el('salesNoRead').hidden, true);
  assert.equal(readOnly.el('newSale').hidden, true);
  assert.equal(readOnly.el('salesTotalValue').textContent, 'NGN500.00');
  assert.equal(readOnly.el('salesCashValue').textContent, 'NGN200.00');
  assert.equal(readOnly.el('salesCardValue').textContent, 'NGN300.00');
  assert.equal(readOnly.el('salesTotalCount').textContent, '2');
  assert.equal(readOnly.el('salesAverageValue').textContent, 'NGN250.00');
  assert.ok(readOnly.salesReads > 0);
  assert.doesNotMatch(readOnly.el('salesRows').innerHTML, /edit-sale|delete-sale/);
  readOnly.el('salesTypeFilter').value = 'kitchen';
  readOnly.el('salesTypeFilter').onchange();
  assert.equal(readOnly.el('salesTotalValue').textContent, 'NGN200.00');
  assert.equal(readOnly.el('salesTotalCount').textContent, '1');

  const createOnly = await simulate(['sales.dashboard.view', 'sales.create']);
  assert.equal(createOnly.el('salesReadable').hidden, true);
  assert.equal(createOnly.el('salesNoRead').hidden, false);
  assert.equal(createOnly.el('createSaleNoRead').hidden, false);
  assert.equal(createOnly.salesReads, 0, 'No Sales records queried without sales.read');

  const editable = await simulate(['sales.dashboard.view', 'sales.read', 'sales.create', 'sales.update', 'sales.delete']);
  assert.equal(editable.el('newSale').hidden, false);
  assert.match(editable.el('salesRows').innerHTML, /edit-sale/);
  assert.match(editable.el('salesRows').innerHTML, /delete-sale/);
  assert.equal(editable.rpcReads, 0, 'Never mutate data on page load');
  console.log('Sales Dashboard visual parity and permission tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
