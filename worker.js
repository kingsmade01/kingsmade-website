const SESSION_COOKIE = "km_admin_session";
const SESSION_HOURS = 8;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY"
    }
  });
}

function b64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value) {
  const base = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base + "=".repeat((4 - (base.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))
  ));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return "";
}

async function createSession(secret) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({
    exp: Date.now() + SESSION_HOURS * 3600 * 1000,
    nonce: crypto.randomUUID()
  })));
  return `${payload}.${await sign(payload, secret)}`;
}

async function validSession(request, secret) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const expected = await sign(parts[0], secret);
  if (!safeEqual(parts[1], expected)) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function cookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function checkOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const own = new URL(request.url);
    return parsed.host === own.host && parsed.protocol === own.protocol;
  } catch {
    return false;
  }
}

async function bodyJSON(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

async function latestRate(env) {
  return await env.DB.prepare(
    "SELECT rate, rate_date, fetched_at, source FROM exchange_rates WHERE base_currency='USD' AND quote_currency='NGN' ORDER BY rate_date DESC LIMIT 1"
  ).first();
}

async function refreshRate(env) {
  if (!env.FXAPI_KEY) throw new Error("FXAPI_KEY is not configured in this Worker.");

  const response = await fetch(
    "https://api.fxapi.com/v1/latest?base_currency=USD&currencies=NGN",
    {
      headers: {
        apikey: env.FXAPI_KEY,
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    throw new Error(`FXAPI returned HTTP ${response.status}. The last saved rate has been preserved.`);
  }

  const payload = await response.json();
  const rate = Number(payload?.data?.NGN?.value);

  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("FXAPI response did not contain a valid USD/NGN rate.");
  }

  const stamp = String(payload?.meta?.last_updated_at || new Date().toISOString());
  const rateDate = /^\d{4}-\d{2}-\d{2}/.exec(stamp)?.[0] ||
    new Date().toISOString().slice(0, 10);

  await env.DB.prepare(`
    INSERT INTO exchange_rates
      (rate_date, base_currency, quote_currency, rate, source, fetched_at)
    VALUES (?, 'USD', 'NGN', ?, 'fxapi', CURRENT_TIMESTAMP)
    ON CONFLICT(rate_date) DO UPDATE SET
      rate=excluded.rate,
      source='fxapi',
      fetched_at=CURRENT_TIMESTAMP
  `).bind(rateDate, rate).run();

  return {
    rate,
    rate_date: rateDate,
    fetched_at: new Date().toISOString(),
    source: "fxapi"
  };
}

async function requireAuth(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return json({
      error: "SESSION_SECRET must be configured with at least 32 characters."
    }, 503);
  }

  if (!(await validSession(request, env.SESSION_SECRET))) {
    return json({
      error: "Your session has expired. Please sign in again."
    }, 401);
  }

  return null;
}

async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/health" && method === "GET") {
    return json({
      ok: true,
      service: "KINGSMADE PRIVATE COMMAND CENTER",
      database: Boolean(env.DB)
    });
  }

  if (path === "/api/login" && method === "POST") {
    if (!checkOrigin(request)) return json({ error: "Request origin rejected." }, 403);

    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
      return json({ error: "Admin secrets are not configured correctly." }, 503);
    }

    const body = await bodyJSON(request);

    if (!safeEqual(String(body.password || ""), String(env.ADMIN_PASSWORD))) {
      return json({ error: "Incorrect password." }, 401);
    }

    const token = await createSession(env.SESSION_SECRET);

    return json({ ok: true }, 200, {
      "Set-Cookie": cookieHeader(token, SESSION_HOURS * 3600)
    });
  }

  if (path === "/api/logout" && method === "POST") {
    if (!checkOrigin(request)) return json({ error: "Request origin rejected." }, 403);

    return json({ ok: true }, 200, {
      "Set-Cookie": cookieHeader("", 0)
    });
  }

  const authError = await requireAuth(request, env);
  if (authError) return authError;

  if (method !== "GET" && !checkOrigin(request)) {
    return json({ error: "Request origin rejected." }, 403);
  }

  if (path === "/api/me" && method === "GET") {
    return json({ authenticated: true });
  }

  if (path === "/api/dashboard" && method === "GET") {
    const [sales, expense, stock, orders, recent] = await Promise.all([
      env.DB.prepare(`
        SELECT COALESCE(SUM(total_ngn),0) AS revenue, COUNT(*) AS paid_orders
        FROM orders WHERE LOWER(payment_status)='paid'
      `).first(),

      env.DB.prepare(
        "SELECT COALESCE(SUM(amount_ngn),0) AS total FROM expenses"
      ).first(),

      env.DB.prepare(`
        SELECT
          COALESCE(SUM(stock_quantity * cost_price_ngn),0) AS cost_value,
          COALESCE(SUM(stock_quantity * price_ngn),0) AS retail_value,
          COALESCE(SUM(stock_quantity),0) AS units
        FROM products WHERE is_active=1
      `).first(),

      env.DB.prepare(`
        SELECT COUNT(*) AS total,
          SUM(CASE WHEN LOWER(payment_status)='pending' THEN 1 ELSE 0 END) AS pending
        FROM orders
      `).first(),

      env.DB.prepare(`
        SELECT id, order_number, customer_name, status, payment_status, total_ngn, created_at
        FROM orders ORDER BY id DESC LIMIT 8
      `).all()
    ]);

    const cogs = await env.DB.prepare(`
      SELECT COALESCE(SUM(oi.quantity * oi.unit_cost_ngn),0) AS total
      FROM order_items oi
      INNER JOIN orders o ON o.id=oi.order_id
      WHERE LOWER(o.payment_status)='paid'
    `).first();

    const revenue = num(sales?.revenue);
    const expenses = num(expense?.total);
    const costOfGoods = num(cogs?.total);

    return json({
      revenue_ngn: revenue,
      paid_orders: num(sales?.paid_orders),
      expenses_ngn: expenses,
      cogs_ngn: costOfGoods,
      estimated_profit_ngn: revenue - costOfGoods - expenses,
      inventory_cost_ngn: num(stock?.cost_value),
      inventory_retail_ngn: num(stock?.retail_value),
      stock_units: num(stock?.units),
      total_orders: num(orders?.total),
      pending_orders: num(orders?.pending),
      recent_orders: recent.results || [],
      profit_note: "Estimated profit = paid order revenue − recorded item costs − recorded expenses. Missing historical item costs may understate profit."
    });
  }

  if (path === "/api/fx" && method === "GET") {
    const rate = await latestRate(env);

    const history = await env.DB.prepare(`
      SELECT rate_date, rate FROM exchange_rates
      WHERE base_currency='USD' AND quote_currency='NGN'
      AND rate_date >= date('now','-90 days')
      ORDER BY rate_date ASC
    `).all();

    return json({
      latest: rate || null,
      history: history.results || [],
      update_frequency: "Daily reference rate on FXAPI Free plan"
    });
  }

  if (path === "/api/fx/refresh" && method === "POST") {
    try {
      return json({ latest: await refreshRate(env) });
    } catch (error) {
      return json({
        error: error.message,
        latest: await latestRate(env).catch(() => null)
      }, 502);
    }
  }

  if (path === "/api/products" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT id, name, description, price_ngn, price_usd, cost_price_ngn,
        category, image_url, sizes_json, colors_json, stock_quantity,
        is_active, created_at, updated_at
      FROM products ORDER BY id DESC
    `).all();

    return json({ products: result.results || [] });
  }

  if (path === "/api/products" && method === "POST") {
    const b = await bodyJSON(request);
    const name = cleanText(b.name, 180);

    if (!name) return json({ error: "Product name is required." }, 400);

    const rate = await latestRate(env);
    const usd = b.price_usd === "" || b.price_usd == null
      ? null
      : num(b.price_usd, -1);

    if (usd !== null && (usd < 0 || !rate?.rate)) {
      return json({
        error: "A valid saved FX rate is required before saving a USD price. Refresh the exchange rate first."
      }, 400);
    }

    const ngn = usd !== null
      ? Math.round(usd * Number(rate.rate))
      : Math.max(0, Math.round(num(b.price_ngn)));

    const sizes = Array.isArray(b.sizes) ? b.sizes : [];
    const colors = Array.isArray(b.colors) ? b.colors : [];

    const result = await env.DB.prepare(`
      INSERT INTO products
        (name, description, price_ngn, price_usd, category, image_url,
         sizes_json, colors_json, stock_quantity, is_active, cost_price_ngn, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      name,
      cleanText(b.description),
      ngn,
      usd,
      cleanText(b.category, 100),
      cleanText(b.image_url, 2000),
      JSON.stringify(sizes.map(x => cleanText(x, 80)).filter(Boolean)),
      JSON.stringify(colors.map(x => cleanText(x, 80)).filter(Boolean)),
      Math.max(0, Math.round(num(b.stock_quantity))),
      b.is_active === false ? 0 : 1,
      Math.max(0, Math.round(num(b.cost_price_ngn)))
    ).run();

    return json({
      ok: true,
      id: result.meta?.last_row_id,
      price_ngn: ngn
    });
  }

  const productMatch = path.match(/^\/api\/products\/(\d+)$/);

  if (productMatch && method === "PUT") {
    const id = Number(productMatch[1]);
    const b = await bodyJSON(request);

    const existing = await env.DB.prepare(
      "SELECT id FROM products WHERE id=?"
    ).bind(id).first();

    if (!existing) return json({ error: "Product not found." }, 404);

    const name = cleanText(b.name, 180);
    if (!name) return json({ error: "Product name is required." }, 400);

    const rate = await latestRate(env);
    const usd = b.price_usd === "" || b.price_usd == null
      ? null
      : num(b.price_usd, -1);

    if (usd !== null && (usd < 0 || !rate?.rate)) {
      return json({
        error: "A valid saved FX rate is required before saving a USD price."
      }, 400);
    }

    const ngn = usd !== null
      ? Math.round(usd * Number(rate.rate))
      : Math.max(0, Math.round(num(b.price_ngn)));

    await env.DB.prepare(`
      UPDATE products SET
        name=?, description=?, price_ngn=?, price_usd=?, category=?,
        image_url=?, sizes_json=?, colors_json=?, stock_quantity=?,
        is_active=?, cost_price_ngn=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).bind(
      name,
      cleanText(b.description),
      ngn,
      usd,
      cleanText(b.category, 100),
      cleanText(b.image_url, 2000),
      JSON.stringify(Array.isArray(b.sizes) ? b.sizes.map(x => cleanText(x, 80)).filter(Boolean) : []),
      JSON.stringify(Array.isArray(b.colors) ? b.colors.map(x => cleanText(x, 80)).filter(Boolean) : []),
      Math.max(0, Math.round(num(b.stock_quantity))),
      b.is_active ? 1 : 0,
      Math.max(0, Math.round(num(b.cost_price_ngn))),
      id
    ).run();

    return json({ ok: true, price_ngn: ngn });
  }

  if (productMatch && method === "DELETE") {
    const id = Number(productMatch[1]);

    const used = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM order_items WHERE product_id=?"
    ).bind(id).first();

    if (num(used?.count) > 0) {
      return json({
        error: "This product appears in order history. Deactivate it instead to preserve historical records."
      }, 409);
    }

    await env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run();
    return json({ ok: true });
  }

  if (path === "/api/orders" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT id, order_number, customer_name, status, payment_status, total_ngn, created_at
      FROM orders ORDER BY id DESC LIMIT 200
    `).all();

    return json({ orders: result.results || [] });
  }

  const orderMatch = path.match(/^\/api\/orders\/(\d+)$/);

  if (orderMatch && method === "PATCH") {
    const b = await bodyJSON(request);
    const status = cleanText(b.status, 30).toLowerCase();
    const allowed = ["pending", "processing", "shipped", "delivered", "cancelled"];

    if (!allowed.includes(status)) {
      return json({ error: "Invalid order status." }, 400);
    }

    await env.DB.prepare(
      "UPDATE orders SET status=? WHERE id=?"
    ).bind(status, Number(orderMatch[1])).run();

    return json({ ok: true });
  }

  if (path === "/api/customers" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT customer_name, COUNT(*) AS order_count,
        COALESCE(SUM(CASE WHEN LOWER(payment_status)='paid' THEN total_ngn ELSE 0 END),0) AS paid_total_ngn,
        MAX(created_at) AS last_order
      FROM orders GROUP BY customer_name
      ORDER BY last_order DESC LIMIT 300
    `).all();

    return json({
      customers: result.results || [],
      note: "Your current orders table stores customer names only; email addresses and phone numbers are not available in this database."
    });
  }

  if (path === "/api/expenses" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT id, description, amount_ngn, category, expense_date, created_at
      FROM expenses ORDER BY expense_date DESC, id DESC LIMIT 300
    `).all();

    return json({ expenses: result.results || [] });
  }

  if (path === "/api/expenses" && method === "POST") {
    const b = await bodyJSON(request);
    const description = cleanText(b.description, 250);
    const amount = Math.round(num(b.amount_ngn, -1));

    if (!description || amount < 0) {
      return json({
        error: "Enter an expense description and a valid non-negative amount."
      }, 400);
    }

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.expense_date || ""))
      ? b.expense_date
      : new Date().toISOString().slice(0, 10);

    const result = await env.DB.prepare(`
      INSERT INTO expenses (description, amount_ngn, category, expense_date)
      VALUES (?, ?, ?, ?)
    `).bind(
      description,
      amount,
      cleanText(b.category, 100),
      date
    ).run();

    return json({ ok: true, id: result.meta?.last_row_id });
  }

  const expenseMatch = path.match(/^\/api\/expenses\/(\d+)$/);

  if (expenseMatch && method === "DELETE") {
    await env.DB.prepare(
      "DELETE FROM expenses WHERE id=?"
    ).bind(Number(expenseMatch[1])).run();

    return json({ ok: true });
  }

  if (path === "/api/complaints" && method === "GET") {
    const result = await env.DB.prepare(`
      SELECT id, customer_name, order_number, subject, message, status, created_at
      FROM complaints ORDER BY id DESC LIMIT 300
    `).all();

    return json({ complaints: result.results || [] });
  }

  if (path === "/api/complaints" && method === "POST") {
    const b = await bodyJSON(request);
    const subject = cleanText(b.subject, 200);
    const message = cleanText(b.message, 5000);

    if (!subject || !message) {
      return json({ error: "Complaint subject and message are required." }, 400);
    }

    const result = await env.DB.prepare(`
      INSERT INTO complaints
        (customer_name, order_number, subject, message, status)
      VALUES (?, ?, ?, ?, 'open')
    `).bind(
      cleanText(b.customer_name, 180),
      cleanText(b.order_number, 100),
      subject,
      message
    ).run();

    return json({ ok: true, id: result.meta?.last_row_id });
  }

  const complaintMatch = path.match(/^\/api\/complaints\/(\d+)$/);

  if (complaintMatch && method === "PATCH") {
    const b = await bodyJSON(request);
    const status = cleanText(b.status, 30);

    if (!["open", "in_progress", "resolved"].includes(status)) {
      return json({ error: "Invalid complaint status." }, 400);
    }

    await env.DB.prepare(
      "UPDATE complaints SET status=? WHERE id=?"
    ).bind(status, Number(complaintMatch[1])).run();

    return json({ ok: true });
  }

  return json({ error: "API route not found." }, 404);
}

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#111110">
<title>KINGSMADE | Private Command Center</title>
<style>
:root{--bg:#10100f;--panel:#191917;--panel2:#20201d;--line:#30302b;--gold:#c8ad78;--gold2:#e0c99b;--ivory:#f2eee5;--muted:#aaa69d;--green:#78b99a;--red:#d77d78;--radius:15px}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ivory);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px}
button,input,textarea,select{font:inherit}
button{cursor:pointer}
.hidden{display:none!important}
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(ellipse at 50% 20%,#27231b 0,transparent 55%),var(--bg)}
.login-card{width:min(420px,100%);background:#171715;border:1px solid #39352b;border-radius:18px;padding:36px;box-shadow:0 25px 90px #0008}
.wordmark{font-family:Georgia,serif;letter-spacing:.26em;font-size:25px;text-align:center;color:#f6f1e8}
.submark{text-align:center;color:var(--gold);letter-spacing:.22em;font-size:9px;margin:12px 0 30px}
.eyebrow{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:var(--gold)}
.field{display:flex;flex-direction:column;gap:7px;margin:12px 0}
.field label{font-size:11px;color:#c9c4b9;letter-spacing:.08em;text-transform:uppercase}
.field input,.field textarea,.field select,.toolbar input,.toolbar select{width:100%;background:#10100f;color:var(--ivory);border:1px solid #393932;border-radius:9px;padding:11px 12px;outline:none}
.field input:focus,.field textarea:focus,.field select:focus{border-color:var(--gold)}
.btn{border:1px solid #66583d;background:var(--gold);color:#15130f;border-radius:9px;padding:10px 14px;font-weight:700}
.btn:hover{background:var(--gold2)}
.btn.ghost{background:transparent;color:var(--ivory);border-color:#44443d}
.btn.danger{background:transparent;color:#e8a09b;border-color:#754a46}
.btn.small{padding:7px 10px;font-size:12px}
.login-card .btn{width:100%;margin-top:12px;padding:12px}
.error{color:#f09c96;font-size:12px;min-height:18px;margin-top:8px}
.app{min-height:100vh}
.sidebar{width:248px;position:fixed;inset:0 auto 0 0;background:#151513;border-right:1px solid var(--line);padding:25px 17px;display:flex;flex-direction:column;z-index:5}
.side-logo{font-family:Georgia,serif;font-size:21px;letter-spacing:.22em;text-align:center;padding:8px 0 5px}
.side-caption{text-align:center;color:var(--gold);font-size:8px;letter-spacing:.2em;margin-bottom:35px}
.nav-label{font-size:9px;letter-spacing:.18em;color:#77736b;margin:14px 10px 8px}
.nav button{width:100%;border:0;background:transparent;color:#bdb8ad;text-align:left;padding:11px 12px;border-radius:8px;margin:2px 0;display:flex;align-items:center;gap:12px}
.nav button:hover,.nav button.active{background:#29271f;color:var(--gold2)}
.nav .ico{width:17px;text-align:center;color:var(--gold)}
.side-bottom{margin-top:auto;border-top:1px solid var(--line);padding-top:15px}
.side-user{color:var(--muted);font-size:11px;padding:8px 10px}
.main{margin-left:248px;padding:27px 32px 60px;max-width:1800px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:28px}
.page-title{font-family:Georgia,serif;font-size:29px;font-weight:400;margin:0 0 5px}
.page-sub{color:var(--muted);font-size:12px}
.top-actions{display:flex;gap:9px;align-items:center}
.rate-pill{border:1px solid #514833;color:var(--gold2);padding:9px 12px;border-radius:9px;font-size:11px}
.section{display:none}
.section.active{display:block}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 17px}
.section-head h2{font-family:Georgia,serif;font-size:22px;font-weight:400;margin:0}
.muted{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.stat{background:linear-gradient(145deg,#1e1e1b,#181816);border:1px solid var(--line);border-radius:var(--radius);padding:18px;min-height:116px}
.stat-label{font-size:10px;letter-spacing:.13em;color:var(--muted);text-transform:uppercase}
.stat-value{font-family:Georgia,serif;font-size:27px;margin:14px 0 4px}
.stat-note{font-size:10px;color:#8f8b82}
.two-col{display:grid;grid-template-columns:1.45fr 1fr;gap:15px;margin-top:16px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px;min-width:0}
.panel-title{font-family:Georgia,serif;font-size:18px;font-weight:400;margin:0 0 15px}
.chart-wrap{height:220px;position:relative}
.chart-wrap svg{width:100%;height:100%;overflow:visible}
.chart-labels{display:flex;justify-content:space-between;color:#858178;font-size:10px;margin-top:5px}
.toolbar{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.toolbar input{max-width:270px}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:11px}
table{width:100%;border-collapse:collapse;min-width:680px}
th,td{text-align:left;padding:12px 13px;border-bottom:1px solid #2d2d28;font-size:12px;white-space:nowrap}
th{font-size:9px;text-transform:uppercase;letter-spacing:.13em;color:#a9a397;background:#20201d}
td{color:#e3ded3}
tr:last-child td{border-bottom:0}
.badge{display:inline-block;padding:5px 8px;border-radius:30px;background:#292820;color:var(--gold2);font-size:10px;text-transform:capitalize}
.badge.good{color:var(--green);background:#1e3028}
.badge.bad{color:#e6a09a;background:#382321}
.actions{display:flex;gap:6px}
.empty{padding:28px;text-align:center;color:#918c82}
.modal-back{position:fixed;inset:0;background:#000a;display:grid;place-items:center;padding:15px;z-index:20}
.modal{width:min(700px,100%);max-height:90vh;overflow:auto;background:#191917;border:1px solid #4b4435;border-radius:16px;padding:22px}
.modal-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.modal-head h3{font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
.span2{grid-column:1/-1}
.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
.notice{border:1px solid #514833;background:#211f19;color:#d8c59f;padding:11px 13px;border-radius:9px;font-size:11px;line-height:1.5;margin:12px 0}
.toast{position:fixed;right:20px;bottom:20px;background:#e9dfc9;color:#171510;padding:12px 16px;border-radius:9px;z-index:50;box-shadow:0 8px 30px #0008}
.hamb{display:none}
.profit-positive{color:var(--green)}
.profit-negative{color:var(--red)}
@media(max-width:1050px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two-col{grid-template-columns:1fr}.main{padding:22px 20px 50px}}
@media(max-width:720px){.sidebar{transform:translateX(-100%);transition:transform .2s;width:260px;box-shadow:15px 0 35px #0008}.sidebar.open{transform:translateX(0)}.main{margin-left:0;padding:18px 14px 40px}.hamb{display:inline-flex}.topbar{align-items:flex-start}.page-title{font-size:24px}.rate-pill{display:none}.grid{gap:9px}.stat{padding:13px;min-height:102px}.stat-value{font-size:21px}.stat-label{font-size:9px}.form-grid{grid-template-columns:1fr}.span2{grid-column:auto}.login-card{padding:27px 22px}.top-actions .btn{padding:8px 10px;font-size:11px}}
</style>
</head>
<body>

<div id="loginView" class="login-wrap">
  <div class="login-card">
    <div class="wordmark">KINGSMADE</div>
    <div class="submark">PRIVATE COMMAND CENTER</div>
    <div class="eyebrow">Administrator access</div>
    <div class="field">
      <label for="loginPassword">Access password</label>
      <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Enter your private password">
    </div>
    <button class="btn" id="loginBtn">ENTER COMMAND CENTER</button>
    <div class="error" id="loginError"></div>
    <div class="muted" style="text-align:center;font-size:10px;margin-top:18px">SECURE PRIVATE ACCESS · CRAFT FOR KINGS</div>
  </div>
</div>

<div id="appView" class="app hidden">
  <aside class="sidebar" id="sidebar">
    <div class="side-logo">KINGSMADE</div>
    <div class="side-caption">PRIVATE COMMAND CENTER</div>
    <div class="nav-label">MANAGEMENT</div>
    <nav class="nav">
      <button class="active" data-page="overview"><span class="ico">◈</span>Overview</button>
      <button data-page="products"><span class="ico">◇</span>Products</button>
      <button data-page="orders"><span class="ico">▤</span>Orders</button>
      <button data-page="customers"><span class="ico">♙</span>Customers</button>
      <button data-page="complaints"><span class="ico">✉</span>Complaints</button>
      <button data-page="expenses"><span class="ico">↗</span>Expenses</button>
      <button data-page="exchange"><span class="ico">⇄</span>Exchange rate</button>
    </nav>
    <div class="side-bottom">
      <div class="side-user">AUTHORIZED ADMINISTRATOR</div>
      <button class="btn ghost" id="logoutBtn" style="width:100%">Sign out ↗</button>
    </div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div style="display:flex;gap:12px;align-items:center">
        <button class="btn ghost hamb" id="menuBtn">☰</button>
        <div>
          <h1 class="page-title" id="pageTitle">Overview</h1>
          <div class="page-sub">KINGSMADE · CRAFT FOR KINGS</div>
        </div>
      </div>
      <div class="top-actions">
        <div class="rate-pill" id="ratePill">USD/NGN · Loading…</div>
        <button class="btn ghost" id="refreshBtn">↻ Refresh</button>
      </div>
    </header>

    <section class="section active" id="page-overview">
      <div class="grid" id="statsGrid"></div>
      <div class="two-col">
        <div class="panel">
          <h3 class="panel-title">USD / NGN · Daily reference history</h3>
          <div id="rateChart" class="chart-wrap"><div class="empty">Exchange-rate history will appear here.</div></div>
          <div class="chart-labels"><span>Daily mid-market reference rate</span><span id="chartRange">Last 90 days</span></div>
        </div>
        <div class="panel">
          <h3 class="panel-title">Financial position</h3>
          <div id="financeSummary" class="muted">Loading financial summary…</div>
          <div class="notice">Profit is an estimate based on paid orders, recorded product costs and recorded expenses. It is not a substitute for reconciled accounts.</div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Recent orders</h3>
        <div id="recentOrders"></div>
      </div>
    </section>

    <section class="section" id="page-products">
      <div class="section-head"><h2>Product collection</h2><button class="btn" id="addProductBtn">＋ Add product</button></div>
      <div class="toolbar">
        <input id="productSearch" placeholder="Search products…">
        <select id="productFilter">
          <option value="all">All products</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div id="productsTable"></div>
    </section>

    <section class="section" id="page-orders">
      <div class="section-head"><h2>Order management</h2></div>
      <div class="toolbar">
        <input id="orderSearch" placeholder="Search order or customer…">
        <select id="orderFilter">
          <option value="all">All payment states</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending payment</option>
        </select>
      </div>
      <div id="ordersTable"></div>
      <div class="notice">Payment status is read-only here. Only a verified payment provider webhook should mark an order paid and trigger stock deduction.</div>
    </section>

    <section class="section" id="page-customers">
      <div class="section-head"><h2>Customer directory</h2></div>
      <div id="customersTable"></div>
      <div class="notice">The current orders table contains customer names only. Email and phone fields are not present, so this directory does not invent missing contact details.</div>
    </section>

    <section class="section" id="page-complaints">
      <div class="section-head"><h2>Customer complaints</h2><button class="btn" id="addComplaintBtn">＋ Record complaint</button></div>
      <div id="complaintsTable"></div>
    </section>

    <section class="section" id="page-expenses">
      <div class="section-head"><h2>Business expenses</h2><button class="btn" id="addExpenseBtn">＋ Add expense</button></div>
      <div id="expensesTable"></div>
    </section>

    <section class="section" id="page-exchange">
      <div class="section-head"><h2>Exchange-rate intelligence</h2><button class="btn" id="fxRefreshBtn">↻ Update rate</button></div>
      <div class="grid" id="fxStats"></div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Daily USD/NGN history</h3>
        <div id="rateChartLarge" class="chart-wrap"></div>
        <div class="chart-labels"><span>FXAPI mid-market reference data</span><span>Daily updates · Free plan</span></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Rate history</h3>
        <div id="fxHistoryTable"></div>
      </div>
      <div class="notice">The FXAPI Free plan refreshes daily and supplies daily historical rates. This is not a live trading feed and does not provide OHLC candles on the Free plan. Product NGN equivalents are calculated from the saved daily reference rate.</div>
    </section>
  </main>
</div>

<div id="modalRoot"></div>
<div id="toast" class="toast hidden"></div>

<script>
const $=id=>document.getElementById(id);
let state={products:[],orders:[],customers:[],complaints:[],expenses:[],dashboard:null,fx:null,page:'overview'};
let seenOrderIds=new Set();
let orderPollingReady=false;

const money=n=>'₦'+Number(n||0).toLocaleString('en-NG',{maximumFractionDigits:0});
const usd=n=>'$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function toast(message){
  $('toast').textContent=message;
  $('toast').classList.remove('hidden');
  setTimeout(()=>$('toast').classList.add('hidden'),2800);
}

async function api(path,options={}){
  const response=await fetch(path,{
    ...options,
    headers:{
      ...(options.body?{'Content-Type':'application/json'}:{}),
      ...(options.headers||{})
    }
  });

  let data={};
  try{data=await response.json()}catch{}

  if(response.status===401){
    showLogin();
    throw new Error(data.error||'Please sign in again.');
  }

  if(!response.ok)throw new Error(data.error||'Request failed.');
  return data;
}

function showLogin(){
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
}

function showApp(){
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
}

async function login(){
  $('loginError').textContent='';
  $('loginBtn').disabled=true;

  try{
    await api('/api/login',{
      method:'POST',
      body:JSON.stringify({password:$('loginPassword').value})
    });
    $('loginPassword').value='';
    showApp();
    await loadAll();
  }catch(e){
    $('loginError').textContent=e.message;
  }finally{
    $('loginBtn').disabled=false;
  }
}

async function logout(){
  try{
    await api('/api/logout',{method:'POST',body:'{}'});
  }catch{}
  showLogin();
  toast('You have signed out.');
}

function setPage(page){
  state.page=page;
  document.querySelectorAll('.nav button').forEach(b=>
    b.classList.toggle('active',b.dataset.page===page)
  );
  document.querySelectorAll('.section').forEach(s=>
    s.classList.toggle('active',s.id==='page-'+page)
  );

  $('pageTitle').textContent=({
    overview:'Overview',
    products:'Products',
    orders:'Orders',
    customers:'Customers',
    complaints:'Complaints',
    expenses:'Expenses',
    exchange:'Exchange rate'
  })[page]||'Overview';

  $('sidebar').classList.remove('open');

  if(page==='products')renderProducts();
  if(page==='orders')renderOrders();
  if(page==='customers')renderCustomers();
  if(page==='complaints')renderComplaints();
  if(page==='expenses')renderExpenses();
  if(page==='exchange')renderExchange();
}

function table(headers,rows){
  if(!rows.length)return '<div class="empty">No records to display yet.</div>';

  return '<div class="table-wrap"><table><thead><tr>'+
    headers.map(h=>'<th>'+h+'</th>').join('')+
    '</tr></thead><tbody>'+rows.join('')+
    '</tbody></table></div>';
}

function statusBadge(s){
  let v=String(s||'pending').toLowerCase();
  return '<span class="badge '+
    (v==='paid'||v==='resolved'||v==='delivered'?'good':v==='cancelled'?'bad':'')+
    '">'+esc(v.replace('_',' '))+'</span>';
}

async function loadAll(){
  try{
    const [d,p,o,c,x,co,fx]=await Promise.all([
      api('/api/dashboard'),
      api('/api/products'),
      api('/api/orders'),
      api('/api/customers'),
      api('/api/expenses'),
      api('/api/complaints'),
      api('/api/fx')
    ]);

    state.dashboard=d;
    state.products=p.products||[];
    state.orders=o.orders||[];
    seenOrderIds=new Set(state.orders.map(x=>x.id));
    orderPollingReady=true;
    state.customers=c.customers||[];
    state.expenses=x.expenses||[];
    state.complaints=co.complaints||[];
    state.fx=fx;

    renderOverview();
    renderProducts();
  }catch(e){
    toast(e.message);
  }
}

function notifyNewOrder(){
  try{
    const C=window.AudioContext||window.webkitAudioContext;
    if(!C)return;

    const ctx=new C();
    const osc=ctx.createOscillator();
    const gain=ctx.createGain();

    osc.type='sine';
    osc.frequency.setValueAtTime(880,ctx.currentTime);
    osc.frequency.setValueAtTime(1175,ctx.currentTime+.13);
    gain.gain.setValueAtTime(.0001,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.12,ctx.currentTime+.025);
    gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.34);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+.36);
    osc.onended=()=>ctx.close();
  }catch{}
}

async function checkNewOrders(){
  if($('appView').classList.contains('hidden'))return;

  try{
    const data=await api('/api/orders');
    const incoming=data.orders||[];
    const fresh=incoming.filter(o=>!seenOrderIds.has(o.id));

    if(orderPollingReady&&fresh.length){
      notifyNewOrder();
      toast(fresh.length+' new order'+(fresh.length===1?'':'s')+' received.');
    }

    seenOrderIds=new Set(incoming.map(o=>o.id));
    orderPollingReady=true;
    state.orders=incoming;

    if(state.page==='orders')renderOrders();
  }catch{}
}

function renderOverview(){
  const d=state.dashboard||{};

  const cards=[
    ['PAID REVENUE',money(d.revenue_ngn),'Confirmed paid orders only'],
    ['ESTIMATED PROFIT',money(d.estimated_profit_ngn),'After recorded costs and expenses'],
    ['PAID ORDERS',Number(d.paid_orders||0).toLocaleString(),'Of '+Number(d.total_orders||0)+' total orders'],
    ['RECORDED EXPENSES',money(d.expenses_ngn),'All expense entries'],
    ['INVENTORY COST VALUE',money(d.inventory_cost_ngn),'Active stock at unit cost'],
    ['INVENTORY RETAIL VALUE',money(d.inventory_retail_ngn),'Active stock at selling price'],
    ['UNITS IN STOCK',Number(d.stock_units||0).toLocaleString(),'Across active products'],
    ['PENDING ORDERS',Number(d.pending_orders||0).toLocaleString(),'Awaiting payment']
  ];

  $('statsGrid').innerHTML=cards.map(c=>
    '<div class="stat"><div class="stat-label">'+c[0]+
    '</div><div class="stat-value">'+c[1]+
    '</div><div class="stat-note">'+c[2]+'</div></div>'
  ).join('');

  $('financeSummary').innerHTML=
    '<div style="display:flex;justify-content:space-between;margin:12px 0"><span>Paid revenue</span><b>'+
    money(d.revenue_ngn)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between;margin:12px 0"><span>Cost of goods sold</span><b>'+
    money(d.cogs_ngn)+'</b></div>'+
    '<div style="display:flex;justify-content:space-between;margin:12px 0"><span>Recorded expenses</span><b>'+
    money(d.expenses_ngn)+'</b></div>'+
    '<div style="border-top:1px solid #393932;padding-top:15px;display:flex;justify-content:space-between"><span>Estimated profit</span><b class="'+
    (d.estimated_profit_ngn>=0?'profit-positive':'profit-negative')+'">'+
    money(d.estimated_profit_ngn)+'</b></div>';

  $('recentOrders').innerHTML=table(
    ['ORDER','CUSTOMER','PAYMENT','TOTAL','DATE'],
    (d.recent_orders||[]).map(o=>
      '<tr><td>'+esc(o.order_number)+'</td><td>'+esc(o.customer_name)+'</td><td>'+
      statusBadge(o.payment_status)+'</td><td>'+money(o.total_ngn)+'</td><td>'+
      esc(o.created_at||'')+'</td></tr>'
    )
  );

  renderChart(state.fx?.history||[]);

  const r=state.fx?.latest;
  $('ratePill').textContent=r
    ?'USD/NGN · '+Number(r.rate).toLocaleString('en-US',{maximumFractionDigits:2})
    :'USD/NGN · Not loaded';
}

function renderChart(history,target='rateChart'){
  const el=$(target);
  if(!el)return;

  if(!history.length){
    el.innerHTML='<div class="empty">No saved daily rates yet. Update the rate to begin building history.</div>';
    return;
  }

  const vals=history.map(x=>Number(x.rate));
  const min=Math.min(...vals);
  const max=Math.max(...vals);
  const span=max-min||1;
  const w=700,h=210,p=20;

  const pts=vals.map((v,i)=>[
    p+i*(w-2*p)/Math.max(1,vals.length-1),
    h-p-((v-min)/span)*(h-2*p)
  ]);

  const path=pts.map((a,i)=>
    (i?'L':'M')+a[0].toFixed(1)+','+a[1].toFixed(1)
  ).join(' ');

  const area=path+
    ' L'+pts[pts.length-1][0]+','+(h-p)+
    ' L'+pts[0][0]+','+(h-p)+' Z';

  el.innerHTML=
    '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">'+
    '<defs><linearGradient id="rateFill" x1="0" x2="0" y1="0" y2="1">'+
    '<stop offset="0%" stop-color="#c8ad78" stop-opacity=".24"/>'+
    '<stop offset="100%" stop-color="#c8ad78" stop-opacity="0"/>'+
    '</linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#rateFill)"/>'+
    '<path d="'+path+'" fill="none" stroke="#c8ad78" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'+
    pts.filter((p,i)=>i===0||i===pts.length-1||i%Math.ceil(pts.length/8)===0)
      .map(p=>'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="3" fill="#e0c99b"/>').join('')+
    '</svg>'+
    '<div class="chart-labels"><span>'+esc(history[0].rate_date)+'</span><b style="color:#e0c99b">'+
    Number(vals[vals.length-1]).toLocaleString('en-US',{maximumFractionDigits:2})+
    ' NGN</b><span>'+esc(history[history.length-1].rate_date)+'</span></div>';
}

function renderProducts(){
  const q=($('productSearch')?.value||'').toLowerCase();
  const f=$('productFilter')?.value||'all';

  const list=state.products.filter(p=>
    (p.name+' '+p.category).toLowerCase().includes(q)&&
    (f==='all'||(f==='active'?p.is_active:!p.is_active))
  );

  $('productsTable').innerHTML=table(
    ['PRODUCT','CATEGORY','USD PRICE','NGN PRICE','UNIT COST','STOCK','STATUS','ACTIONS'],
    list.map(p=>
      '<tr><td><b>'+esc(p.name)+'</b><div class="muted">#'+p.id+'</div></td>'+
      '<td>'+esc(p.category)+'</td>'+
      '<td>'+(p.price_usd==null?'—':usd(p.price_usd))+'</td>'+
      '<td>'+money(p.price_ngn)+'</td>'+
      '<td>'+money(p.cost_price_ngn)+'</td>'+
      '<td>'+Number(p.stock_quantity)+'</td>'+
      '<td>'+statusBadge(p.is_active?'active':'inactive')+'</td>'+
      '<td><div class="actions">'+
      '<button class="btn ghost small" onclick="editProduct('+p.id+')">Edit</button>'+
      '<button class="btn ghost small" onclick="toggleProduct('+p.id+')">'+
      (p.is_active?'Hide':'Activate')+'</button>'+
      '<button class="btn danger small" onclick="deleteProduct('+p.id+')">Delete</button>'+
      '</div></td></tr>'
    )
  );
}

function modal(title,content){
  $('modalRoot').innerHTML=
    '<div class="modal-back" id="modalBack"><div class="modal">'+
    '<div class="modal-head"><h3>'+title+'</h3>'+
    '<button class="btn ghost small" onclick="closeModal()">✕</button></div>'+
    content+'</div></div>';
}

function closeModal(){
  $('modalRoot').innerHTML='';
}

function productForm(p={}){
  const sizes=(()=>{
    try{return JSON.parse(p.sizes_json||'[]').join(', ')}
    catch{return ''}
  })();

  const colors=(()=>{
    try{return JSON.parse(p.colors_json||'[]').join(', ')}
    catch{return ''}
  })();

  modal(p.id?'Edit product':'Add product',
    '<form id="productForm"><div class="form-grid">'+
    '<div class="field span2"><label>Product name</label><input name="name" required maxlength="180" value="'+esc(p.name||'')+'"></div>'+
    '<div class="field"><label>Category</label><input name="category" value="'+esc(p.category||'')+'" placeholder="Menswear, accessories…"></div>'+
    '<div class="field"><label>USD selling price</label><input name="price_usd" type="number" min="0" step="0.01" value="'+(p.price_usd??'')+'" placeholder="e.g. 45.00"></div>'+
    '<div class="field"><label>NGN selling price (converted)</label><input name="price_ngn" type="number" min="0" value="'+(p.price_ngn||0)+'" readonly></div>'+
    '<div class="field"><label>Unit cost (NGN)</label><input name="cost_price_ngn" type="number" min="0" value="'+(p.cost_price_ngn||0)+'"></div>'+
    '<div class="field"><label>Stock quantity</label><input name="stock_quantity" type="number" min="0" value="'+(p.stock_quantity||0)+'"></div>'+
    '<div class="field"><label>Sizes (comma separated)</label><input name="sizes" value="'+esc(sizes)+'" placeholder="S, M, L, XL"></div>'+
    '<div class="field"><label>Colours (comma separated)</label><input name="colors" value="'+esc(colors)+'" placeholder="Black, White"></div>'+
    '<div class="field span2"><label>Image URL</label><input name="image_url" value="'+esc(p.image_url||'')+'" placeholder="https://…"></div>'+
    '<div class="field span2"><label>Description</label><textarea name="description" rows="3">'+esc(p.description||'')+'</textarea></div>'+
    '<div class="field"><label>Visibility</label><select name="is_active">'+
    '<option value="1" '+(p.is_active?'selected':'')+'>Active</option>'+
    '<option value="0" '+(!p.is_active?'selected':'')+'>Hidden</option></select></div>'+
    '</div><div class="notice" id="priceHint">NGN equivalent uses the latest saved FXAPI daily reference rate. Existing NGN prices remain preserved until you save a USD price.</div>'+
    '<div class="form-actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save product</button></div></form>'
  );

  const form=$('productForm');
  const usdInput=form.elements.price_usd;
  const ngnInput=form.elements.price_ngn;
  const rate=Number(state.fx?.latest?.rate||0);

  usdInput.addEventListener('input',()=>{
    if(rate&&usdInput.value!==''){
      ngnInput.value=Math.round(Number(usdInput.value)*rate);
    }
  });

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(form);

    const payload={
      name:fd.get('name'),
      category:fd.get('category'),
      price_usd:fd.get('price_usd'),
      price_ngn:fd.get('price_ngn'),
      cost_price_ngn:fd.get('cost_price_ngn'),
      stock_quantity:fd.get('stock_quantity'),
      sizes:String(fd.get('sizes')).split(',').map(x=>x.trim()).filter(Boolean),
      colors:String(fd.get('colors')).split(',').map(x=>x.trim()).filter(Boolean),
      image_url:fd.get('image_url'),
      description:fd.get('description'),
      is_active:fd.get('is_active')==='1'
    };

    try{
      await api(p.id?'/api/products/'+p.id:'/api/products',{
        method:p.id?'PUT':'POST',
        body:JSON.stringify(payload)
      });
      closeModal();
      await loadAll();
      toast('Product saved successfully.');
    }catch(err){
      toast(err.message);
    }
  });
}

function editProduct(id){
  const p=state.products.find(x=>x.id===id);
  if(p)productForm(p);
}

async function toggleProduct(id){
  const p=state.products.find(x=>x.id===id);
  if(!p)return;

  try{
    await api('/api/products/'+id,{
      method:'PUT',
      body:JSON.stringify({
        ...p,
        is_active:!p.is_active,
        sizes:JSON.parse(p.sizes_json||'[]'),
        colors:JSON.parse(p.colors_json||'[]')
      })
    });
    await loadAll();
    toast('Product visibility updated.');
  }catch(e){
    toast(e.message);
  }
}

async function deleteProduct(id){
  if(!confirm('Permanently delete this product? Products in order history cannot be deleted.'))return;

  try{
    await api('/api/products/'+id,{method:'DELETE'});
    await loadAll();
    toast('Product deleted.');
  }catch(e){
    toast(e.message);
  }
}

function renderOrders(){
  const q=($('orderSearch')?.value||'').toLowerCase();
  const f=$('orderFilter')?.value||'all';

  const list=state.orders.filter(o=>
    (String(o.order_number)+' '+String(o.customer_name)).toLowerCase().includes(q)&&
    (f==='all'||String(o.payment_status).toLowerCase()===f)
  );

  $('ordersTable').innerHTML=table(
    ['ORDER','CUSTOMER','ORDER STATUS','PAYMENT','TOTAL','DATE','UPDATE'],
    list.map(o=>
      '<tr><td><b>'+esc(o.order_number)+'</b></td>'+
      '<td>'+esc(o.customer_name)+'</td>'+
      '<td><select style="background:#10100f;color:#eee;border:1px solid #444;padding:6px;border-radius:6px" onchange="updateOrder('+o.id+',this.value)">'+
      ['pending','processing','shipped','delivered','cancelled'].map(s=>
        '<option '+(o.status===s?'selected':'')+'>'+s+'</option>'
      ).join('')+
      '</select></td><td>'+statusBadge(o.payment_status)+'</td>'+
      '<td>'+money(o.total_ngn)+'</td><td>'+esc(o.created_at||'')+'</td>'+
      '<td><span class="muted">Payment locked</span></td></tr>'
    )
  );
}

async function updateOrder(id,status){
  try{
    await api('/api/orders/'+id,{
      method:'PATCH',
      body:JSON.stringify({status})
    });
    await loadAll();
    toast('Order status updated.');
  }catch(e){
    toast(e.message);
  }
}

function renderCustomers(){
  $('customersTable').innerHTML=table(
    ['CUSTOMER','ORDERS','PAID ORDER VALUE','LAST ORDER'],
    state.customers.map(c=>
      '<tr><td>'+esc(c.customer_name||'Unnamed customer')+'</td>'+
      '<td>'+c.order_count+'</td><td>'+money(c.paid_total_ngn)+'</td>'+
      '<td>'+esc(c.last_order||'')+'</td></tr>'
    )
  );
}

function renderExpenses(){
  $('expensesTable').innerHTML=table(
    ['DATE','DESCRIPTION','CATEGORY','AMOUNT','ACTION'],
    state.expenses.map(x=>
      '<tr><td>'+esc(x.expense_date)+'</td>'+
      '<td>'+esc(x.description)+'</td><td>'+esc(x.category)+'</td>'+
      '<td>'+money(x.amount_ngn)+'</td>'+
      '<td><button class="btn danger small" onclick="deleteExpense('+x.id+')">Delete</button></td></tr>'
    )
  );
}

function addExpense(){
  modal('Record business expense',
    '<form id="expenseForm"><div class="form-grid">'+
    '<div class="field span2"><label>Description</label><input name="description" required></div>'+
    '<div class="field"><label>Amount (NGN)</label><input name="amount_ngn" type="number" min="0" required></div>'+
    '<div class="field"><label>Category</label><input name="category" placeholder="Delivery, packaging, marketing…"></div>'+
    '<div class="field"><label>Date</label><input name="expense_date" type="date" value="'+new Date().toISOString().slice(0,10)+'"></div>'+
    '</div><div class="form-actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save expense</button></div></form>'
  );

  $('expenseForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const f=new FormData(e.target);

    try{
      await api('/api/expenses',{
        method:'POST',
        body:JSON.stringify(Object.fromEntries(f))
      });
      closeModal();
      await loadAll();
      toast('Expense recorded.');
    }catch(err){
      toast(err.message);
    }
  });
}

async function deleteExpense(id){
  if(!confirm('Delete this expense record?'))return;

  try{
    await api('/api/expenses/'+id,{method:'DELETE'});
    await loadAll();
    toast('Expense deleted.');
  }catch(e){
    toast(e.message);
  }
}

function renderComplaints(){
  $('complaintsTable').innerHTML=table(
    ['DATE','CUSTOMER','ORDER','SUBJECT','MESSAGE','STATUS'],
    state.complaints.map(c=>
      '<tr><td>'+esc(c.created_at)+'</td><td>'+esc(c.customer_name)+'</td>'+
      '<td>'+esc(c.order_number)+'</td><td>'+esc(c.subject)+'</td>'+
      '<td style="white-space:normal;min-width:200px">'+esc(c.message)+'</td>'+
      '<td><select style="background:#10100f;color:#eee;border:1px solid #444;padding:6px;border-radius:6px" onchange="updateComplaint('+c.id+',this.value)">'+
      [['open','Open'],['in_progress','In progress'],['resolved','Resolved']].map(a=>
        '<option value="'+a[0]+'" '+(c.status===a[0]?'selected':'')+'>'+a[1]+'</option>'
      ).join('')+
      '</select></td></tr>'
    )
  );
}

function addComplaint(){
  modal('Record customer complaint',
    '<form id="complaintForm"><div class="form-grid">'+
    '<div class="field"><label>Customer name</label><input name="customer_name"></div>'+
    '<div class="field"><label>Order number</label><input name="order_number"></div>'+
    '<div class="field span2"><label>Subject</label><input name="subject" required></div>'+
    '<div class="field span2"><label>Complaint details</label><textarea name="message" rows="5" required></textarea></div>'+
    '</div><div class="form-actions"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn">Save complaint</button></div></form>'
  );

  $('complaintForm').addEventListener('submit',async e=>{
    e.preventDefault();

    try{
      await api('/api/complaints',{
        method:'POST',
        body:JSON.stringify(Object.fromEntries(new FormData(e.target)))
      });
      closeModal();
      await loadAll();
      toast('Complaint recorded.');
    }catch(err){
      toast(err.message);
    }
  });
}

async function updateComplaint(id,status){
  try{
    await api('/api/complaints/'+id,{
      method:'PATCH',
      body:JSON.stringify({status})
    });
    await loadAll();
    toast('Complaint updated.');
  }catch(e){
    toast(e.message);
  }
}

function renderExchange(){
  const fx=state.fx||{};
  const r=fx.latest;

  $('fxStats').innerHTML=[
    ['CURRENT SAVED RATE',r?Number(r.rate).toLocaleString('en-US',{maximumFractionDigits:4})+' NGN':'Not available','1 USD reference value'],
    ['RATE DATE',r?.rate_date||'—','Provider date'],
    ['HISTORY POINTS',(fx.history||[]).length,'Saved daily observations'],
    ['SOURCE',r?.source||'—','Mid-market reference']
  ].map(c=>
    '<div class="stat"><div class="stat-label">'+c[0]+'</div>'+
    '<div class="stat-value" style="font-size:23px">'+c[1]+'</div>'+
    '<div class="stat-note">'+c[2]+'</div></div>'
  ).join('');

  renderChart(fx.history||[],'rateChartLarge');

  $('fxHistoryTable').innerHTML=table(
    ['DATE','USD/NGN RATE','SOURCE'],
    (fx.history||[]).slice().reverse().map(x=>
      '<tr><td>'+esc(x.rate_date)+'</td>'+
      '<td>'+Number(x.rate).toLocaleString('en-US',{maximumFractionDigits:5})+'</td>'+
      '<td>FXAPI</td></tr>'
    )
  );
}

async function refreshFx(){
  const btn=$('fxRefreshBtn');
  if(btn)btn.disabled=true;

  try{
    await api('/api/fx/refresh',{method:'POST',body:'{}'});
    const fx=await api('/api/fx');
    state.fx=fx;
    renderExchange();
    renderOverview();
    toast('Exchange rate updated.');
  }catch(e){
    toast(e.message);
  }finally{
    if(btn)btn.disabled=false;
  }
}

$('loginBtn').addEventListener('click',login);
$('loginPassword').addEventListener('keydown',e=>{
  if(e.key==='Enter')login();
});
$('logoutBtn').addEventListener('click',logout);
$('refreshBtn').addEventListener('click',loadAll);
$('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
document.querySelectorAll('.nav button').forEach(b=>
  b.addEventListener('click',()=>setPage(b.dataset.page))
);
$('addProductBtn').addEventListener('click',()=>productForm());
$('productSearch').addEventListener('input',renderProducts);
$('productFilter').addEventListener('change',renderProducts);
$('orderSearch').addEventListener('input',renderOrders);
$('orderFilter').addEventListener('change',renderOrders);
$('addExpenseBtn').addEventListener('click',addExpense);
$('addComplaintBtn').addEventListener('click',addComplaint);
$('fxRefreshBtn').addEventListener('click',refreshFx);
$('refreshBtn').addEventListener('click',loadAll);

(async()=>{
  try{
    await api('/api/me');
    showApp();
    await loadAll();
    setInterval(checkNewOrders,60000);
  }catch{
    showLogin();
  }
})();
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.DB) {
      return json({
        error: "Missing D1 binding. Add DB → kingsmade-store to this Worker."
      }, 503);
    }

    if (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin/") {
      return html(PAGE);
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url);
      } catch (error) {
        return json({
          error: error?.message || "Unexpected server error."
        }, 500);
      }
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    if (!env.DB || !env.FXAPI_KEY) return;
    await refreshRate(env);
  }
};
