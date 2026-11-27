// 语法自检：抽取 HTML 内联 <script> 与外部 JS，用 node --check 校验
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.argv[2] || '.';
const outDir = path.join(root, '.tmp_check');
fs.mkdirSync(outDir, { recursive: true });

let errors = 0, checked = 0;

function check(code, label, asModule) {
    if (!code.trim()) return;
    const ext = asModule ? '.mjs' : '.js';
    const file = path.join(outDir, 'chk_' + (checked++) + ext);
    fs.writeFileSync(file, code, 'utf8');
    try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log('OK   ' + label);
    } catch (e) {
        errors++;
        const msg = (e.stderr || Buffer.from('')).toString().split('\n').slice(0, 6).join('\n');
        console.log('FAIL ' + label + '\n' + msg);
    }
}

fs.readdirSync(root).filter(f => f.endsWith('.html')).forEach(f => {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(html))) {
        const attrs = m[1] || '';
        const body = m[2] || '';
        if (/\bsrc=/.test(attrs)) continue;
        const isModule = /type\s*=\s*["']module["']/.test(attrs);
        check(body, f + ' #script' + (++i) + (isModule ? ' [module]' : ''), isModule);
    }
});

['assets/js/tms-core.js'].forEach(f => {
    const p = path.join(root, f);
    if (fs.existsSync(p)) check(fs.readFileSync(p, 'utf8'), f, false);
});

// Netlify functions (CommonJS)
['netlify/functions/auth.js', 'netlify/functions/finance-auth.js'].forEach(f => {
    const p = path.join(root, f);
    if (fs.existsSync(p)) check(fs.readFileSync(p, 'utf8'), f, false);
});

console.log(`\n检查完成：${checked} 段脚本，${errors} 处语法错误`);
process.exit(errors ? 1 : 0);
