// 本地静态服务 + 会话引导页，用于无头浏览器联调
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 8899);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json'
};

http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);

    // 会话引导：写入 sessionStorage 后跳转目标页（模拟已登录）
    if (url === '/__boot') {
        const target = new URL(req.url, 'http://x').searchParams.get('to') || 'index.html';
        const role = new URL(req.url, 'http://x').searchParams.get('role') || 'admin';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><body>boot
<script>
sessionStorage.setItem('tms_auth','test');
sessionStorage.setItem('tms_role','${role}');
sessionStorage.setItem('tms_username','测试管理员');
sessionStorage.setItem('tms_loginAt', String(Date.now()));
sessionStorage.setItem('tms_lastActive', String(Date.now()));
sessionStorage.setItem('tms_debug','1');
location.replace('${target}');
</script></body>`);
        return;
    }

    if (url === '/') url = '/index.html';
    const file = path.join(root, url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log('serving on http://127.0.0.1:' + port));
