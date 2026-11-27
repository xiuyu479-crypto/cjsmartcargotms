const puppeteer = require('puppeteer-core');
const path = require('path');
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
const ORDER_ID = 'TESTISSUE' + ts;
const VEH_ID = '-TESTVEH' + ts;
let pass = 0, fail = 0;
const ok = (m, c) => { console.log((c ? 'PASS ' : 'FAIL ') + m); c ? pass++ : fail++; };

(async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });

    try {
        /* ---------- 1. 司机端异常：类型 + 照片 ---------- */
        await put(`tms/orders/${ORDER_ID}`, {
            orderId: ORDER_ID, customer: 'TEST', tractor: 'TEST-01', driver: '测试司机',
            orderType: 'cross_border', statusStep: 2, startTime: ts,
            statusTimestamps: { confirmed: { start: ts } }, durations: {}, expenses: [], issues: []
        });

        await page.goto(B + `/__boot?to=report.html%3Fid=${ORDER_ID}`, { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2000));

        await page.click('#openIssueModal');
        await new Promise(r => setTimeout(r, 600));

        const fileInput = await page.$('#issuePhoto');
        await fileInput.uploadFile(path.resolve('assets/images/logo.jpg'));
        await page.select('#issueType', 'customs');
        await page.type('#issueInput', '自动化测试：边境滞留');
        await new Promise(r => setTimeout(r, 500));
        await page.click('#submitIssue');
        await new Promise(r => setTimeout(r, 14000));

        const o = await api(`tms/orders/${ORDER_ID}`);
        const issues = Array.isArray(o.issues) ? o.issues : Object.values(o.issues || {});
        const it = issues[0] || {};
        ok('异常上报保存成功', issues.length === 1);
        ok('异常带中英文类型', it.type === 'customs' && it.typeZh === '边检/海关滞留' && it.typeEn === 'Customs Delay');
        console.log('   照片状态：' + (it.photoUrl ? '已上传 ' + it.photoUrl.slice(0, 60) : '未上传（' + (it.photoError || '无') + '）'));
        ok('照片失败不影响主流程（有图或有明确错误）', !!it.photoUrl || !!it.photoError);

        /* ---------- 2. 动态监控端展示类型 ---------- */
        await page.goto(B + '/__boot?to=dynamic.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 2500));
        const issueBtn = await page.evaluate(id => {
            const cards = document.querySelectorAll('.orderRow');
            for (const c of cards) if (c.innerText.includes('TEST-01')) {
                const b = c.querySelector('.issueBtn'); if (b) { b.click(); return true; }
            }
            return false;
        }, ORDER_ID);
        if (issueBtn) {
            await new Promise(r => setTimeout(r, 600));
            const modalText = await page.evaluate(() => document.getElementById('issueModal').innerText);
            ok('动态端展示中英双语异常类型', modalText.includes('边检/海关滞留') && modalText.includes('Customs Delay'));
        } else {
            ok('动态端展示中英双语异常类型', false);
        }

        /* ---------- 3. 车辆单证 ---------- */
        await put(`tms/vehicles/${VEH_ID}`, { head: 'TEST-01', trailer: 'TEST-T1', km: 1000 });
        await page.goto(B + '/__boot?to=vehicles.html', { waitUntil: 'networkidle2' });
        await new Promise(r => setTimeout(r, 1800));
        await page.evaluate(k => openDocModal(k), VEH_ID);
        await new Promise(r => setTimeout(r, 600));
        const modalOpen = await page.evaluate(() => document.getElementById('docModal').classList.contains('show'));
        ok('单证弹窗可打开', modalOpen);

        await page.evaluate(() => {
            const d = new Date(Date.now() + 20 * 86400000);
            const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            document.getElementById('doc_no_roadTax').value = 'RT-001';
            document.getElementById('doc_exp_roadTax').value = ymd;
            document.getElementById('doc_no_insurance').value = 'INS-001';
            document.getElementById('doc_exp_insurance').value = '2020-01-01'; // 已过期
            saveDocs();
        });
        await new Promise(r => setTimeout(r, 1500));

        const v = await api('tms/vehicles/' + VEH_ID);
        ok('单证保存到车辆档案', v.docs && v.docs.roadTax && v.docs.roadTax.no === 'RT-001');
        const rowText = await page.evaluate(k => {
            const tr = Array.from(document.querySelectorAll('#vTbody tr')).find(t => t.innerText.includes('TEST-01'));
            return tr ? tr.innerText : '';
        }, VEH_ID);
        ok('列表显示到期状态（取最近到期：已过期）', rowText.includes('已过期'));

        /* ---------- 4. 司机证照 ---------- */
        await page.evaluate(() => switchTab('driver'));
        await new Promise(r => setTimeout(r, 400));
        const licField = await page.$('#licenseExpiry');
        ok('司机表单新增证照字段', !!licField);

    } catch (e) {
        console.log('异常：' + e.message);
        fail++;
    } finally {
        await del(`tms/orders/${ORDER_ID}`);
        await del(`tms/vehicles/${VEH_ID}`);
        const audit = (await api('tms/audit_logs')) || {};
        for (const [k, v] of Object.entries(audit)) if (JSON.stringify(v).includes('TEST-01')) await del(`tms/audit_logs/${k}`);
        console.log(`\n清理完成 · 通过 ${pass} 项，失败 ${fail} 项`);
        await browser.close();
    }
})();
