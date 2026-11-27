const puppeteer=require('puppeteer-core');
const B='http://127.0.0.1:8899';
(async()=>{
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  const dialogs=[]; p.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});

  // staff 访问财务：应弹财务密码遮罩，且看不到修改记录入口
  await p.goto(B+'/__boot?to=fleetcost.html&role=staff',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,2200));
  const staff=await p.evaluate(()=>({
    guard: document.body.classList.contains('fin-guard'),
    auditBtn: getComputedStyle(document.getElementById('btnAuditLink')).display,
    finModal: document.getElementById('finAuthModal').classList.contains('show')
  }));
  console.log('staff 财务页 ->', (staff.finModal?'PASS 要求财务密码':'FAIL'), '| 修改记录入口=', staff.auditBtn==='none'?'PASS 隐藏':'FAIL 可见');

  // staff 访问审计页：应被拦截
  dialogs.length=0;
  await p.goto(B+'/__boot?to=audit.html&role=staff',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1200));
  console.log('staff 审计页 ->', p.url().includes('index.html')||p.url().includes('password.html') ? 'PASS 被拦截到 '+p.url().split('/').pop() : 'FAIL '+p.url(), '|', dialogs[0]||'');

  // viewer 访问费用报表：应被拒绝
  await p.goto(B+'/__boot?to=finreport.html&role=viewer',{waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,1200));
  console.log('viewer 报表 ->', p.url().includes('index.html') ? 'PASS 被拒绝' : 'FAIL '+p.url());

  // admin 访问财务：直通
  await p.goto(B+'/__boot?to=fleetcost.html&role=admin',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,2000));
  const admin=await p.evaluate(()=>({
    guard: document.body.classList.contains('fin-guard'),
    auditBtn: getComputedStyle(document.getElementById('btnAuditLink')).display
  }));
  console.log('admin 财务页 ->', (!admin.guard?'PASS 直通':'FAIL 被拦'), '| 修改记录入口=', admin.auditBtn!=='none'?'PASS 显示':'FAIL 隐藏');
  await b.close();
})();
