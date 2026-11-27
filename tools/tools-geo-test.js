const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = 'http://127.0.0.1:8899';
const DB = 'https://cjsmartcargo-datebase-default-rtdb.firebaseio.com';
const ts = Date.now(), ID = 'TESTGEO' + ts;

const api = async (p, o = {}) => { const r = await fetch(`${DB}/${p}.json`, { headers: { 'Content-Type': 'application/json' }, ...o }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const put = (p, v) => api(p, { method: 'PUT', body: JSON.stringify(v) });
const del = (p) => api(p, { method: 'DELETE' });

let pass = 0, fail = 0;
const ok = (m, c) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  try {
    await put(`tms/orders/${ID}`, {
      orderId: ID, customer: 'TEST', tractor: 'TEST-GPS', driver: '测试司机',
      orderType: 'domestic', statusStep: 2, startTime: ts, pickupAddr: 'Lusaka', dropoffAddr: 'Kitwe',
      statusTimestamps: { arrived_pickup: { start: ts } }, durations: {}, issues: [], expenses: []
    });

    /* ---- 1. 司机端：授权后自动上报 ---- */
    const ctx = browser.defaultBrowserContext();
    await ctx.overridePermissions(B, ['geolocation']);
    const p1 = await browser.newPage();
    const errs = [];
    p1.on('pageerror', e => errs.push(e.message));
    await p1.setGeolocation({ latitude: -15.4067, longitude: 28.2871, accuracy: 12 }); // Lusaka
    await p1.goto(B + '/__boot?to=report.html%3Fid=' + ID, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 5000));

    const loc = await api(`tms/orders/${ID}/location`);
    ok('司机端上报位置到订单 location', !!loc && Math.abs(loc.lat + 15.4067) < 0.02 && Math.abs(loc.lng - 28.2871) < 0.02);
    ok('位置带时间戳/精度/上报人', !!loc && loc.at > 0 && loc.acc >= 0 && loc.by === '测试司机');
    const bar = await p1.evaluate(() => ({ cls: document.getElementById('locBar').className, txt: document.getElementById('locText').innerText }));
    ok('司机端状态条显示共享中', bar.cls.includes('on') && bar.txt.includes('Location shared'));
    ok('司机端无 JS 报错', errs.length === 0);

    /* ---- 2. 事务防回退：旧时间戳不得覆盖 ---- */
    const before = await api(`tms/orders/${ID}/location`);
    await p1.evaluate(async (id) => {
      // 直接调用内部上传函数，模拟一条更旧的位置
      const older = { lat: 1.1, lng: 2.2, acc: 5, at: Date.now() - 3600000, speed: null, heading: null };
      try { await uploadLocation(older); } catch (e) {}
    }, ID);
    await new Promise(r => setTimeout(r, 2000));
    const after = await api(`tms/orders/${ID}/location`);
    ok('旧位置不会覆盖新位置（事务保护）', after.lat === before.lat && after.at === before.at);

    /* ---- 3. 动态监控：显示位置+时间+地图 ---- */
    const p2 = await browser.newPage();
    p2.on('pageerror', e => errs.push(e.message));
    errs.length = 0;
    await p2.goto(B + '/__boot?to=dynamic.html', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));
    const rowInfo = await p2.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.orderRow'));
      const row = rows.find(r => r.innerText.includes('TEST-GPS'));
      if (!row) return null;
      const line = row.querySelector('.loc-line');
      const link = line && line.querySelector('a');
      return { text: line ? line.innerText : '', cls: line ? line.className : '', href: link ? link.href : '' };
    });
    ok('动态栏显示位置行', !!rowInfo && rowInfo.text.includes('位置'));
    ok('位置含坐标与更新时间', !!rowInfo && /-15\.40/.test(rowInfo.text) && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(rowInfo.text));
    ok('带地图链接', !!rowInfo && rowInfo.href.includes('google.com/maps'));
    ok('新位置不显示为过期', !!rowInfo && !rowInfo.cls.includes('stale'));
    ok('动态页无 JS 报错', errs.length === 0);

    /* ---- 4. 过期位置变黄 ---- */
    await put(`tms/orders/${ID}/location`, Object.assign({}, before, { at: Date.now() - 2 * 3600 * 1000 }));
    await p2.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2500));
    const stale = await p2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.orderRow')).find(r => r.innerText.includes('TEST-GPS'));
      const line = row && row.querySelector('.loc-line');
      return line ? { cls: line.className, text: line.innerText } : null;
    });
    ok('超过 30 分钟标记为过期并显示"2 小时前"', !!stale && stale.cls.includes('stale') && stale.text.includes('2 小时前'));

    /* ---- 5. 无位置时显示占位符 ---- */
    await del(`tms/orders/${ID}/location`);
    await p2.reload({ waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2500));
    const none = await p2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.orderRow')).find(r => r.innerText.includes('TEST-GPS'));
      const line = row && row.querySelector('.loc-line');
      return line ? { cls: line.className, text: line.innerText } : null;
    });
    ok('无位置时显示「位置: —」', !!none && none.text.includes('—') && none.cls.includes('loc-none'));

    /* ---- 6. 拒绝授权时的提示 ---- */
    const p3 = await browser.newPage();
    await p3.goto(B + '/__boot?to=report.html%3Fid=' + ID, { waitUntil: 'networkidle2' });
    const deniedCtx = await browser.createBrowserContext();
    const p4 = await deniedCtx.newPage();
    const defaultCtx = browser.defaultBrowserContext();
    // 新 context 默认未授权，浏览器直接拒绝
    await p4.goto(B + '/__boot?to=report.html%3Fid=' + ID, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 6000));
    const deniedBar = await p4.evaluate(() => ({ cls: document.getElementById('locBar').className, txt: document.getElementById('locText').innerText }));
    console.log('   未授权时状态：' + deniedBar.cls + ' | ' + deniedBar.txt);
    ok('未授权时给出明确提示', deniedBar.cls.includes('denied') || deniedBar.cls.includes('warn'));
    await deniedCtx.close();
    await p3.close();
  } catch (e) { console.log('异常：' + e.message + '\n' + (e.stack || '').split('\n')[1]); fail++; }
  finally {
    await del(`tms/orders/${ID}`);
    console.log(`\n清理完成 · 通过 ${pass} 项，失败 ${fail} 项`);
    await browser.close();
  }
})();
