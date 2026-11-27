/* ==========================================================================
   tms-core.js — TMS 公共底座
   1) session : 会话态凭证（sessionStorage，关闭浏览器即失效）+ 空闲超时
   2) util    : 转义、日期（本地时区）、金额、CSV
   3) fx      : 汇率历史取值（按事件发生时间取当时汇率）
   4) audit   : 修改记录写入（由页面注册实际写库函数，兼容 module / compat 两种 SDK）
   版本：2026-11 统一改造
   ========================================================================== */
(function (global) {
    'use strict';

    var TMS = global.TMS = global.TMS || {};

    /* ------------------------------------------------------------------
       1. 会话 / Session
       ------------------------------------------------------------------
       规则（按业务要求）：
         - 凭证只存 sessionStorage：关闭浏览器/标签页后必然重新输密码
         - 主动登出清空全部凭证（含财务二级验证）
         - 旧版 localStorage 里的凭证一律清除，避免"缓存里有证就一直免密"
         - 另加空闲超时（默认 8 小时），防止笔记本长期挂机被直接接管
    */
    var SESSION_KEYS = ['tms_auth', 'tms_role', 'tms_username', 'tms_loginAt', 'tms_lastActive'];
    var FIN_KEYS = ['tms_fin_auth', 'tms_fin_at'];
    var IDLE_MS = 8 * 60 * 60 * 1000;
    var LAST_TOUCH = 0;

    function ss() { return global.sessionStorage; }

    function dropLegacy() {
        // 升级后必须重新登录一次：清掉旧版持久化凭证
        try {
            ['tms_auth', 'tms_role', 'tms_username'].forEach(function (k) {
                global.localStorage.removeItem(k);
            });
        } catch (e) { /* 隐私模式下忽略 */ }
    }

    var session = TMS.session = {
        idleMs: IDLE_MS,

        init: function () {
            dropLegacy();
            this._bindActivity();
            return this;
        },

        _bindActivity: function () {
            var self = this;
            if (this._bound) return;
            this._bound = true;
            var handler = function () {
                var now = Date.now();
                if (now - LAST_TOUCH < 30000) return; // 节流，避免频繁写 storage
                LAST_TOUCH = now;
                if (ss().getItem('tms_auth')) ss().setItem('tms_lastActive', String(now));
            };
            ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function (ev) {
                global.addEventListener(ev, handler, { passive: true });
            });
        },

        login: function (token, role, username) {
            var now = Date.now();
            ss().setItem('tms_auth', token || 'ok');
            ss().setItem('tms_role', role || 'viewer');
            ss().setItem('tms_username', username || '');
            ss().setItem('tms_loginAt', String(now));
            ss().setItem('tms_lastActive', String(now));
            LAST_TOUCH = now;
        },

        token: function () { return ss().getItem('tms_auth'); },
        role: function () { return ss().getItem('tms_role') || 'viewer'; },
        name: function () { return ss().getItem('tms_username') || ''; },
        isAdmin: function () { return this.role() === 'admin'; },
        isStaff: function () { return this.role() === 'staff'; },

        valid: function () {
            if (!ss().getItem('tms_auth')) return false;
            var last = Number(ss().getItem('tms_lastActive') || 0);
            if (last && Date.now() - last > this.idleMs) {
                this.clear();
                return false;
            }
            return true;
        },

        clear: function () {
            try {
                SESSION_KEYS.concat(FIN_KEYS).forEach(function (k) { ss().removeItem(k); });
            } catch (e) { /* ignore */ }
            try {
                FIN_KEYS.forEach(function (k) { global.localStorage.removeItem(k); });
            } catch (e) { /* ignore */ }
        },

        loginUrl: function () {
            var page = location.pathname.split('/').pop() + location.search;
            return 'password.html?redirect=' + encodeURIComponent(page);
        },

        // 未登录 -> 登录页（保留回跳地址）
        requireLogin: function () {
            if (!this.valid()) {
                location.replace(this.loginUrl());
                return false;
            }
            return true;
        },

        // 角色白名单；不满足则回首页
        requireRole: function (roles) {
            if (!this.requireLogin()) return false;
            var r = this.role();
            if (roles && roles.indexOf(r) === -1) {
                alert('权限不足：仅 ' + roles.join(' / ') + ' 可访问。');
                location.replace('index.html');
                return false;
            }
            return true;
        },

        logout: function () {
            this.clear();
            location.replace('password.html');
        },

        // 财务二级验证（同样放 sessionStorage，关掉浏览器即失效）
        finValid: function () {
            var tk = ss().getItem('tms_fin_auth');
            var at = Number(ss().getItem('tms_fin_at') || 0);
            return !!tk && at > 0 && (Date.now() - at < 12 * 3600 * 1000);
        },
        setFin: function (token) {
            ss().setItem('tms_fin_auth', token || 'ok');
            ss().setItem('tms_fin_at', String(Date.now()));
        }
    };

    session.init();

    /* ------------------------------------------------------------------
       1.5 调试钩子（可选）
       ------------------------------------------------------------------
       打开方式：任意页面 URL 加 ?__debug=1，或先执行
         sessionStorage.setItem('tms_debug','1')
       作用：把 JS 运行时错误 / Promise 失败写到页面右上角，方便现场排障。
    */
    (function debugHook() {
        var on = false;
        try {
            on = /[?&]__debug=1/.test(location.search) || sessionStorage.getItem('tms_debug') === '1';
        } catch (e) { /* ignore */ }
        if (!on) return;

        var box = null;
        function panel() {
            if (box && document.body) return box;
            box = document.createElement('div');
            box.id = 'tms-debug-panel';
            box.style.cssText = 'position:fixed;right:10px;bottom:10px;max-width:420px;max-height:40vh;overflow:auto;' +
                'background:#fff5f5;border:1px solid #f3b4ae;border-radius:8px;padding:10px;font:12px/1.5 monospace;' +
                'color:#b42318;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.12)';
            box.innerHTML = '<b>TMS 调试信息</b>';
            (document.body || document.documentElement).appendChild(box);
            return box;
        }
        function push(msg) {
            var p = panel();
            var line = document.createElement('div');
            line.style.cssText = 'border-top:1px dashed #f3b4ae;padding-top:4px;margin-top:4px;word-break:break-all';
            line.textContent = msg;
            p.appendChild(line);
            console.error('[TMS]', msg);
        }

        window.addEventListener('error', function (e) {
            push('错误: ' + (e.message || '') + ' @ ' + (e.filename || '').split('/').pop() + ':' + (e.lineno || ''));
        });
        window.addEventListener('unhandledrejection', function (e) {
            var r = e.reason;
            push('Promise 失败: ' + (r && (r.code || r.message) ? (r.code || '') + ' ' + (r.message || '') : String(r)));
        });
    })();

    /* ------------------------------------------------------------------
       2. 工具
       ------------------------------------------------------------------ */
    var util = TMS.util = {
        esc: function (v) {
            return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        },

        // 本地时区 YYYY-MM-DD（不要用 toISOString，UTC 会把凌晨记到前一天）
        ymd: function (ts) {
            var d = (ts === undefined || ts === null || ts === '' || ts === 0) ? new Date() : new Date(Number(ts));
            if (isNaN(d.getTime())) return '';
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        },

        // 本地时区 YYYY-MM
        ym: function (ts) {
            return this.ymd(ts).slice(0, 7);
        },

        today: function () { return this.ymd(); },

        dt: function (ts) {
            var n = Number(ts);
            if (!n) return '-';
            var d = new Date(n);
            if (isNaN(d.getTime())) return '-';
            return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
                + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        },

        time: function (ts) {
            var d = new Date(Number(ts) || Date.now());
            return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
        },

        num: function (v) {
            if (typeof v === 'number') return isFinite(v) ? v : 0;
            var n = parseFloat(String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, ''));
            return isFinite(n) ? n : 0;
        },

        // 从 "500 ZMW" / "300 usd" / 120 这类记录里拆出金额与币种
        parseAmount: function (v, fallbackUnit) {
            var raw = String(v === null || v === undefined ? '' : v);
            var unit = /usd|\$/i.test(raw) ? 'USD' : (/zmw|k\b|kwacha/i.test(raw) ? 'ZMW' : (fallbackUnit || 'ZMW'));
            return { amount: this.num(raw), unit: unit };
        },

        money: function (n, digits) {
            var d = digits === undefined ? 2 : digits;
            return (Number(n) || 0).toFixed(d);
        },

        daysUntil: function (ts) {
            if (!ts) return null;
            var d = new Date(String(ts).length <= 10 ? String(ts) + 'T00:00:00' : Number(ts));
            if (isNaN(d.getTime())) return null;
            var t = new Date(); t.setHours(0, 0, 0, 0);
            return Math.round((d.getTime() - t.getTime()) / 86400000);
        },

        download: function (filename, text, mime) {
            var blob = new Blob(['\uFEFF' + text], { type: (mime || 'text/csv') + ';charset=utf-8;' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        },

        csvCell: function (v) {
            var s = String(v === null || v === undefined ? '' : v);
            return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        },

        q: function (name) {
            return new URLSearchParams(location.search).get(name);
        }
    };

    /* ------------------------------------------------------------------
       3. 汇率历史
       ------------------------------------------------------------------
       数据：tms/fx/rates/{pushKey} = { rate: 21.5, effectiveAt: ts, by: '用户名' }
       rateAt(rates, ts) 取"事件发生当时"生效的汇率，保证历史费用不被新汇率改写。
    */
    var DEFAULT_RATE = 20;

    var fx = TMS.fx = {
        DEFAULT: DEFAULT_RATE,

        normalize: function (raw) {
            if (!raw) return [];
            var arr = Array.isArray(raw) ? raw.slice() : Object.keys(raw).map(function (k) {
                var o = raw[k] || {};
                return { key: k, rate: util.num(o.rate), effectiveAt: Number(o.effectiveAt || o.at || 0), by: o.by || '' };
            });
            return arr.filter(function (r) { return r.rate > 0; })
                .map(function (r) {
                    return { key: r.key || '', rate: util.num(r.rate), effectiveAt: Number(r.effectiveAt || 0), by: r.by || '' };
                })
                .sort(function (a, b) { return a.effectiveAt - b.effectiveAt; });
        },

        // 取 ts 当时生效的汇率；早于首条记录则用首条，无记录用默认值
        rateAt: function (rates, ts) {
            if (!rates || !rates.length) return DEFAULT_RATE;
            var t = Number(ts) || Date.now();
            var pick = rates[0];
            for (var i = 0; i < rates.length; i++) {
                if (rates[i].effectiveAt <= t) pick = rates[i];
                else break;
            }
            return pick.rate || DEFAULT_RATE;
        },

        current: function (rates) {
            return this.rateAt(rates, Date.now());
        },

        toUSD: function (amount, unit, rate) {
            var a = util.num(amount), r = Number(rate) || DEFAULT_RATE;
            return String(unit || 'USD').toUpperCase() === 'ZMW' ? a / r : a;
        },

        toZMW: function (amount, unit, rate) {
            var a = util.num(amount), r = Number(rate) || DEFAULT_RATE;
            return String(unit || 'ZMW').toUpperCase() === 'USD' ? a * r : a;
        }
    };

    /* ------------------------------------------------------------------
       4. 车辆位置
       ------------------------------------------------------------------
       数据：tms/orders/{id}/location = { lat, lng, acc, at, speed, heading, by }
       司机端 watchPosition 上报，动态监控端按 at 显示"位置 + 更新时间"。
    */
    var geo = TMS.geo = {
        // 浏览器是否支持定位（file:// 或 http 非 localhost 会被浏览器禁用）
        available: function () {
            return !!(global.navigator && global.navigator.geolocation) && global.isSecureContext !== false;
        },

        // 统一成 { lat, lng, acc, at, speed, heading, by }；无效返回 null
        parse: function (raw) {
            if (!raw) return null;
            var lat = Number(raw.lat !== undefined ? raw.lat : raw.latitude);
            var lng = Number(raw.lng !== undefined ? raw.lng : raw.longitude);
            if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
            return {
                lat: lat,
                lng: lng,
                acc: Number(raw.acc || raw.accuracy) || 0,
                at: Number(raw.at || raw.updatedAt) || 0,
                speed: raw.speed === undefined || raw.speed === null ? null : Number(raw.speed),
                heading: raw.heading === undefined || raw.heading === null ? null : Number(raw.heading),
                by: raw.by || ''
            };
        },

        fmt: function (lat, lng, digits) {
            var d = digits === undefined ? 5 : digits;
            return Number(lat).toFixed(d) + ', ' + Number(lng).toFixed(d);
        },

        mapUrl: function (lat, lng) {
            return 'https://www.google.com/maps/search/?api=1&query=' + Number(lat) + ',' + Number(lng);
        },

        // 距今多少分钟（向下取整），无效时间返回 null
        minutesAgo: function (ts) {
            var t = Number(ts);
            if (!t) return null;
            var m = Math.floor((Date.now() - t) / 60000);
            return m < 0 ? 0 : m;
        },

        // 两点距离（米），用于"移动超过阈值才上报"，避免静止时刷库
        distance: function (a, b) {
            if (!a || !b) return Infinity;
            var R = 6371000, rad = Math.PI / 180;
            var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
            var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
        }
    };

    /* ------------------------------------------------------------------
       5. 审计日志
       ------------------------------------------------------------------
       数据：tms/audit_logs/{pushKey} = { at, by, role, action, target, detail, before, after }
       页面负责注册写库函数（各页 SDK 不同）：
         TMS.audit.bind(function(payload){ return push(ref(db,'tms/audit_logs'), payload); });
    */
    var writer = null;

    var audit = TMS.audit = {
        bind: function (fn) { writer = fn; },

        build: function (action, target, detail, extra) {
            var payload = {
                at: Date.now(),
                by: session.name() || session.role(),
                role: session.role(),
                action: action || '',
                target: target || '',
                detail: detail === undefined || detail === null ? '' : String(detail)
            };
            if (extra && typeof extra === 'object') {
                Object.keys(extra).forEach(function (k) {
                    if (payload[k] === undefined) payload[k] = extra[k];
                });
            }
            return payload;
        },

        log: function (action, target, detail, extra) {
            var payload = this.build(action, target, detail, extra);
            try {
                if (writer) {
                    var p = writer(payload);
                    if (p && p.catch) p.catch(function (e) { console.warn('[audit] 写入失败', e); });
                } else {
                    console.info('[audit]', payload);
                }
            } catch (e) {
                console.warn('[audit] 写入异常', e);
            }
            return payload;
        }
    };

})(window);
