// 真实浏览器联调：加载页面、等待 Firebase 数据、收集 console/pageerror
const puppeteer = require('puppeteer-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8899';

const PAGES = (process.argv[2] || 'index,audit,finreport,settlement,profit,billing,completed,fleetcost,vehicles,maintenance,oa,dynamic,neworders,dispatch,clients,tracking,report').split(',');

const waitSelectors = {
    index: '#btnFinReport',
    audit: '#tbody tr',
    finreport: '#plateTable tr',
    settlement: '#tbodyEarn tr',
    profit: '#tbodyPlate tr',
    billing: '#tableBody tr',
    completed: '#tableBody tr',
    fleetcost: '#pendingTbody tr, #doneTbody tr, #rechargeTbody tr',
    vehicles: '#vTbody tr',
    maintenance: '#warningContainer',
    oa: '#listContainer, .request-card, .empty-state',
    dynamic: '#loading, #customers .card',
    neworders: '#clientSelect option',
    dispatch: '#orderIdDisplay',
    clients: '#clientList tr, #clientList .empty',
    tracking: '#clientList .client-card, #clientList div',
    report: '#loading'
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: 'new',
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });

    let failures = 0;

    for (const name of PAGES) {
        const page = await browser.newPage();
        const logs = [];
        page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
        page.on('pageerror', e => logs.push('pageerror: ' + e.message));
        page.on('requestfailed', r => {
            const u = r.url();
            if (u.includes('127.0.0.1')) logs.push('requestfailed: ' + u);
        });

        try {
            // 先写会话，再进页面（同源，sessionStorage 保留）
            await page.goto(BASE + '/__boot?to=' + name + '.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(n => location.pathname.includes(n), { timeout: 12000 }, name);
            await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});

            const sel = waitSelectors[name];
            if (sel) {
                await page.waitForSelector(sel, { timeout: 15000 }).catch(() => logs.push('wait timeout: ' + sel));
            }
            await new Promise(r => setTimeout(r, 2500)); // 等 Firebase 首次快照

            const info = await page.evaluate(() => {
                const dbg = document.getElementById('tms-debug-panel');
                return {
                    title: document.title,
                    bodyLen: document.body.innerText.length,
                    debug: dbg ? dbg.innerText : '',
                    sample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220)
                };
            });

            const bad = logs.filter(l => /pageerror|TypeError|ReferenceError|is not a function|Cannot read/.test(l));
            const status = bad.length ? 'FAIL' : (info.debug ? 'DEBUG' : 'OK');
            if (status !== 'OK') failures++;

            console.log(`\n[${status}] ${name}.html  (${info.bodyLen} chars)`);
            console.log('  ' + info.sample);
            if (info.debug) console.log('  DEBUG: ' + info.debug.replace(/\n/g, ' | '));
            bad.slice(0, 6).forEach(l => console.log('  ! ' + l));
        } catch (e) {
            failures++;
            console.log(`\n[FAIL] ${name}.html -> ${e.message}`);
        }
        await page.close();
    }

    await browser.close();
    console.log(`\n==== 完成，异常页面 ${failures} 个 ====`);
    process.exit(failures ? 1 : 0);
})();
