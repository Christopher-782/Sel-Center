(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const currentFile = (location.pathname.split('/').pop() || 'login.html').toLowerCase();
  const isLogin = currentFile.includes('login');
  let lastRefreshAt = Date.now();

  function visible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && !el.classList.contains('hidden');
  }

  function injectProgress() {
    if ($('.ui-page-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'ui-page-progress';
    document.body.appendChild(bar);
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
      bar.classList.remove('done');
      requestAnimationFrame(() => bar.classList.add('active'));
    });
    window.addEventListener('pageshow', () => {
      bar.classList.remove('active');
      bar.classList.add('done');
      setTimeout(() => bar.classList.remove('done'), 350);
    });
  }

  function setActiveNavigation() {
    $$('a.side-link[href]').forEach(a => {
      const href = (a.getAttribute('href') || '').split('?')[0].split('#')[0].toLowerCase();
      if (!href) return;
      const file = href.split('/').pop();
      if (file === currentFile) a.classList.add('active');
      else if (!a.classList.contains('admin-link')) a.classList.remove('active');
    });
  }

  function sidebarEnhancements() {
    const sidebar = $('.admin-sidebar, .portal-sidebar');
    if (!sidebar) return;

    const isDesktop = () => window.matchMedia('(min-width: 821px)').matches;
    if (isDesktop() && localStorage.getItem('selSidebarCollapsed') === '1') {
      document.body.classList.add('ui-sidebar-collapsed');
    }

    if (!$('.ui-sidebar-collapse', sidebar)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-sidebar-collapse';
      btn.title = 'Collapse sidebar';
      btn.setAttribute('aria-label', 'Collapse sidebar');
      btn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
      btn.onclick = () => {
        document.body.classList.toggle('ui-sidebar-collapsed');
        const collapsed = document.body.classList.contains('ui-sidebar-collapsed');
        localStorage.setItem('selSidebarCollapsed', collapsed ? '1' : '0');
        btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
        btn.setAttribute('aria-label', btn.title);
      };
      sidebar.appendChild(btn);
    }

    let backdrop = $('.ui-sidebar-backdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'ui-sidebar-backdrop';
      document.body.appendChild(backdrop);
    }

    const syncBackdrop = () => backdrop.classList.toggle('open', !isDesktop() && sidebar.classList.contains('open'));
    const closeMobile = () => { sidebar.classList.remove('open'); syncBackdrop(); };
    backdrop.onclick = closeMobile;

    const menuButtons = $$('.mobile-menu');
    menuButtons.forEach(btn => btn.addEventListener('click', () => setTimeout(syncBackdrop, 0)));
    sidebar.addEventListener('click', e => {
      if (!isDesktop() && e.target.closest('a.side-link')) closeMobile();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobile(); });
    window.addEventListener('resize', syncBackdrop);
  }

  function getHeaderTarget() {
    return $('.topbar-actions') || $('.header-actions') || $('.pos-header-right') || $('.portal-topbar') || $('.admin-topbar') || $('.app-header');
  }

  function liveHeader() {
    if (isLogin || $('.ui-live-meta')) return;
    const target = getHeaderTarget();
    if (!target) return;
    const el = document.createElement('div');
    el.className = 'ui-live-meta';
    el.setAttribute('role', 'status');
    el.innerHTML = '<i class="fa-regular fa-clock"></i><span class="ui-live-date"></span><span class="ui-live-time"></span>';
    target.appendChild(el);
    const render = () => {
      const now = new Date();
      $('.ui-live-date', el).textContent = now.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
      $('.ui-live-time', el).textContent = now.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
    };
    render();
    setInterval(render, 30000);
  }

  function commandItems() {
    const seen = new Set();
    const items = [];
    $$('.side-link').forEach(el => {
      if (!visible(el)) return;
      const label = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label || /logout/i.test(label)) return;
      const key = `${el.tagName}:${label}:${el.getAttribute('href') || el.dataset.panel || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const iconClass = $('i', el)?.className || 'fa-regular fa-circle';
      items.push({ label, el, iconClass, hint: el.tagName === 'A' ? 'Open page' : 'Open section' });
    });
    return items;
  }

  function commandPalette() {
    if (isLogin) return;
    const items = commandItems();
    if (!items.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'ui-command-overlay hidden';
    overlay.innerHTML = `
      <section class="ui-command" role="dialog" aria-modal="true" aria-label="Quick navigation">
        <div class="ui-command-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="Search pages and sections…" autocomplete="off" aria-label="Search navigation"></div>
        <div class="ui-command-list"></div>
        <div class="ui-command-footer"><span>↑↓ navigate · Enter open</span><span>Esc close</span></div>
      </section>`;
    document.body.appendChild(overlay);
    const input = $('input', overlay), list = $('.ui-command-list', overlay);
    let filtered = items, active = 0;

    function render() {
      const term = input.value.trim().toLowerCase();
      filtered = items.filter(x => x.label.toLowerCase().includes(term));
      active = Math.min(active, Math.max(0, filtered.length - 1));
      list.innerHTML = filtered.length ? filtered.map((x, i) => `
        <button type="button" class="ui-command-item ${i === active ? 'active' : ''}" data-command-index="${i}">
          <i class="${x.iconClass}"></i><span><strong>${escapeHtml(x.label)}</strong><small>${x.hint}</small></span>
        </button>`).join('') : '<div class="ui-command-empty">No matching page or section.</div>';
      $$('[data-command-index]', list).forEach(btn => btn.onclick = () => activate(Number(btn.dataset.commandIndex)));
      $('.ui-command-item.active', list)?.scrollIntoView({ block: 'nearest' });
    }

    function activate(index) {
      const item = filtered[index];
      if (!item) return;
      close();
      item.el.click();
    }

    function open() {
      overlay.classList.remove('hidden');
      input.value = '';
      active = 0;
      render();
      setTimeout(() => input.focus(), 20);
    }
    function close() { overlay.classList.add('hidden'); }

    input.addEventListener('input', () => { active = 0; render(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
      if (e.key === 'Enter') { e.preventDefault(); activate(active); }
      if (e.key === 'Escape') close();
    });
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

    const target = getHeaderTarget();
    if (target && !$('.ui-command-btn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ui-command-btn';
      btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><span>Quick Find</span><kbd>Ctrl K</kbd>';
      btn.title = 'Quick navigation (Ctrl/Cmd + K)';
      btn.onclick = open;
      target.appendChild(btn);
    }

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
        const search = $$('input[type="search"], .search-input').find(visible);
        if (search) { e.preventDefault(); search.focus(); search.select?.(); }
      }
    });
  }

  function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function enhanceIconButtons(root = document) {
    const map = [
      ['fa-pen', 'Edit'], ['fa-trash', 'Delete'], ['fa-xmark', 'Close'], ['fa-print', 'Print'],
      ['fa-rotate', 'Refresh'], ['fa-eye', 'View'], ['fa-plus', 'Add'], ['fa-minus', 'Decrease'],
      ['fa-floppy-disk', 'Save'], ['fa-download', 'Download']
    ];
    $$('button', root).forEach(btn => {
      const text = (btn.textContent || '').trim();
      if (text.length > 2 || btn.getAttribute('aria-label')) return;
      const icon = $('i', btn);
      if (!icon) return;
      const found = map.find(([cls]) => icon.classList.contains(cls));
      if (!found) return;
      btn.title ||= found[1];
      btn.setAttribute('aria-label', found[1]);
    });
  }

  function parseSortableValue(cell) {
    const raw = (cell?.dataset.sortValue || cell?.textContent || '').trim();
    if (!raw) return { type: 'text', value: '' };
    const money = raw.replace(/[₦,$,%\s]/g, '').replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(money)) return { type: 'number', value: Number(money) };
    const date = Date.parse(raw);
    if (/\d/.test(raw) && !Number.isNaN(date)) return { type: 'date', value: date };
    return { type: 'text', value: raw.toLocaleLowerCase() };
  }

  function setupSortableTable(table) {
    if (table.dataset.uiSortable === 'true') return;
    table.dataset.uiSortable = 'true';
    const headers = $$('thead th', table);
    headers.forEach((th, index) => {
      const label = (th.textContent || '').trim();
      if (!label || /^(action|actions|manage)$/i.test(label) || th.hasAttribute('data-no-sort')) return;
      th.classList.add('ui-sortable');
      th.tabIndex = 0;
      th.title = `Sort by ${label}`;
      const sort = () => {
        const tbody = $('tbody', table);
        if (!tbody) return;
        const rows = $$(':scope > tr', tbody).filter(r => !r.querySelector('td[colspan]'));
        if (rows.length < 2) return;
        const dir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
        headers.forEach(h => delete h.dataset.sortDir);
        th.dataset.sortDir = dir;
        rows.sort((a,b) => {
          const av = parseSortableValue(a.children[index]), bv = parseSortableValue(b.children[index]);
          let cmp = 0;
          if (av.type === bv.type && ['number','date'].includes(av.type)) cmp = av.value - bv.value;
          else cmp = String(av.value).localeCompare(String(bv.value), 'en', { numeric: true, sensitivity: 'base' });
          return dir === 'asc' ? cmp : -cmp;
        }).forEach(r => tbody.appendChild(r));
        updateTableMeta(table);
      };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
    updateTableMeta(table);
  }

  function updateTableMeta(table) {
    const wrap = table.closest('.table-wrap') || table.parentElement;
    if (!wrap) return;
    let meta = $('.ui-table-meta', wrap);
    const tbody = $('tbody', table);
    if (!tbody) return;
    const count = $$(':scope > tr', tbody).filter(r => !r.querySelector('td[colspan]') && visible(r)).length;
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'ui-table-meta';
      wrap.appendChild(meta);
    }
    meta.textContent = `${count.toLocaleString('en-NG')} record${count === 1 ? '' : 's'}`;
  }

  function tables() {
    $$('table').forEach(setupSortableTable);
    const observer = new MutationObserver(mutations => {
      let changedTables = new Set();
      mutations.forEach(m => {
        if (!(m.target instanceof Element)) return;
        const table = m.target.closest('table');
        if (table) changedTables.add(table);
        m.addedNodes.forEach(n => {
          if (!(n instanceof Element)) return;
          if (n.matches('table')) setupSortableTable(n);
          $$('table', n).forEach(setupSortableTable);
          enhanceIconButtons(n);
        });
      });
      changedTables.forEach(updateTableMeta);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function toasts() {
    let stack = $('.ui-toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'ui-toast-stack';
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const last = new WeakMap();
    const show = el => {
      if (!visible(el)) return;
      const msg = (el.textContent || '').trim();
      if (!msg || last.get(el) === msg) return;
      last.set(el, msg);
      const type = el.classList.contains('alert-error') || el.classList.contains('error') ? 'error' : el.classList.contains('alert-info') || el.classList.contains('info') ? 'info' : 'success';
      const toast = document.createElement('div');
      toast.className = `ui-toast ${type}`;
      const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check';
      toast.innerHTML = `<i class="fa-solid ${icon}"></i><div><strong>${type === 'error' ? 'Action needed' : type === 'info' ? 'Information' : 'Updated'}</strong><p>${escapeHtml(msg)}</p></div>`;
      stack.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(8px)'; }, 3600);
      setTimeout(() => toast.remove(), 4000);
    };
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        const el = m.target instanceof Element ? m.target.closest('.alert,.alert-msg') : m.target.parentElement?.closest?.('.alert,.alert-msg');
        if (el) setTimeout(() => show(el), 0);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }

  function onlineStatus() {
    if (isLogin || $('.ui-status-pill')) return;
    const target = getHeaderTarget();
    if (!target) return;
    const pill = document.createElement('div');
    pill.className = 'ui-status-pill';
    pill.setAttribute('role','status');
    pill.innerHTML = '<span class="ui-status-dot"></span><span class="ui-status-text">Online</span>';
    const update = () => {
      pill.classList.toggle('is-offline', !navigator.onLine);
      $('.ui-status-text', pill).textContent = navigator.onLine ? 'Online' : 'Offline';
    };
    addEventListener('online', update); addEventListener('offline', update); update();
    target.appendChild(pill);
  }

  function refreshWhenReturning() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - lastRefreshAt;
      if (elapsed < 120000) return;
      const candidates = ['#refreshDashboard','#calculateRecon','#refreshSales','#refreshInventory','#refreshTickets'];
      const button = candidates.map(s => $(s)).find(visible);
      if (button && !button.disabled) {
        lastRefreshAt = Date.now();
        button.click();
      }
    });
    document.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (btn && /refresh|calculate|load/i.test(`${btn.id} ${btn.textContent}`)) lastRefreshAt = Date.now();
    });
  }

  function init() {
    document.body.dataset.dynamicUi = 'true';
    injectProgress();
    setActiveNavigation();
    sidebarEnhancements();
    liveHeader();
    commandPalette();
    enhanceIconButtons();
    tables();
    toasts();
    onlineStatus();
    refreshWhenReturning();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
