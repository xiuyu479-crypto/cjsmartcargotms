/**
 * 主登录 / Primary login
 *
 * 说明：身份仍由本函数签发，前端只把结果写入 sessionStorage
 *      （关闭浏览器即失效，符合"关掉再进要重新输密码"的要求）。
 * 返回里新增 username / display，供审计日志记录"谁录入、谁修改"。
 *
 * ⚠️ 后续若要提升安全性，可把 users 迁移到环境变量或数据库；
 *    当前场景（非洲现场、少量用户）按业务要求暂不做改造。
 */
exports.handler = async (event, context) => {
  const json = (code, obj) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });

  if (event.httpMethod !== "POST") {
    return json(405, { success: false, msg: "Method Not Allowed" });
  }

  try {
    const { username, password } = JSON.parse(event.body || "{}");
    const uname = String(username || "").trim();
    const pwd = String(password || "");

    // 用户表：password / role / token / display（display 用于审计日志展示）
    const users = {
      "uki202797":   { password: "zxcvbnm",   role: "admin",  token: "tk_admin_999",  display: "管理员" },
      "cjsmartcargo":{ password: "smart2026", role: "staff",  token: "tk_staff_888",  display: "员工" },
      "cjpublic":    { password: "zxcvbnm",   role: "viewer", token: "tk_viewer_777", display: "访客" }
    };

    const user = users[uname];

    if (user && user.password === pwd) {
      return json(200, {
        success: true,
        token: user.token,
        role: user.role,
        username: uname,
        display: user.display,
      });
    }

    return json(401, { success: false, msg: "账号或密码错误" });
  } catch (err) {
    return json(400, { success: false, msg: "无效的请求" });
  }
};
