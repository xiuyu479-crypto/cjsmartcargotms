const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = 'http://127.0.0.1:8899';
const DB = 'https://cjsmartcargo-datebase-default-rtdb.firebaseio.com';

const ts = Date.now();
const ORDER_ID = 'TESTEXP' + ts;
const DONE_ID = 'TESTDONE' + ts;

async function api(path, opt = {}) {
    const r = await fetch(`${DB}/${path}.json`, { headers: { 'Content-Type': 'application/json' }, ...opt });
    const t = await r.text();
    return t ? JSON.parse(t) : null;
}
const put = (p, v) => api(p, { method: 'PUT', body: JSON.stringify(v) });
const post = (p, v) => api(p, { method: 'POST', body: JSON.stringify(v) });
const del = (p) => api(p, { method: 'DELETE' });
const asArray = v => Array.isArray(v) ? v : Object.values(v || {});

(async () => {
    let oaKey1 = null, oaKey2 = null, pass = 0, fail = 0;
    const ok = (m, c) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('dialog', async d => { console.log('   (dialog) ' + d.message().slice(0, 60)); await d.accept(); });

    try {
        await put(`tms/orders/${ORDER_ID}`, {
            orderId: ORDER_ID, customer: 'TEST', tractor: 'TEST-01', driver: '测试司机',
            orderType: 'domestic', statusStep: 1, startTime: ts, statusTimestamps: {}, durations: {}, expenses: []
        });
        await put(`tms/completed_orders/${DONE_ID}`, {
            orderId: DONE_ID, customer: 'TEST', tractor: 'TEST-01', driver: '测试司机',
            orderType: 'domestic', statusStep: 6, startTime: ts, archivedAt: ts, expenses: []
        });

        const base = {
            driverName: '测试司机', plate: 'TEST-01', amount: '500 ZMW', type: 'Fuel (燃油)',
            remark: '自动化测试', status: 'pending', timestamp: ts, createdStr: new Date().toLocaleString()
        };
        const r1 = await post('tms/oa/driver_expenses', { ...base, orderId: ORDER_ID });
        const r2 = await post('tms/oa/driver_expenses', { ...base, amount: '120 USD', type: 'Toll Gate (过路费)', orderId: DONE_ID });
        oaKey1 = r1.name; oaKey2 = r2.name;
        ok('准备测试数据', !!oaKey1 && !!oaKey2);

        await page.goto(B + '/__boot?to=oa.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2500));

        const approve = async (key) => {
            await page.evaluate(k => {
                window.openRemarkModal('driverExp', k, 'approved');
                document.getElementById('remarkText').value = '测试审批通过';
                window.confirmApprove();
            }, key);
            await new Promise(r => setTimeout(r, 2500));
        };
        await approve(oaKey1);
        await approve(oaKey2);

        const o = await api(`tms/orders/${ORDER_ID}`);
        const exp = asArray(o.expenses);
        ok('审批通过后写入活动订单 expenses（1 条）', exp.length === 1 && exp[0].source === 'oa' && exp[0].amount === 500);
        ok('费用带汇率快照与 USD 折算', !!exp[0] && exp[0].currency === 'ZMW' && exp[0].rate > 0 && Math.abs(exp[0].usd - 500 / exp[0].rate) < 0.01);
        ok('费用带 oaId 可溯源', exp[0] && exp[0].oaId === oaKey1);

        const oa1 = await api(`tms/oa/driver_expenses/${oaKey1}`);
        ok('OA 记录标记 appliedTo=orders', oa1.appliedTo === 'orders' && !!oa1.appliedAt);

        const d = await api(`tms/completed_orders/${DONE_ID}`);
        const dexp = asArray(d.expenses);
        ok('归档订单也能落账（completed_orders）', dexp.length === 1 && dexp[0].currency === 'USD' && dexp[0].usd === 120);
        const oa2 = await api(`tms/oa/driver_expenses/${oaKey2}`);
        ok('OA 记录 appliedTo=completed', oa2.appliedTo === 'completed');

        await page.evaluate(k => window.retryApply(k), oaKey1);
        await new Promise(r => setTimeout(r, 1800));
        const exp2 = asArray((await api(`tms/orders/${ORDER_ID}`)).expenses);
        ok('重复计入被幂等拦截', exp2.length === 1);

        const logs = Object.values((await api('tms/audit_logs')) || {});
        ok('审批动作写入审计日志', logs.some(l => l.action === '审批通过' && String(l.target).includes('司机费用')));

        await page.goto(B + '/__boot?to=completed.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2500));
        const shown = await page.evaluate(() => document.getElementById('tableBody').innerText.includes('含OA'));
        ok('已完成订单页显示 OA 明细', shown);
    } catch (e) {
        console.log('异常：' + e.message);
        fail++;
    } finally {
        await del(`tms/orders/${ORDER_ID}`);
        await del(`tms/completed_orders/${DONE_ID}`);
        if (oaKey1) await del(`tms/oa/driver_expenses/${oaKey1}`);
        if (oaKey2) await del(`tms/oa/driver_expenses/${oaKey2}`);
        const logs = (await api('tms/audit_logs')) || {};
        for (const [k, v] of Object.entries(logs)) {
            if (String(v.target || '').includes(ORDER_ID) || String(v.target || '').includes(DONE_ID)) await del(`tms/audit_logs/${k}`);
        }
        console.log(`\n清理完成 · 通过 ${pass} 项，失败 ${fail} 项`);
        await browser.close();
    }
})();
