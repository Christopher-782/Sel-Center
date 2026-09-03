(function(){
  const mode=document.body.dataset.posMode; const required=mode==='ticket'?'ticket_pos':'kitchen_pos';
  const grid=document.getElementById('productGrid'), cartList=document.getElementById('cartList'), alertEl=document.getElementById('posAlert'), search=document.getElementById('productSearch');
  let ctx=null, products=[], cart=[], currentCat='all', lastSale=null;
  const norm=v=>String(v||'').trim().toLowerCase();
  const cartTotal=()=>cart.reduce((s,c)=>s+c.quantity*c.price,0);

  async function loadProducts(){
    let query;
    if(mode==='kitchen') query=SELAccess.db().from('inventory_items').select('id,name,sku,price,quantity,low_stock_threshold,category,department,is_active').eq('is_active',true).order('name');
    else query=SELAccess.db().from('ticket_packages').select('id,package_name,price,description,quantity,low_stock_threshold,audience,ticket_type,is_active').eq('is_active',true).order('package_name');
    const {data,error}=await query;if(error){SELAccess.alertBox(alertEl,error.message,'error');return}
    products=(data||[]).map(p=>mode==='kitchen'?{id:p.id,name:p.name,price:Number(p.price||0),quantity:Number(p.quantity||0),low:Number(p.low_stock_threshold||0),category:normalizeKitchenCategory(p.category),subtitle:p.sku||''}:{id:p.id,name:p.package_name,price:Number(p.price||0),quantity:Number(p.quantity||0),low:Number(p.low_stock_threshold||0),category:norm(p.audience)||guessAudience(p.package_name),subtitle:p.ticket_type||p.description||''});
    if(mode==='kitchen')products=products.filter(p=>['drinks','meals','desserts'].includes(p.category));
    renderProducts();
  }
  function normalizeKitchenCategory(c){const x=norm(c);if(['drink','drinks','beverage','beverages'].includes(x))return'drinks';if(['food','meal','meals'].includes(x))return'meals';if(['dessert','desserts','desert','deserts'].includes(x))return'desserts';return x}
  function guessAudience(name){return norm(name).includes('kid')?'kids':norm(name).includes('adult')?'adult':''}
  function renderProducts(){const q=norm(search.value);const list=products.filter(p=>(currentCat==='all'||p.category===currentCat)&&(!q||norm(p.name+' '+p.subtitle).includes(q)));grid.innerHTML=list.length?list.map(p=>{const out=p.quantity<=0,low=!out&&p.quantity<=p.low;return`<article class="product-card ${out?'disabled':''}" data-id="${SELAccess.esc(p.id)}"><div class="cat">${SELAccess.esc(p.category)}</div><h4>${SELAccess.esc(p.name)}</h4><div class="muted" style="font-size:11px">${SELAccess.esc(p.subtitle)}</div><div class="price">${SELAccess.money(p.price)}</div><div class="stock ${out?'out':low?'low':''}">${out?'Out of stock':p.quantity.toLocaleString('en-NG')+' available'}</div></article>`}).join(''):'<div class="empty" style="grid-column:1/-1">No products found in this category.</div>';grid.querySelectorAll('[data-id]').forEach(el=>el.addEventListener('click',()=>addToCart(el.dataset.id)))}
  function addToCart(id){const p=products.find(x=>String(x.id)===String(id));if(!p)return;const existing=cart.find(x=>String(x.id)===String(id));const next=(existing?.quantity||0)+1;if(next>p.quantity){SELAccess.alertBox(alertEl,'Only '+p.quantity+' available for '+p.name+'.','error');return}if(existing)existing.quantity=next;else cart.push({...p,quantity:1});renderCart()}
  function changeQty(id,delta){const c=cart.find(x=>String(x.id)===String(id)),p=products.find(x=>String(x.id)===String(id));if(!c||!p)return;const n=c.quantity+delta;if(n<=0)cart=cart.filter(x=>x!==c);else if(n<=p.quantity)c.quantity=n;else SELAccess.alertBox(alertEl,'Not enough stock available.','error');renderCart()}
  function renderCart(){const count=cart.reduce((s,c)=>s+c.quantity,0),total=cartTotal();document.getElementById('itemCount').textContent=count;document.getElementById('cartTotal').textContent=SELAccess.money(total);cartList.innerHTML=cart.length?cart.map(c=>`<div class="cart-row"><div><h5>${SELAccess.esc(c.name)}</h5><small>${SELAccess.money(c.price)} × ${c.quantity}</small></div><div><strong>${SELAccess.money(c.price*c.quantity)}</strong><div class="qty"><button data-minus="${SELAccess.esc(c.id)}">−</button><span>${c.quantity}</span><button data-plus="${SELAccess.esc(c.id)}">+</button></div></div></div>`).join(''):'<div class="cart-empty"><i class="fa-solid fa-cart-shopping" style="font-size:28px;margin-bottom:8px"></i><br>Select items to begin.</div>';cartList.querySelectorAll('[data-minus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.minus,-1));cartList.querySelectorAll('[data-plus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.plus,1))}

  async function submitSale(paymentMode,cashReceived=null){
    if(!cart.length){SELAccess.alertBox(alertEl,'Add at least one item before checkout.','error');return}
    document.querySelectorAll('[data-pay]').forEach(b=>b.disabled=true);SELAccess.clearAlert(alertEl);
    try{
      const items=cart.map(c=>({id:c.id,quantity:c.quantity}));
      const args={p_sale_type:mode,p_payment_mode:paymentMode,p_items:items,p_sale_date:new Date().toISOString(),p_cash_received:paymentMode==='cash'?Number(cashReceived):null};
      const {data,error}=await SELAccess.db().rpc('process_pos_sale_v2',args);if(error)throw error;
      lastSale=typeof data==='string'?JSON.parse(data):data;
      const snapshot=cart.map(x=>({...x}));const total=snapshot.reduce((s,c)=>s+c.price*c.quantity,0);
      renderReceipt(lastSale,snapshot,paymentMode,total);
      SELAccess.alertBox(alertEl,(mode==='ticket'?'Tickets issued':'Kitchen sale recorded')+' successfully.');cart=[];renderCart();await loadProducts();
    }catch(err){SELAccess.alertBox(alertEl,err.message,'error')}finally{document.querySelectorAll('[data-pay]').forEach(b=>b.disabled=false)}
  }

  function ensureCashModal(){
    if(document.getElementById('cashTenderModal')) return;
    const wrap=document.createElement('div');
    wrap.id='cashTenderModal'; wrap.className='payment-modal hidden';
    wrap.innerHTML=`<div class="payment-modal-backdrop" data-cash-close></div><section class="payment-modal-card" role="dialog" aria-modal="true" aria-labelledby="cashTenderTitle"><div class="payment-modal-head"><div><h3 id="cashTenderTitle">Cash Payment</h3><p>Enter the cash received from the customer. Change will be stored for reconciliation.</p></div><button class="drawer-close" type="button" data-cash-close><i class="fa-solid fa-xmark"></i></button></div><div class="payment-modal-body"><div class="tender-total"><span>Sale total</span><strong id="cashSaleTotal">₦0.00</strong></div><div class="field"><label>Cash received (₦)</label><input id="cashReceivedInput" type="number" min="0" step="0.01" inputmode="decimal"></div><div class="change-preview"><span>Change to customer</span><strong id="cashChangePreview">₦0.00</strong></div><div id="cashTenderError" class="field-error hidden"></div><div class="drawer-actions"><button class="btn btn-success" type="button" id="confirmCashPayment"><i class="fa-solid fa-check"></i> Complete Cash Sale</button><button class="btn btn-secondary" type="button" data-cash-close>Cancel</button></div></div></section>`;
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-cash-close]').forEach(x=>x.onclick=closeCashTender);
    document.getElementById('cashReceivedInput').addEventListener('input',updateCashPreview);
    document.getElementById('confirmCashPayment').onclick=confirmCashTender;
  }
  function openCashTender(){
    if(!cart.length){SELAccess.alertBox(alertEl,'Add at least one item before checkout.','error');return}
    ensureCashModal(); const total=cartTotal();
    document.getElementById('cashSaleTotal').textContent=SELAccess.money(total);
    document.getElementById('cashReceivedInput').value=total.toFixed(2);
    document.getElementById('cashTenderError').classList.add('hidden');
    updateCashPreview(); document.getElementById('cashTenderModal').classList.remove('hidden');
    setTimeout(()=>document.getElementById('cashReceivedInput').select(),30);
  }
  function closeCashTender(){document.getElementById('cashTenderModal')?.classList.add('hidden')}
  function updateCashPreview(){
    const total=cartTotal(),received=Number(document.getElementById('cashReceivedInput')?.value||0),change=Math.max(0,received-total);
    const el=document.getElementById('cashChangePreview');if(el)el.textContent=SELAccess.money(change);
  }
  async function confirmCashTender(){
    const total=cartTotal(),received=Number(document.getElementById('cashReceivedInput').value||0),err=document.getElementById('cashTenderError');
    if(received<total){err.textContent=`Cash received is ${SELAccess.money(total-received)} short of the sale total.`;err.classList.remove('hidden');return}
    err.classList.add('hidden');closeCashTender();await submitSale('cash',received);
  }

  function renderReceipt(sale,items,payment,total){
    const el=document.getElementById('lastReceipt'); const received=Number(sale?.cash_received||0),change=Number(sale?.change_given||0);
    el.className='receipt show';el.innerHTML=`<h4>SEL Center - ${mode==='ticket'?'Ticket':'Kitchen'} Receipt</h4><div class="receipt-line"><span>Reference</span><strong>${SELAccess.esc(sale?.sale_reference||sale?.reference||'')}</strong></div><div class="receipt-line"><span>Date</span><strong>${new Date().toLocaleString('en-NG')}</strong></div>${items.map(i=>`<div class="receipt-line"><span>${SELAccess.esc(i.name)} × ${i.quantity}</span><strong>${SELAccess.money(i.price*i.quantity)}</strong></div>`).join('')}<hr><div class="receipt-line"><span>Payment</span><strong>${SELAccess.esc(payment)}</strong></div><div class="receipt-line"><span>Total</span><strong>${SELAccess.money(total)}</strong></div>${payment==='cash'?`<div class="receipt-line"><span>Cash received</span><strong>${SELAccess.money(received)}</strong></div><div class="receipt-line"><span>Change</span><strong>${SELAccess.money(change)}</strong></div>`:''}`;document.getElementById('printLast').disabled=false
  }

  document.getElementById('clearCart').onclick=()=>{cart=[];renderCart()};
  document.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>b.dataset.pay==='cash'?openCashTender():submitSale(b.dataset.pay));
  document.getElementById('printLast').onclick=async()=>{try{await SELReceiptPrinter.printElement('lastReceipt',{title:'SEL Center Receipt',subtitle:mode==='ticket'?'Ticket Receipt':'Kitchen Receipt'});}catch(err){SELAccess.alertBox(alertEl,err.message||'Unable to print receipt.','error')}};search.addEventListener('input',renderProducts);document.getElementById('categoryTabs').querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{currentCat=b.dataset.cat;document.querySelectorAll('[data-cat]').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderProducts()});
  document.addEventListener('DOMContentLoaded',async()=>{ctx=await SELAccess.ensureAuth(required);if(!ctx)return;renderCart();loadProducts()});
})();
