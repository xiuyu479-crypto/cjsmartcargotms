const puppeteer = require('puppeteer-core');
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const B='http://127.0.0.1:8899';
(async()=>{
  const browser = await puppeteer.launch({executablePath:CHROME, headless:'new', args:['--no-sandbox']});

  // 1) 无凭证直接访问内页 -> 应跳登录
  const p1 = await browser.newPage();
  await p1.goto(B+'/completed.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,800));
  console.log('1) 未登录访问 completed.html ->', p1.url().includes('password.html') ? 'PASS 跳到登录页' : 'FAIL ' + p1.url());

  // 2) 登录后访问 -> 正常
  await p1.goto(B+'/__boot?to=index.html', {waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,600));
  console.log('2) 有会话访问 index ->', p1.url().includes('index.html') ? 'PASS 正常进入' : 'FAIL ' + p1.url());

  // 3) 同标签页内跳转其他页面 -> 保持登录（sessionStorage 同标签页有效）
  await p1.goto(B+'/completed.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,600));
  console.log('3) 同标签页跳 completed ->', p1.url().includes('completed.html') ? 'PASS 免密' : 'FAIL ' + p1.url());

  // 4) 退出登录 -> 清空并回登录页
  await p1.evaluate(()=>TMS.session.logout());
  await new Promise(r=>setTimeout(r,700));
  const cleared = await p1.evaluate(()=>[sessionStorage.getItem('tms_auth'), localStorage.getItem('tms_auth')]);
  console.log('4) 退出登录 ->', (p1.url().includes('password.html') && !cleared[0] && !cleared[1]) ? 'PASS 凭证清空并回登录' : 'FAIL ' + JSON.stringify({url:p1.url(), cleared}));

  // 5) 新标签页（模拟重新打开）-> 需重新登录
  const p2 = await browser.newPage();
  await p2.goto(B+'/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,800));
  console.log('5) 新标签页访问 index ->', p2.url().includes('password.html') ? 'PASS 需重新输密码' : 'FAIL ' + p2.url());

  // 6) 旧版 localStorage 凭证不再放行
  const p3 = await browser.newPage();
  await p3.goto(B+'/password.html', {waitUntil:'domcontentloaded'});
  await p3.evaluate(()=>{localStorage.setItem('tms_auth','tk_admin_999');localStorage.setItem('tms_role','admin');});
  await p3.goto(B+'/index.html', {waitUntil:'domcontentloaded'});
  await new Promise(r=>setTimeout(r,800));
  console.log('6) 伪造 localStorage 凭证 ->', p3.url().includes('password.html') ? 'PASS 仍要求密码' : 'FAIL ' + p3.url());

  await browser.close();
})();
