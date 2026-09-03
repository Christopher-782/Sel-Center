(function(){
  const LABELS={
    gate_entry:'Record gate entry fees',kitchen_pos:'Use Kitchen POS',ticket_pos:'Use Ticket POS',
    view_ticket_reports:'View ticket sales reports',view_kitchen_reports:'View kitchen sales reports',view_gate_reports:'View gate fee reports',
    manage_ticket_inventory:'Manage ticket quantities',manage_kitchen_inventory:'Manage kitchen inventory',manage_users:'Create users and assign access',view_audit_logs:'View inventory audit logs',reconcile_finance:'Perform daily, weekly and custom reconciliation',admin_dashboard:'Open admin dashboard'
  };
  const ALL=Object.keys(LABELS);
  function db(){if(!window.supabase||typeof window.supabase.from!=='function') throw new Error('Supabase client is not available.');return window.supabase;}
  async function currentUser(){const {data,error}=await db().auth.getUser();if(error||!data.user) return null;return data.user;}
  async function getPermissions(force=false){
    if(!force){try{const cached=JSON.parse(localStorage.getItem('userPermissions')||'[]');if(Array.isArray(cached)&&cached.length) return cached;}catch(_){}}
    const user=await currentUser(); if(!user) return [];
    try{
      const {data,error}=await db().rpc('get_my_permissions');
      if(error) throw error;
      const perms=(data||[]).map(r=>typeof r==='string'?r:r.permission_key).filter(Boolean);
      localStorage.setItem('userPermissions',JSON.stringify(perms)); return perms;
    }catch(err){
      console.warn('Permission RPC unavailable; using role fallback.',err.message);
      const role=(localStorage.getItem('userRole')||'').toLowerCase();
      const fallback=role==='admin'?ALL:role==='manager'?['kitchen_pos','ticket_pos','view_ticket_reports','view_kitchen_reports','manage_ticket_inventory','manage_kitchen_inventory','view_audit_logs']:role==='sale_associate'?['kitchen_pos','ticket_pos']:[];
      localStorage.setItem('userPermissions',JSON.stringify(fallback)); return fallback;
    }
  }
  async function ensureAuth(required){
    const user=await currentUser(); if(!user){location.href='login.html';return null;}
    const permissions=await getPermissions(true);
    if(required && !permissions.includes(required)){
      document.body.innerHTML='<div style="font-family:Inter,sans-serif;max-width:620px;margin:80px auto;padding:28px"><h2>Access denied</h2><p>You do not have permission to open this section.</p><a href="app.html">Return to dashboard</a></div>';
      return null;
    }
    hydrateUser(user,permissions); return {user,permissions};
  }
  async function ensureAny(required=[]){
    const ctx=await ensureAuth(); if(!ctx) return null;
    if(required.length && !required.some(p=>ctx.permissions.includes(p))){
      document.body.innerHTML='<div style="font-family:Inter,sans-serif;max-width:620px;margin:80px auto;padding:28px"><h2>Access denied</h2><p>You do not have permission to open this section.</p><a href="app.html">Return to dashboard</a></div>';return null;
    }
    return ctx;
  }
  function hydrateUser(user,permissions){
    document.querySelectorAll('[data-user-name]').forEach(el=>el.textContent=localStorage.getItem('userName')||user.email||'User');
    document.querySelectorAll('[data-permission-link]').forEach(el=>{if(!permissions.includes(el.dataset.permissionLink)) el.classList.add('hidden');});
  }
  async function logout(){await db().auth.signOut();localStorage.clear();location.href='login.html';}
  function money(n){return '₦'+Number(n||0).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function alertBox(el,msg,type='success'){if(!el)return;el.className='alert '+(type==='error'?'alert-error':type==='info'?'alert-info':'alert-success');el.textContent=msg;el.classList.remove('hidden');}
  function clearAlert(el){if(el)el.classList.add('hidden');}
  window.SELAccess={db,currentUser,getPermissions,ensureAuth,ensureAny,logout,money,esc,alertBox,clearAlert,labels:LABELS,allPermissions:ALL};
})();
