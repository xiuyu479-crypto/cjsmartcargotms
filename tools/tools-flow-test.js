const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const B = 'http://127.0.0.1:8899';
const DB = 'https://cjsmartcargo-datebase-default-rtdb.firebaseio.com';

async function api(p, o = {}) {
    const r = await fetch(`${DB}/${p}.json`, { headers: { 'Content-Type': 'application/json' }, ...o });
    const t = await r.text(); return t ? JSON.parse(t) : null;
}
const put = (p, v) => api(p, { method: 'PUT', body: JSON.stringify(v) });
const del = (p) => api(p, { method: 'DELETE' });

const ts = Date.now();
const BILL_ID = 'TESTBILL' + ts;
let pass = 0, fail = 0;
const ok = (m, c) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('dialog', async d => {
        console.log('   (dialog/' + d.type() + ') ' + d.message().slice(0, 50));
        await d.accept('3');
    });

    let partKey = null;
    try {
        /* ---------- 1. 汇率历史 ---------- */
        await page.goto(B + '/__boot?to=fleetcost.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000));

        await page.evaluate(() => {
            document.getElementById('fxRateInput').value = '22.35';
            document.getElementById('fxDateInput').value = TMS.util.today();
            addFxRate();
        });
        await new Promise(r => setTimeout(r, 1500));
        const rates = Object.values((await api('tms/fx/rates')) || {});
        const mine = rates.find(r => Math.abs(r.rate - 22.35) < 0.001);
        ok('汇率写入历史表（含生效时间/记录人）', !!mine && mine.effectiveAt > 0 && !!mine.by);

        const listText = await page.evaluate(() => document.getElementById('fxTbody').innerText);
        ok('汇率弹窗列表实时刷新', listText.includes('22.35'));

        /* ---------- 2. 费用录入快照汇率 ---------- */
        await page.evaluate(() => {
            // 直接走真实记账函数，但先手动创建模态实例，避免 hide() 报错
            const el = document.getElementById('spendModal');
            bootstrap.Modal.getOrCreateInstance(el).show();
            document.getElementById('spdCurrency').value = 'ZMW';
            document.getElementById('spdAmount').value = '200';
            document.getElementById('spdUser').value = '自动化测试';
            document.getElementById('spdReason').value = '自动化测试-汇率快照';
            handleBulkSpend();
        });
        await new Promise(r => setTimeout(r, 2000));

        const logs = Object.entries((await api('tms/fleetFinance/logs')) || {})
            .map(([k, v]) => ({ key: k, ...v }))
            .filter(l => l.reason === '自动化测试-汇率快照');
        ok('费用记账带汇率快照', logs.length > 0 && logs.every(l => Number(l.rate) > 0));
        ok('费用记账金额与折算正确', logs[0] && logs[0].amount === 200 && Math.abs(logs[0].usdValue - 200 / logs[0].rate) < 0.01);

        /* ---------- 3. 账单：收款流水 + 开票状态 ---------- */
        await put(`tms/completed_orders/${BILL_ID}`, {
            orderId: BILL_ID, customer: 'AUTOTEST', tractor: 'TEST-01', driver: '测试司机',
            orderType: 'domestic', statusStep: 6, startTime: ts, archivedAt: ts,
            fRate: { val: 100, unit: 'USD' }, route: 'A → B', expenses: []
        });

        await page.goto(B + '/__boot?to=billing.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2500));

        const rowInfo = await page.evaluate(id => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('onclick') === `openPayModal('${id}')`);
            if (!btn) return { found: false };
            btn.click();
            return { found: true, sub: document.getElementById('payModalSub').innerText };
        }, BILL_ID);
        ok('账单页能找到订单并打开收款弹窗', rowInfo.found);

        await page.evaluate(() => {
            document.getElementById('payAmount').value = '40';
            document.getElementById('payCurrency').value = 'USD';
            document.getElementById('payDate').value = TMS.util.today();
            document.getElementById('payNote').value = '自动化测试首款';
            submitPayment();
        });
        await new Promise(r => setTimeout(r, 2000));

        let bill = await api(`tms/completed_orders/${BILL_ID}`);
        let pays = Array.isArray(bill.payments) ? bill.payments : Object.values(bill.payments || {});
        ok('收款写入 payments 流水（1 笔，带汇率）', pays.length === 1 && pays[0].amount === 40 && Number(pays[0].rate) > 0);
        ok('收款人留痕', pays[0] && !!pays[0].by);

        const partial = await page.evaluate(id => {
            const tr = Array.from(document.querySelectorAll('#tableBody tr')).find(t => t.innerText.includes(id));
            return tr ? tr.innerText : '';
        }, BILL_ID);
        ok('账单状态变为“部分收款”', partial.includes('部分收款'));

        await page.evaluate(id => openInvoice(id), BILL_ID);
        await new Promise(r => setTimeout(r, 1500));
        bill = await api(`tms/completed_orders/${BILL_ID}`);
        ok('开票生成发票号并置为已发出', /^INV-\d{6}-\d{4}$/.test(bill.invoiceNo || '') && bill.invoiceStatus === 'sent');

        const pList = await page.evaluate(id => { openPayList(id); return document.getElementById('payListBody').innerText; }, BILL_ID);
        ok('收款流水弹窗显示明细', pList.includes('40.00') && pList.includes('自动化测试首款'));

        /* ---------- 4. 维护中心：配件台账 ---------- */
        await page.goto(B + '/__boot?to=maintenance.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 1500));
        await page.evaluate(() => openModule('m7', '配件台账'));
        await new Promise(r => setTimeout(r, 800));

        await page.evaluate(() => {
            document.getElementById('pt_name').value = '自动化测试-机油滤芯';
            document.getElementById('pt_sku').value = 'AUTO-1';
            document.getElementById('pt_price').value = '85';
            document.getElementById('pt_qty').value = '10';
            document.getElementById('pt_min').value = '5';
            savePart();
        });
        await new Promise(r => setTimeout(r, 1800));

        const parts = Object.entries((await api('tms/parts_catalog')) || {}).map(([k, v]) => ({ key: k, ...v }));
        const part = parts.find(p => p.name === '自动化测试-机油滤芯');
        partKey = part && part.key;
        ok('配件建档成功（期初库存 10）', !!part && part.qty === 10);

        const moves = Object.values((await api('tms/parts_moves')) || {}).filter(m => m.name === '自动化测试-机油滤芯');
        ok('建档同时写入入库流水', moves.some(m => m.type === 'in' && m.qty === 10));

        // 出库 3（prompt 由 dialog handler 返回 '3'）
        await page.evaluate(k => stockMove(k, 'out'), partKey);
        await new Promise(r => setTimeout(r, 1800));
        const after = await api('tms/parts_catalog/' + partKey);
        ok('出库后库存扣减为 7', after && after.qty === 7);

        const lowStockText = await page.evaluate(() => document.getElementById('partTbody').innerText);
        ok('配件台账列表已刷新', lowStockText.includes('自动化测试-机油滤芯'));

        /* ---------- 5. 审计日志覆盖上述动作 ---------- */
        const audit = Object.values((await api('tms/audit_logs')) || {});
        const actions = audit.map(a => a.action);
        ok('汇率/费用/收款/开票/配件动作均留痕',
            ['汇率新增', '费用录入', '登记收款', '开票', '新增配件', '配件出库'].every(a => actions.includes(a)));
    } catch (e) {
        console.log('异常：' + e.message + '\n' + (e.stack || '').split('\n')[1]);
        fail++;
    } finally {
        await del(`tms/completed_orders/${BILL_ID}`);
        const logs = (await api('tms/fleetFinance/logs')) || {};
        for (const [k, v] of Object.entries(logs)) if (v.reason === '自动化测试-汇率快照') await del(`tms/fleetFinance/logs/${k}`);
        const rates = (await api('tms/fx/rates')) || {};
        for (const [k, v] of Object.entries(rates)) if (Math.abs(v.rate - 22.35) < 0.001) await del(`tms/fx/rates/${k}`);
        if (partKey) await del('tms/parts_catalog/' + partKey);
        const moves = (await api('tms/parts_moves')) || {};
        for (const [k, v] of Object.entries(moves)) if (v.name === '自动化测试-机油滤芯') await del(`tms/parts_moves/${k}`);
        const audit = (await api('tms/audit_logs')) || {};
        for (const [k, v] of Object.entries(audit)) {
            const s = JSON.stringify(v);
            if (s.includes('自动化测试') || s.includes('AUTOTEST') || s.includes(BILL_ID) || /22\.35/.test(s)) await del(`tms/audit_logs/${k}`);
        }
        console.log(`\n清理完成 · 通过 ${pass} 项，失败 ${fail} 项`);
        await browser.close();
    }
})();
