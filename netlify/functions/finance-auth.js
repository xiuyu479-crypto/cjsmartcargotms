/**
 * 财务模块二级验证 / Finance module second-factor check
 *
 * 用途：主登录（password.html）只区分 admin / staff / viewer。
 * 财务模块（fleetcost.html）属于敏感数据，普通员工进入前需再输入一次"财务密码"，
 * 用于区分「普通员工」和「财务人员」。管理员（admin）由前端直接放行，不走这里。
 *
 * 密码来源：优先读取 Netlify 环境变量 FINANCE_PASSWORD；
 *          未设置时回落到旧版财务账号密码，方便上线即用。
 *          ⚠️ 生产环境请在 Netlify 后台设置 FINANCE_PASSWORD，不要长期依赖兜底值。
 */
exports.handler = async (event) => {
  const json = (code, obj) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });

  if (event.httpMethod !== "POST") {
    return json(405, { success: false, msg: "Method Not Allowed" });
  }

  try {
    const { password } = JSON.parse(event.body || "{}");

    // 财务密码：环境变量优先，兜底沿用旧版财务账号(uki202797)的密码
    const expected = process.env.FINANCE_PASSWORD || "zxcvbnm";
    const token = process.env.FINANCE_TOKEN || "tk_finance_666";

    if (typeof password === "string" && password.length > 0 && password === expected) {
      return json(200, { success: true, token, scope: "finance" });
    }

    // 不区分"密码为空"与"密码错误"，避免泄露信息
    return json(401, { success: false, msg: "财务密码错误" });
  } catch (err) {
    return json(400, { success: false, msg: "无效的请求" });
  }
};
