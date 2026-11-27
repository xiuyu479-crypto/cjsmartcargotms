const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = 'http://127.0.0.1:8899';
const DB = 'https://cjsmartcargo-datebase-default-rtdb.firebaseio.com';
const ts = Date.now(), ID = 'TESTGEOSTEP' + ts;
const api = async (p, o = {}) => { const r = await fetch(`${DB}/${p}.json`, { headers: { 'Content-Type': 'application/json' }, ...o }); const t = await r.text(); return t ? JSON.parse(t) : null; };
const put = (p, v) => api(p, { method: 'PUT', body: JSON.stringify(v) });
const del = (p) => api(p, { method: 'DELETE' });
let pass = 0, fail = 0;
const ok = (m, c) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const errs = [];
  try {
    await put(`tms/orders/${ID}`, {
      orderId: ID, customer: 'TEST', tractor: 'TEST-STEP', driver: '测试司机',
      orderType: 'domestic', statusStep: 1, startTime: ts - 3600000,
      pickupAddr: 'Lusaka', dropoffAddr: 'Kitwe',
      statusTimestamps: { confirmed: { start: ts - 3600000 } }, durations: {}, issues: [], expenses: []
    });

    await browser.defaultBrowserContext().overridePermissions(B, ['geolocation']);
    const p = await browser.newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', async d => { console.log('   (dialog) ' + d.message().slice(0, 40)); await d.accept(); });
    await p.setGeolocation({ latitude: -15.40672, longitude: 28.28713, accuracy: 15 });
    await p.goto(B + '/__boot?to=report.html%3Fid=' + ID, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 4500));

    const loc = await api(`tms/orders/${ID}/location`);
    ok('司机端实时上报位置', !!loc && Math.abs(loc.lat + 15.4067) < 0.02 && Math.abs(loc.lng - 28.2871) < 0.02);

    // 模拟滑动确认（合成事件，避免无头浏览器鼠标命中偏差）
    await p.evaluate(() => {
        const h = document.getElementById('sliderHandle');
        const w = document.getElementById('sliderWrapper');
        h.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, bubbles: true }));
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: w.offsetWidth + 20, bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 5000));

    const o = await api(`tms/orders/${ID}`);
    ok('状态推进到第 2 步', o.statusStep === 2);
    const st2 = o.statusTimestamps && o.statusTimestamps.arrived_pickup;
    ok('新状态带进入时间 startedAt', !!st2 && st2.startedAt > 0 && !!st2.start);
    ok('新状态带确认时位置', !!st2 && Math.abs(st2.lat + 15.4067) < 0.02 && Math.abs(st2.lng - 28.2871) < 0.02 && st2.acc >= 0);
    const st1 = o.statusTimestamps && o.statusTimestamps.confirmed;
    ok('上一状态保留完成时间与离开位置', !!st1 && st1.end > 0 && Math.abs(Number(st1.endLat) + 15.4067) < 0.02);

    // 动态监控：展开明细看时效记录
    const p2 = await browser.newPage();
    p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(B + '/__boot?to=dynamic.html', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 3000));
    const opened = await p2.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.orderRow')).find(r => r.innerText.includes('TEST-STEP'));
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll('button')).find(b => b.innerText.includes('详情'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    await new Promise(r => setTimeout(r, 800));
    const timing = await p2.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.timingItem'));
      return rows.map(r => ({ text: r.innerText, map: (r.querySelector('.tmap') || {}).href || '' }));
    });
    const withPlace = timing.find(t => /-15\.4/.test(t.text));
    ok('展开明细后有时效记录', opened && timing.length > 0);
    ok('时效记录含日期时间与坐标', !!withPlace && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(withPlace.text) && /-15\.40672, 28\.28713/.test(withPlace.text));
    ok('时效记录带地图链接', !!withPlace && withPlace.map.includes('google.com/maps'));
    const noGps = timing.find(t => t.text.includes('确认发车') || t.text.includes('No GPS') || t.text.includes('无定位'));
    console.log('   时效行：' + timing.map(t => t.text.replace(/\n/g, ' | ')).join('  //  '));
    ok('无定位的历史状态明确标注', timing.some(t => t.text.includes('无定位')));
    if (errs.length) console.log('   报错：' + errs.join(' || '));
    ok('全程无 JS 报错', errs.length === 0);
  } catch (e) { console.log('异常：' + e.message); fail++; }
  finally {
    await del(`tms/orders/${ID}`);
    console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
    await browser.close();
  }
})();
