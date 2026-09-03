let reconCtx=null,reconSummary=null,currentBounds=null;
const q=id=>document.getElementById(id), money=v=>SELAccess.money(v);
const pad=n=>String(n).padStart(2,'0');
function localDateValue(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function parseLocalDate(v){const [y,m,d]=String(v).split('-').map(Number);return new Date(y,m-1,d,0,0,0,0)}
function addDays(d,n){const x=new Date(d);x.setDate(x.getDate()+n);return x}
function periodBounds(){
  const kind=q('reconRange').value;
  if(kind==='daily'){
    const start=parseLocalDate(q('reconDate').value),end=addDays(start,1);
    return{kind,start,end,label:start.toLocaleDateString('en-NG',{day:'numeric',month:'long',year:'numeric'})};
  }
  if(kind==='weekly'){
    const anchor=parseLocalDate(q('reconWeekDate').value),day=(anchor.getDay()+6)%7,start=addDays(anchor,-day),end=addDays(start,7);
    return{kind,start,end,label:`${start.toLocaleDateString('en-NG',{day:'numeric',month:'short'})} – ${addDays(end,-1).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}`};
  }
  const start=parseLocalDate(q('reconStart').value),endInclusive=parseLocalDate(q('reconEnd').value);
  if(endInclusive<start)throw new Error('Custom range end date cannot be before the start date.');
  const end=addDays(endInclusive,1);
  return{kind,start,end,label:`${start.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})} – ${endInclusive.toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'})}`};
}

function selectedSection(){
  const value=q('reconSection')?.value||'all';
  const labels={all:'All Sections',kitchen:'Kitchen',ticket:'Tickets',gate:'Gate Entry'};
  return{value,label:labels[value]||'All Sections'};
}

function notify(msg,type='success'){
  SELAccess.alertBox(q('reconAlert'),msg,type);
  window.scrollTo({top:0,behavior:'smooth'});
  if(type!=='error')setTimeout(()=>SELAccess.clearAlert(q('reconAlert')),4200);
}
function setRangeControls(){
  const kind=q('reconRange').value;
  q('dailyControl').classList.toggle('hidden',kind!=='daily');
  q('weeklyControl').classList.toggle('hidden',kind!=='weekly');
  document.querySelectorAll('.custom-recon').forEach(x=>x.classList.toggle('hidden',kind!=='custom'));
}
function renderSummary(s){
  const expectedCash=Number(s.expected_cash||0),expectedCard=Number(s.expected_card||0),expectedTransfer=Number(s.expected_transfer||0);
  q('reconTransactions').textContent=Number(s.transactions||0).toLocaleString('en-NG');
  q('reconExpectedCash').textContent=q('cashExpectedCard').textContent=q('expectedCashFormula').textContent=money(expectedCash);
  q('reconExpectedCard').textContent=q('cardExpectedCard').textContent=money(expectedCard);
  q('reconExpectedTransfer').textContent=q('transferExpectedCard').textContent=money(expectedTransfer);
  q('grossCash').textContent=q('cashCardGross').textContent=money(s.gross_cash_received);
  q('customerChange').textContent=q('cashCardChange').textContent='− '+money(s.customer_change_given);
  q('netCashSales').textContent=money(s.net_cash_sales);
  q('cashExpenses').textContent=q('cashCardExpenses').textContent='− '+money(s.cash_expenses);
  q('kitchenCash').textContent=money(s.kitchen_cash);
  q('ticketCash').textContent=money(s.ticket_cash);
  q('gateCash').textContent=money(s.gate_cash);
  q('totalExpectedReceipts').textContent=money(expectedCash+expectedCard+expectedTransfer);
  q('summaryPeriodLabel').textContent=currentBounds?.label||'—';
  q('summarySectionLabel').textContent=selectedSection().label;
  q('lastCalculated').textContent=new Date().toLocaleString('en-NG',{dateStyle:'medium',timeStyle:'short'});
}
async function calculateReconciliation(){
  const btn=q('calculateRecon');
  try{
    currentBounds=periodBounds();
    q('periodLabel').textContent=currentBounds.label;
    q('summaryPeriodLabel').textContent=currentBounds.label;
    SELAccess.clearAlert(q('reconAlert'));
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';}
    const section=selectedSection();
    const {data,error}=await SELAccess.db().rpc('get_reconciliation_summary',{p_start:currentBounds.start.toISOString(),p_end:currentBounds.end.toISOString(),p_section:section.value});
    if(error)throw error;
    reconSummary=typeof data==='string'?JSON.parse(data):data;
    renderSummary(reconSummary||{});
  }catch(err){notify(err.message||'Could not calculate reconciliation.','error')}
  finally{if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-rotate"></i> Refresh Totals';}}
}
function initDates(){
  const today=new Date(),v=localDateValue(today);
  q('reconDate').value=v;q('reconWeekDate').value=v;q('reconStart').value=v;q('reconEnd').value=v;
}
function bind(){
  q('reconMenu').onclick=()=>q('reconSidebar').classList.toggle('open');
  q('reconRange').onchange=()=>{setRangeControls();calculateReconciliation()};
  q('reconSection').onchange=()=>calculateReconciliation();
  ['reconDate','reconWeekDate','reconStart','reconEnd'].forEach(id=>q(id).onchange=()=>calculateReconciliation());
  q('calculateRecon').onclick=()=>calculateReconciliation();
}
document.addEventListener('DOMContentLoaded',async()=>{
  reconCtx=await SELAccess.ensureAuth('reconcile_finance');
  if(!reconCtx)return;
  initDates();setRangeControls();bind();await calculateReconciliation();
});
