/* SEL Center: staff Sales Management, matching the Admin Sales register layout.
 * Permissions are independently enforced by Supabase RLS/RPC, not by hidden buttons.
 */
(() => {
  'use strict';
  const q = (id) => document.getElementById(id);
  const db = () => SELAccess.db();
  const esc = (v) => SELAccess.esc(v);
  const money = (v) => SELAccess.money(v);
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const rights = new Set();
  const PAGE_FETCH = 1000;
  let sales = [];
  let sellerNames = {};
  let page = 1;
  let request = 0;
  let loading = false;
  let fullyLoaded = false;
  let catalogs = { kitchen: [], ticket: [] };
  let draft = [];
  let editing = null;

  const can = (permission) => rights.has(permission);
  const saleTime = (sale) => sale.sale_date || sale.created_at;
  const formatDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('en-NG');
  };
  function dateInput(value = new Date()) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const localDate = (d) => dateInput(d).slice(0, 10);
  function status(message, error = false) {
    const el = q('salesStatus');
    el.textContent = message || '';
    el.className = `sales-status ${error ? 'error' : message ? 'ok' : ''}`;
  }
  function fail(error) { status(error?.message || 'Sales operation failed.', true); }

  function dateBounds() {
    const range = q('salesDateRange').value;
    if (range === 'all') return null;
    const now = new Date();
    let start, end;
    if (range === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    } else if (range === 'week') {
      const mondayOffset = (now.getDay() + 6) % 7;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else {
      const from = q('salesStartDate').value;
      const to = q('salesEndDate').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
        throw new Error('Select a start date and an end date.');
      start = new Date(`${from}T00:00:00`);
      end = new Date(`${to}T00:00:00`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start)
        throw new Error('Select a valid date range (end must be on or after start).');
      end.setDate(end.getDate() + 1);
    }
    return { start: start.toISOString(), end: end.toISOString() };
  }
  function periodLabel() {
    const range = q('salesDateRange').value;
    if (range === 'all') return 'All recorded sales';
    if (range === 'today') return `Today (${localDate(new Date())})`;
    if (range === 'week') return 'This week';
    if (range === 'month') return 'This month';
    return `${q('salesStartDate').value} to ${q('salesEndDate').value}`;
  }
  function query(columns = 'id,sale_reference,payment_mode,total_amount,sold_by,sale_type,sale_date,created_at,sale_items(product_id,item_name,quantity,unit_price)') {
    return db().from('sales').select(columns);
  }
  async function fetchPages(build) {
    let offset = 0;
    const result = [];
    while (true) {
      const { data, error } = await build().range(offset, offset + PAGE_FETCH - 1);
      if (error) throw error;
      const rows = data || [];
      result.push(...rows);
      if (rows.length < PAGE_FETCH) break;
      offset += PAGE_FETCH;
    }
    return result;
  }
  async function loadSellerNames(rows) {
    const ids = [...new Set(rows.map(s => s.sold_by).filter(Boolean))];
    const names = {};
    // Query only display names. A staff user's existing profiles RLS may limit
    // visible sellers; if so keep a neutral label instead of broadening access.
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await db().from('profiles')
        .select('id,full_name').in('id', ids.slice(i, i + 100));
      if (error) break;
      for (const user of data || []) names[user.id] = user.full_name || 'Staff';
    }
    return names;
  }
  function setLoading(busy) {
    loading = busy;
    q('reloadSales').disabled = busy;
    q('exportSalesExcel').disabled = busy || !fullyLoaded;
    q('exportSalesPDF').disabled = busy || !fullyLoaded;
  }
  async function loadSales() {
    if (!can('sales.read')) return;
    let bounds;
    try { bounds = dateBounds(); } catch (error) { return fail(error); }
    const mine = ++request;
    fullyLoaded = false;
    sales = [];
    sellerNames = {};
    page = 1;
    renderSales();
    q('salesLoadedCount').textContent = 'Loading complete sales register…';
    status('Loading sales…');
    setLoading(true);
    try {
      let rows;
      if (!bounds) {
        rows = await fetchPages(() => query()
          .order('sale_date', { ascending: false, nullsFirst: false })
          .order('id', { ascending: false }));
      } else {
        const [dated, undated] = await Promise.all([
          fetchPages(() => query().gte('sale_date', bounds.start)
            .lt('sale_date', bounds.end)
            .order('sale_date', { ascending: false }).order('id', { ascending: false })),
          fetchPages(() => query().is('sale_date', null)
            .gte('created_at', bounds.start).lt('created_at', bounds.end)
            .order('created_at', { ascending: false }).order('id', { ascending: false }))
        ]);
        rows = dated.concat(undated);
      }
      rows.sort((a, b) => new Date(saleTime(b)).getTime() - new Date(saleTime(a)).getTime() || Number(b.id) - Number(a.id));
      if (mine !== request) return;
      sales = rows;
      // Do not allow missing profile-read permission to block the Sales report.
      try { sellerNames = await loadSellerNames(rows); } catch (_) { sellerNames = {}; }
      if (mine !== request) return;
      fullyLoaded = true;
      renderSales();
      status('');
    } catch (error) {
      if (mine === request) {
        fullyLoaded = false;
        sales = [];
        renderSales();
        fail(error);
      }
    } finally {
      if (mine === request) setLoading(false);
    }
  }
  function filteredSales() {
    const term = norm(q('salesSearch').value);
    const type = q('salesTypeFilter').value;
    const payment = q('salesPaymentFilter').value;
    return sales.filter(s => {
      const items = (s.sale_items || []).map(i => i.item_name).join(' ');
      const seller = sellerNames[s.sold_by] || 'User';
      const haystack = norm(`${s.sale_reference} ${s.payment_mode} ${s.sale_type} ${seller} ${items}`);
      return (type === 'all' || s.sale_type === type)
        && (payment === 'all' || norm(s.payment_mode) === payment || (payment === 'card' && norm(s.payment_mode) === 'pos'))
        && (!term || haystack.includes(term));
    });
  }
  function totals(rows) {
    const result = { total: 0, cash: 0, card: 0, transfer: 0, count: rows.length, average: 0 };
    for (const s of rows) {
      const amount = Number(s.total_amount) || 0;
      result.total += amount;
      const type = norm(s.payment_mode);
      if (type === 'cash') result.cash += amount;
      else if (type === 'card' || type === 'pos') result.card += amount;
      else if (type === 'transfer' || type === 'bank transfer') result.transfer += amount;
    }
    result.average = rows.length ? result.total / rows.length : 0;
    return result;
  }
  function pagination(total) {
    const size = q('salesPageSize').value === 'all' ? Infinity : Number(q('salesPageSize').value) || 50;
    const count = Number.isFinite(size) ? Math.max(1, Math.ceil(total / size)) : 1;
    page = Math.min(page, count);
    const start = total ? (page - 1) * size + 1 : 0;
    const end = Math.min(total, page * size);
    q('salesPaginationInfo').textContent = total
      ? `Showing ${start.toLocaleString('en-NG')}–${end.toLocaleString('en-NG')} of ${total.toLocaleString('en-NG')} matching sales`
      : 'Showing 0 sales';
    q('salesPageNumber').textContent = `Page ${page} of ${count}`;
    q('salesPrevBtn').disabled = page <= 1;
    q('salesNextBtn').disabled = page >= count;
    return size;
  }
  function renderSales() {
    if (!can('sales.read')) return;
    const rows = filteredSales();
    const sums = totals(rows);
    const size = pagination(rows.length);
    q('salesTotalValue').textContent = money(sums.total);
    q('salesCashValue').textContent = money(sums.cash);
    q('salesCardValue').textContent = money(sums.card);
    q('salesTransferValue').textContent = money(sums.transfer);
    q('salesTotalCount').textContent = rows.length.toLocaleString('en-NG');
    q('salesAverageValue').textContent = money(sums.average);
    q('salesLoadedCount').textContent = `${sales.length.toLocaleString('en-NG')} sales loaded · ${periodLabel()}`;
    const visible = Number.isFinite(size) ? rows.slice((page - 1) * size, page * size) : rows;
    q('salesRows').innerHTML = visible.length ? visible.map(s => {
      const items = (s.sale_items || []).map(i => `${i.item_name} × ${i.quantity}`).join(', ') || '—';
      const editable = can('sales.update') && ['kitchen', 'ticket'].includes(s.sale_type);
      const deletable = can('sales.delete') && ['kitchen', 'ticket'].includes(s.sale_type);
      const actions = [
        editable ? `<button class="action-btn edit-sale" type="button" data-id="${esc(s.id)}" title="Edit" aria-label="Edit sale"><i class="fa-solid fa-pen"></i></button>` : '',
        deletable ? `<button class="action-btn danger delete-sale" type="button" data-id="${esc(s.id)}" title="Delete" aria-label="Delete sale"><i class="fa-solid fa-trash"></i></button>` : ''
      ].join('');
      return `<tr><td><strong>${esc(s.sale_reference)}</strong></td><td>${esc(formatDate(saleTime(s)))}</td>
        <td><span class="badge ${s.sale_type === 'kitchen' ? 'blue' : 'green'}">${esc(s.sale_type)}</span></td>
        <td class="item-summary" title="${esc(items)}">${esc(items)}</td><td>${esc(s.payment_mode)}</td>
        <td><strong>${money(s.total_amount)}</strong></td><td>${esc(sellerNames[s.sold_by] || 'User')}</td>
        <td><div class="row-actions">${actions}</div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty">No sales match the current report filters.</td></tr>';
  }
  function filteredChanged() { page = 1; renderSales(); }
  function fileStem() {
    return `sel-center-sales-${q('salesDateRange').value}-${localDate(new Date())}`;
  }
  async function exportExcel() {
    if (!can('sales.read') || !fullyLoaded || loading) return;
    if (!window.ExcelJS) return status('Excel export library unavailable; try again online.', true);
    const rows = filteredSales();
    if (!rows.length) return status('No matching sales to export.', true);
    q('exportSalesExcel').disabled = true;
    try {
      const book = new ExcelJS.Workbook();
      book.creator = 'SEL Center';
      book.created = new Date();
      const sheet = book.addWorksheet('Sales Register');
      sheet.addRow(['SEL CENTER · SALES MANAGEMENT REPORT']);
      sheet.addRow(['Period', periodLabel()]);
      sheet.addRow(['Search', q('salesSearch').value || 'None']);
      sheet.addRow(['Sale type', q('salesTypeFilter').value, 'Payment', q('salesPaymentFilter').value]);
      const s = totals(rows);
      sheet.addRow(['Total Sales', s.total, 'Cash', s.cash, 'Card / POS', s.card, 'Transfer', s.transfer]);
      sheet.addRow(['Transactions', s.count, 'Average Sale', s.average]);
      sheet.addRow([]);
      sheet.addRow(['Reference', 'Date', 'Type', 'Items', 'Payment', 'Total (NGN)', 'Sold By']);
      for (const r of rows) sheet.addRow([
        r.sale_reference || '', formatDate(saleTime(r)), r.sale_type || '',
        (r.sale_items || []).map(i => `${i.item_name} × ${i.quantity}`).join(', '),
        r.payment_mode || '', Number(r.total_amount || 0), sellerNames[r.sold_by] || 'User'
      ]);
      sheet.getColumn(1).width = 34; sheet.getColumn(2).width = 27;
      sheet.getColumn(3).width = 18; sheet.getColumn(4).width = 48;
      sheet.getColumn(5).width = 18; sheet.getColumn(6).width = 22;
      sheet.getColumn(7).width = 25;
      sheet.getRow(8).font = { bold: true };
      sheet.getColumn(6).numFmt = '#,##0.00';
      const buffer = await book.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${fileStem()}.xlsx`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(`Exported ${rows.length} sales to Excel.`);
    } catch (error) { fail(error); }
    finally { q('exportSalesExcel').disabled = loading || !fullyLoaded; }
  }
  function exportPDF() {
    if (!can('sales.read') || !fullyLoaded || loading) return;
    if (!window.jspdf?.jsPDF) return status('PDF export library unavailable; try again online.', true);
    const rows = filteredSales();
    if (!rows.length) return status('No matching sales to export.', true);
    try {
      const pdf = new window.jspdf.jsPDF({ orientation: 'landscape' });
      if (typeof pdf.autoTable !== 'function') throw new Error('PDF table library unavailable; try again online.');
      const s = totals(rows);
      pdf.setFontSize(17); pdf.text('SEL CENTER - SALES MANAGEMENT REPORT', 14, 17);
      pdf.setFontSize(10);
      pdf.text(`Period: ${periodLabel()}`, 14, 26);
      pdf.text(`Type: ${q('salesTypeFilter').value}  |  Payment: ${q('salesPaymentFilter').value}  |  Search: ${q('salesSearch').value || 'None'}`, 14, 33);
      pdf.text(`Sales: ${s.count}  |  Total: NGN ${s.total.toLocaleString('en-NG', { minimumFractionDigits: 2 })}  |  Average: NGN ${s.average.toFixed(2)}`, 14, 40);
      pdf.text(`Cash: NGN ${s.cash.toFixed(2)}   Card/POS: NGN ${s.card.toFixed(2)}   Transfer: NGN ${s.transfer.toFixed(2)}`, 14, 47);
      pdf.autoTable({
        startY: 53, styles: { fontSize: 8, cellPadding: 2 }, headStyles: { fillColor: [30, 41, 59] },
        head: [['Reference', 'Date', 'Type', 'Items', 'Payment', 'NGN Total', 'Sold By']],
        body: rows.map(sale => [sale.sale_reference || '', formatDate(saleTime(sale)), sale.sale_type || '',
          (sale.sale_items || []).map(i => `${i.item_name} x ${i.quantity}`).join(', '), sale.payment_mode || '',
          Number(sale.total_amount || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 }), sellerNames[sale.sold_by] || 'User']),
      });
      pdf.save(`${fileStem()}.pdf`);
      status(`Exported ${rows.length} sales to PDF.`);
    } catch (error) { fail(error); }
  }

  // Mutations use migration 012 SECURITY DEFINER RPCs (inventory is restored and
  // recalculated inside Postgres). Never use direct browser table writes.
  async function loadCatalogs() {
    const { data, error } = await db().rpc('sales_catalog');
    if (error) throw error;
    catalogs = { kitchen: [], ticket: [] };
    for (const p of data || []) {
      if (!catalogs[p.sale_type]) continue;
      catalogs[p.sale_type].push({
        id: String(p.product_id), name: p.product_name,
        price: Number(p.unit_price), quantity: Number(p.available_stock)
      });
    }
  }
  function products() { return catalogs[q('saleTypeInput').value] || []; }
  function selectProducts() {
    q('saleProductInput').innerHTML = products().map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)} · ${money(p.price)} (${p.quantity} in stock)</option>`).join('');
  }
  function renderDraft() {
    const price = new Map(products().map(p => [p.id, p]));
    q('saleItems').innerHTML = draft.length ? draft.map((item, i) =>
      `<div class="sale-line"><span>${esc(price.get(item.id)?.name || item.name || item.id)} × ${item.quantity}</span><button class="btn btn-secondary remove-sale-item" type="button" data-index="${i}">Remove</button></div>`).join('')
      : '<div class="empty-line">Add at least one item to the sale.</div>';
    const sum = draft.reduce((total, item) => total + (price.get(item.id)?.price || 0) * item.quantity, 0);
    q('saleTotal').textContent = money(sum);
    q('cashReceivedField').hidden = q('salePaymentInput').value !== 'cash';
  }
  async function openSale(id = null) {
    if (!(id === null ? can('sales.create') : can('sales.update') && can('sales.read'))) return;
    status('Loading products…');
    try {
      await loadCatalogs();
      const record = id === null ? null : sales.find(s => String(s.id) === String(id));
      if (id !== null && !record) throw new Error('Sale not in the current report. Reload it and try again.');
      if (record && !['kitchen', 'ticket'].includes(record.sale_type)) throw new Error('Unsupported legacy sale type.');
      editing = id;
      q('saleDialogHeading').textContent = record ? `Edit ${record.sale_reference}` : 'New Sale';
      q('saveSale').textContent = record ? 'Save Changes' : 'Create Sale';
      q('saleTypeInput').value = record?.sale_type || 'kitchen';
      q('salePaymentInput').value = record?.payment_mode || 'cash';
      q('saleDateInput').value = dateInput(record ? saleTime(record) : new Date());
      q('cashReceivedInput').value = '';
      draft = (record?.sale_items || []).map(i => ({ id: String(i.product_id), quantity: Number(i.quantity), name: i.item_name }));
      selectProducts(); renderDraft();
      status('');
      q('saleDialog').showModal();
    } catch (error) { fail(error); }
  }
  function addItem() {
    const id = q('saleProductInput').value;
    const qty = Number(q('saleQtyInput').value);
    if (!id || !Number.isSafeInteger(qty) || qty < 1 || qty > 100000) return status('Enter a valid quantity.', true);
    const p = products().find(p => p.id === id);
    if (!p) return status('Select a product.', true);
    const current = draft.find(i => i.id === id);
    if ((current?.quantity || 0) + qty > 100000) return status('Quantity limit exceeded.', true);
    if (current) current.quantity += qty;
    else draft.push({ id, quantity: qty, name: p.name });
    q('saleQtyInput').value = '1';
    renderDraft();
  }
  async function saveSale(e) {
    e.preventDefault();
    if (!can(editing === null ? 'sales.create' : 'sales.update')) return;
    if (!draft.length) return status('Add at least one item.', true);
    const btn = q('saveSale'); btn.disabled = true;
    try {
      const rawCash = q('cashReceivedInput').value.trim();
      const { error } = await db().rpc('sales_save_sale', {
        p_sale_id: editing,
        p_sale_type: q('saleTypeInput').value,
        p_payment_mode: q('salePaymentInput').value,
        p_items: draft.map(i => ({ id: i.id, quantity: i.quantity })),
        p_sale_date: new Date(q('saleDateInput').value).toISOString(),
        p_cash_received: rawCash === '' ? null : Number(rawCash),
      });
      if (error) throw error;
      const wasEditing = editing !== null;
      q('saleDialog').close();
      editing = null;
      await loadSales();
      status(wasEditing ? 'Sale updated and stock reconciled.' : 'Sale created successfully.');
    } catch (error) { fail(error); }
    finally { btn.disabled = false; }
  }
  async function deleteSale(id) {
    if (!can('sales.delete') || !can('sales.read')) return;
    const record = sales.find(s => String(s.id) === String(id));
    if (!record || !confirm(`Delete ${record.sale_reference}? Item quantities will be returned to stock.`)) return;
    try {
      const { error } = await db().rpc('sales_delete_sale', { p_sale_id: id });
      if (error) throw error;
      await loadSales();
      status('Sale deleted and stock restored.');
    } catch (error) { fail(error); }
  }
  function bindEvents() {
    q('newSale').onclick = () => openSale();
    q('createSaleNoRead').onclick = () => openSale();
    q('reloadSales').onclick = () => loadSales();
    q('salesSearch').oninput = filteredChanged;
    q('salesTypeFilter').onchange = filteredChanged;
    q('salesPaymentFilter').onchange = filteredChanged;
    q('salesDateRange').onchange = () => {
      const custom = q('salesDateRange').value === 'custom';
      document.querySelectorAll('.sales-custom-range').forEach(e => e.classList.toggle('hidden', !custom));
      if (custom) {
        const today = new Date();
        if (!q('salesStartDate').value) q('salesStartDate').value = localDate(new Date(today.getFullYear(), today.getMonth(), 1));
        if (!q('salesEndDate').value) q('salesEndDate').value = localDate(today);
      } else { loadSales(); }
    };
    q('applySalesRange').onclick = () => loadSales();
    q('salesPageSize').onchange = filteredChanged;
    q('salesPrevBtn').onclick = () => { if (page > 1) { page--; renderSales(); } };
    q('salesNextBtn').onclick = () => {
      const size = q('salesPageSize').value;
      if (size !== 'all' && page * Number(size) < filteredSales().length) { page++; renderSales(); }
    };
    q('exportSalesExcel').onclick = exportExcel;
    q('exportSalesPDF').onclick = exportPDF;
    q('saleTypeInput').onchange = () => {
      if (draft.length && !confirm('Changing the sale type clears selected items. Continue?')) {
        q('saleTypeInput').value = q('saleTypeInput').value === 'kitchen' ? 'ticket' : 'kitchen';
        return;
      }
      draft = []; selectProducts(); renderDraft();
    };
    q('salePaymentInput').onchange = renderDraft;
    q('addSaleItem').onclick = addItem;
    q('saleItems').onclick = event => {
      const btn = event.target.closest('.remove-sale-item');
      if (btn) { draft.splice(Number(btn.dataset.index), 1); renderDraft(); }
    };
    q('saleForm').onsubmit = saveSale;
    q('cancelSale').onclick = () => q('saleDialog').close();
    q('cancelDialogX').onclick = () => q('saleDialog').close();
    q('salesRows').onclick = event => {
      const edit = event.target.closest('.edit-sale');
      const del = event.target.closest('.delete-sale');
      if (edit) openSale(edit.dataset.id);
      else if (del) deleteSale(del.dataset.id);
    };
  }
  async function start() {
    const ctx = await SELAccess.ensureAuth('sales.dashboard.view');
    if (!ctx) return;
    ctx.permissions.forEach(permission => rights.add(permission));
    q('salesMain').hidden = false;
    const readable = can('sales.read');
    q('salesReadable').hidden = !readable;
    q('salesNoRead').hidden = readable;
    q('newSale').hidden = !can('sales.create');
    q('createSaleNoRead').hidden = readable || !can('sales.create');
    bindEvents();
    setLoading(false);
    if (readable) await loadSales();
  }
  document.addEventListener('DOMContentLoaded', () => start().catch(fail));
})();
