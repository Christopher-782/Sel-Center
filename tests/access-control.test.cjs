const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname,'../frontend/js/access-control.js'),'utf8');
function build(role, perms, rpcError = null) {
  const store = new Map([['userRole','super_admin'],['userPermissions','["sales.delete"]']]);
  const localStorage = {
    getItem: k=>store.get(k) ?? null,
    setItem: (k,v)=>store.set(k,String(v)),
    clear:()=>store.clear(),
  };
  const supabase = {
    auth: {getUser:async()=>({data:{user:{id:'someone',email:'x@example.com'}},error:null})},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,full_name:'Example'},error:null})})})}),
    rpc:async()=>({data:perms.map(permission_key=>({permission_key})),error:rpcError}),
  };
  const body = {innerHTML:'',textContent:''};
  const ctx = {
    window:{supabase},localStorage,document:{body,querySelectorAll:()=>[]},
    location:{href:''}, console,
  };
  vm.runInNewContext(code,ctx);
  return {access:ctx.window.SELAccess,store,body};
}
(async()=>{
  const denied = build('manager',[]);
  assert.equal(await denied.access.ensureAuth('sales.dashboard.view'),null,
    'Cached permissions must never grant view access');
  assert.match(denied.body.innerHTML,/Access denied/);

  const supervisorWithoutServerPermission = build('super_admin',[]);
  assert.equal(await supervisorWithoutServerPermission.access.ensureAuth('sales.delete'),null,
    'Frontend must not assume super_admin from client-side role');

  const allowed = build('manager',['sales.dashboard.view','sales.read']);
  const authorized = await allowed.access.ensureAuth('sales.dashboard.view');
  assert.ok(authorized && authorized.permissions.includes('sales.read'));

  const broken = build('manager',[],{message:'permission RPC down'});
  assert.equal(await broken.access.ensureAuth('sales.dashboard.view'),null,
    'RPC failure must fail closed');
  assert.match(broken.body.textContent,/Could not verify/);
  console.log('4 access-control tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
