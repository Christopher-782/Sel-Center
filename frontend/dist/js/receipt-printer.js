(function () {
  const LOGO = 'https://res.cloudinary.com/deoqw88yb/image/upload/v1782220892/1sel_yar5yk.avif';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function waitForImages(doc) {
    const images = Array.from(doc.images || []);
    if (!images.length) return Promise.resolve();
    return Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 1200);
      });
    }));
  }

  async function printElement(elementOrId, options = {}) {
    const source = typeof elementOrId === 'string' ? document.getElementById(elementOrId) : elementOrId;
    if (!source || !source.innerHTML.trim()) {
      throw new Error('There is no receipt available to print yet.');
    }

    const title = options.title || 'SEL Center Receipt';
    const subtitle = options.subtitle || '';
    const cashier = options.cashier || localStorage.getItem('userName') || '';
    const paper = options.paper || '80mm';
    const width = paper === '58mm' ? '58mm' : '80mm';

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: ${width} auto; margin: 3mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { width: ${width}; max-width: ${width}; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.35; }
  .print-sheet { width: 100%; padding: 2mm 1mm 4mm; }
  .print-brand { text-align: center; margin-bottom: 8px; }
  .print-logo { display: block; width: 48px; height: 48px; object-fit: contain; margin: 0 auto 5px; }
  .print-brand strong { display: block; font-size: 15px; letter-spacing: .02em; }
  .print-brand small { display: block; font-size: 10px; margin-top: 2px; }
  .print-divider { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  .receipt { display: block !important; border: 0 !important; margin: 0 !important; padding: 0 !important; background: #fff !important; font-size: 11px !important; }
  .receipt h4 { display: none !important; }
  .receipt-line { display: flex !important; justify-content: space-between; align-items: flex-start; gap: 8px; margin: 5px 0; }
  .receipt-line span { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .receipt-line strong { flex: 0 0 auto; max-width: 52%; text-align: right; overflow-wrap: anywhere; }
  .receipt hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  .print-meta { margin-top: 8px; font-size: 10px; }
  .print-meta-row { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
  .print-footer { text-align: center; margin-top: 10px; padding-top: 8px; border-top: 1px dashed #000; font-size: 10px; }
  @media print {
    html, body { width: ${width}; }
    .print-sheet { break-inside: avoid; }
  }
</style>
</head>
<body>
  <main class="print-sheet">
    <div class="print-brand">
      <img class="print-logo" src="${LOGO}" alt="SEL Center">
      <strong>SEL Center</strong>
      ${subtitle ? `<small>${esc(subtitle)}</small>` : ''}
    </div>
    <hr class="print-divider">
    ${source.outerHTML}
    ${cashier ? `<div class="print-meta"><div class="print-meta-row"><span>Served by</span><strong>${esc(cashier)}</strong></div></div>` : ''}
    <div class="print-footer">Thank you for visiting SEL Center</div>
  </main>
</body>
</html>`);
    doc.close();

    try {
      await waitForImages(doc);
      await new Promise(resolve => setTimeout(resolve, 120));
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } finally {
      const cleanup = () => iframe.remove();
      if (iframe.contentWindow) iframe.contentWindow.addEventListener('afterprint', cleanup, { once: true });
      setTimeout(cleanup, 5000);
    }
  }

  window.SELReceiptPrinter = { printElement };
})();
