var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));

// worker.js
var SESSION_COOKIE = "km_admin_session";
var SESSION_HOURS = 8;
var MAX_FAILED_LOGINS = 5;
var LOGIN_WINDOW_MS = 15 * 60 * 1000;
var authTablesReady = null;
function ensureAuthTables(env) {
 if (!authTablesReady) authTablesReady = env.DB.batch([
  env.DB.prepare("CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, attempted_at INTEGER NOT NULL)"),
  env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip, attempted_at)"),
  env.DB.prepare("CREATE TABLE IF NOT EXISTS revoked_sessions (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)")
 ]).catch(e => { authTablesReady = null; throw e; });
 return authTablesReady;
}
async function ensureCmsTables(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS hero_slides (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT '', subtitle TEXT NOT NULL DEFAULT '', media_type TEXT NOT NULL DEFAULT 'image', media_url TEXT NOT NULL DEFAULT '', poster_url TEXT NOT NULL DEFAULT '', cta_label TEXT NOT NULL DEFAULT 'Shop now', cta_url TEXT NOT NULL DEFAULT '/shop', sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS store_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS site_publications (id INTEGER PRIMARY KEY AUTOINCREMENT, content_json TEXT NOT NULL, published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
  ]);
}
__name(ensureCmsTables, "ensureCmsTables");
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
__name(json, "json");
function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
    }
  });
}
__name(html, "html");
function b64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
__name(b64url, "b64url");
function fromB64url(value) {
  const base = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base + "=".repeat((4 - base.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
__name(fromB64url, "fromB64url");
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
__name(sign, "sign");
async function safeEqual(a, b) {
 const enc=new TextEncoder();
 const [ha,hb]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(String(a))),crypto.subtle.digest("SHA-256",enc.encode(String(b)))]);
 const x=new Uint8Array(ha),y=new Uint8Array(hb);let diff=0;
 for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
__name(safeEqual,"safeEqual");
function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return "";
}
__name(getCookie, "getCookie");
async function createSession(secret) {
 const expiry=String(Date.now()+SESSION_HOURS*3600*1e3);
 const nonce=b64url(crypto.getRandomValues(new Uint8Array(18)));
 const signature=await sign(expiry+"."+nonce,secret);
 return {token:expiry+"."+nonce+"."+signature,expiry:Number(expiry),nonce};
}
__name(createSession,"createSession");
async function readSession(request,env) {
 const token=getCookie(request,SESSION_COOKIE);if(!token||!env.SESSION_SECRET)return null;
 const parts=token.split(".");if(parts.length!==3)return null;
 const [expiry,nonce,signature]=parts;
 if(!/^\d+$/.test(expiry)||!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)||!signature||Number(expiry)<=Date.now())return null;
 try{const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.SESSION_SECRET),{name:"HMAC",hash:"SHA-256"},false,["verify"]);const ok=await crypto.subtle.verify("HMAC",key,fromB64url(signature),new TextEncoder().encode(expiry+"."+nonce));return ok?{expiry:Number(expiry),nonce}:null;}catch{return null;}
}
__name(readSession,"readSession");
async function validSession(request,env) {
 const session=await readSession(request,env);if(!session)return false;
 try{await ensureAuthTables(env);const revoked=await env.DB.prepare("SELECT 1 AS hit FROM revoked_sessions WHERE nonce=? AND expires_at>=? LIMIT 1").bind(session.nonce,Date.now()).first();return !revoked;}catch{return false;}
}
__name(validSession,"validSession");
function cookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
__name(cookieHeader, "cookieHeader");
function checkOrigin(request) {
 const origin=request.headers.get("Origin");if(!origin)return false;
 try{const parsed=new URL(origin),own=new URL(request.url);return parsed.host===own.host&&parsed.protocol===own.protocol;}catch{return false;}
}
__name(checkOrigin, "checkOrigin");
async function bodyJSON(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
__name(bodyJSON, "bodyJSON");
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
__name(num, "num");
function cleanText(value, max = 5e3) {
  return String(value ?? "").trim().slice(0, max);
}
__name(cleanText, "cleanText");
async function latestRate(env) {
  return await env.DB.prepare(
    "SELECT rate, rate_date, fetched_at, source FROM exchange_rates WHERE base_currency='USD' AND quote_currency='NGN' ORDER BY rate_date DESC LIMIT 1"
  ).first();
}
__name(latestRate, "latestRate");
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
  const stamp = String(payload?.meta?.last_updated_at || (/* @__PURE__ */ new Date()).toISOString());
  const rateDate = /^\d{4}-\d{2}-\d{2}/.exec(stamp)?.[0] || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
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
    fetched_at: (/* @__PURE__ */ new Date()).toISOString(),
    source: "fxapi"
  };
}
__name(refreshRate, "refreshRate");
async function requireAuth(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return json({
      error: "SESSION_SECRET must be configured with at least 32 characters."
    }, 503);
  }
  if (!await validSession(request, env)) {
    return json({
      error: "Your session has expired. Please sign in again."
    }, 401);
  }
  return null;
}
__name(requireAuth, "requireAuth");
async function api(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (path === "/api/health" && method === "GET") {
    return json({
      ok: true,
      service: "KINGSMADE PRIVATE COMMAND CENTER",
      database: Boolean(env.DB),
      paystack_configured: Boolean(env.PAYSTACK_SECRET_KEY),
      exchange_rate_provider_configured: Boolean(env.FXAPI_KEY)
    });
  }
  if (path === "/api/login" && method === "POST") {
    if(!checkOrigin(request))return json({error:"Request origin rejected."},403);
    if(!env.ADMIN_PASSWORD||!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return json({error:"Admin secrets are not configured correctly."},503);
    const body=await bodyJSON(request);if(!body||typeof body.password!=="string"||body.password.length>256)return json({error:"Invalid credentials."},401);
    const now=Date.now(),ip=request.headers.get("CF-Connecting-IP")||"unknown";
    const ipHash=b64url(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(ip))));
    try{await ensureAuthTables(env);await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at<?").bind(now-LOGIN_WINDOW_MS).run();const attempts=await env.DB.prepare("SELECT COUNT(*) AS failures FROM login_attempts WHERE ip=? AND attempted_at>=?").bind(ipHash,now-LOGIN_WINDOW_MS).first();if(Number(attempts?.failures||0)>=MAX_FAILED_LOGINS)return json({error:"Too many failed attempts. Please wait 15 minutes and try again."},429,{"Retry-After":String(LOGIN_WINDOW_MS/1000)});}catch{return json({error:"Login is temporarily unavailable."},503);}
    if(!await safeEqual(body.password,env.ADMIN_PASSWORD)){try{await env.DB.prepare("INSERT INTO login_attempts (ip,attempted_at) VALUES (?,?)").bind(ipHash,now).run();}catch{}return json({error:"Incorrect password."},401);}
    try{await env.DB.prepare("DELETE FROM login_attempts WHERE ip=?").bind(ipHash).run();}catch{}
    const session=await createSession(env.SESSION_SECRET);return json({ok:true},200,{"Set-Cookie":cookieHeader(session.token,SESSION_HOURS*3600)});
  }
  if (path === "/api/logout" && method === "POST") {
    if(!checkOrigin(request))return json({error:"Request origin rejected."},403);
    const session=await readSession(request,env);
    if(session){try{await ensureAuthTables(env);await env.DB.batch([env.DB.prepare("DELETE FROM revoked_sessions WHERE expires_at<?").bind(Date.now()),env.DB.prepare("INSERT OR IGNORE INTO revoked_sessions (nonce,expires_at) VALUES (?,?)").bind(session.nonce,session.expiry)]);}catch{return json({error:"Could not safely revoke the session. Retry sign out."},503);}}
    return json({ok:true},200,{"Set-Cookie":cookieHeader("",0)});
  }

  if (path === "/api/storefront-content" && method === "GET") {
    await ensureCmsTables(env);
    const publication = await env.DB.prepare("SELECT content_json,published_at FROM site_publications ORDER BY id DESC LIMIT 1").first();
    if (!publication) return json({settings:{},slides:[],categories:[],published_at:null});
    try { return json({...JSON.parse(publication.content_json),published_at:publication.published_at}); }
    catch { return json({error:"Published storefront content is unavailable."},503); }
  }
  const authError = await requireAuth(request, env);
  if (authError) return authError;
  if (method !== "GET" && !checkOrigin(request)) {
    return json({ error: "Request origin rejected." }, 403);
  }

  if (path === "/api/media" && method === "POST") {
    if (!env.MEDIA) return json({error:"Media storage is not enabled yet. Enable R2 and add the MEDIA binding."},503);
    if (!(request.headers.get("Content-Type")||"").toLowerCase().startsWith("multipart/form-data;")) return json({error:"Upload must use multipart form data."},415);
    const form = await request.formData(), file = form.get("file"), folder = cleanText(form.get("folder"),30).toLowerCase();
    if (!["products","hero","categories","site"].includes(folder)) return json({error:"Invalid media folder."},400);
    if (!(file instanceof File) || !file.size) return json({error:"Choose a file to upload."},400);
    const mime=(file.type||"").toLowerCase(), images=["image/jpeg","image/png","image/webp","image/gif"], videos=["video/mp4","video/webm"];
    const isImage=images.includes(mime),isVideo=videos.includes(mime);
    if(!isImage&&!isVideo)return json({error:"Use JPG, PNG, WebP, GIF, MP4 or WebM."},415);
    if(file.size>(isVideo?50:10)*1024*1024)return json({error:isVideo?"Videos must be 50 MB or smaller.":"Images must be 10 MB or smaller."},413);
    const ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/webm":"webm"})[mime];
    const key=folder+"/"+crypto.randomUUID()+"."+ext;
    await env.MEDIA.put(key,file.stream(),{httpMetadata:{contentType:mime,cacheControl:"public, max-age=31536000, immutable"}});
    return json({ok:true,key,url:"/media/"+key,content_type:mime,size:file.size});
  }
  const mediaDeleteMatch=path.match(/^\/api\/media\/([a-z0-9-]+)\/([a-f0-9-]+)\.(jpg|png|webp|gif|mp4|webm)$/i);
  if(mediaDeleteMatch&&method==="DELETE"){
    if(!env.MEDIA)return json({error:"Media storage is not enabled."},503);
    await env.MEDIA.delete(mediaDeleteMatch[1]+"/"+mediaDeleteMatch[2]+"."+mediaDeleteMatch[3]);
    return json({ok:true});
  }
  if (path === "/api/me" && method === "GET") {
    return json({ authenticated: true });
  }
  if (path === "/api/dashboard" && method === "GET") {
    const [sales, expense, stock, orders, recent, dailySales, topProducts] = await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(total_ngn),0) AS revenue, COUNT(*) AS paid_orders FROM orders WHERE LOWER(payment_status)=?").bind("paid").first(),
      env.DB.prepare("SELECT COALESCE(SUM(amount_ngn),0) AS total FROM expenses").first(),
      env.DB.prepare("SELECT COALESCE(SUM(stock_quantity * cost_price_ngn),0) AS cost_value, COALESCE(SUM(stock_quantity * price_ngn),0) AS retail_value, COALESCE(SUM(stock_quantity),0) AS units FROM products WHERE is_active=1").first(),
      env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN LOWER(payment_status)=? THEN 1 ELSE 0 END) AS pending FROM orders").bind("pending").first(),
      env.DB.prepare("SELECT id, order_number, customer_name, status, payment_status, total_ngn, created_at FROM orders ORDER BY id DESC LIMIT 8").all(),
      env.DB.prepare("SELECT date(created_at) AS sale_date, COALESCE(SUM(total_ngn),0) AS revenue_ngn, COUNT(*) AS paid_orders FROM orders WHERE LOWER(payment_status)=? GROUP BY date(created_at) ORDER BY sale_date DESC LIMIT 30").bind("paid").all(),
      env.DB.prepare("SELECT oi.product_name, COALESCE(SUM(oi.quantity),0) AS units_sold, COALESCE(SUM(oi.subtotal_ngn),0) AS revenue_ngn FROM order_items oi INNER JOIN orders o ON o.id=oi.order_id WHERE LOWER(o.payment_status)=? GROUP BY oi.product_name ORDER BY revenue_ngn DESC LIMIT 8").bind("paid").all()
    ]);
    const cogs = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(oi.quantity * oi.unit_cost_ngn),0) AS total,
        COALESCE(SUM(CASE WHEN oi.unit_cost_ngn IS NULL OR oi.unit_cost_ngn <= 0 THEN 1 ELSE 0 END),0) AS missing_cost_lines
      FROM order_items oi
      INNER JOIN orders o ON o.id=oi.order_id
      WHERE LOWER(o.payment_status)='paid'
    `).first();
    const paidOrdersWithoutItems = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM orders o
      WHERE LOWER(o.payment_status)='paid'
        AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id=o.id)
    `).first();
    const revenue = num(sales?.revenue);
    const expenses = num(expense?.total);
    const costOfGoods = num(cogs?.total);
    const missingCostLines = num(cogs?.missing_cost_lines);
    const paidOrdersWithoutItemCount = num(paidOrdersWithoutItems?.total);
    const profitComplete = missingCostLines === 0 && paidOrdersWithoutItemCount === 0;
    return json({
      revenue_ngn: revenue,
      paid_orders: num(sales?.paid_orders),
      expenses_ngn: expenses,
      cogs_ngn: costOfGoods,
      estimated_profit_ngn: profitComplete ? revenue - costOfGoods - expenses : null,
      profit_complete: profitComplete,
      missing_cost_lines: missingCostLines,
      paid_orders_without_items: paidOrdersWithoutItemCount,
      inventory_cost_ngn: num(stock?.cost_value),
      inventory_retail_ngn: num(stock?.retail_value),
      stock_units: num(stock?.units),
      total_orders: num(orders?.total),
      pending_orders: num(orders?.pending),
      recent_orders: recent.results || [],
      daily_sales: dailySales.results || [],
      top_products: topProducts.results || [],
      profit_note: "Estimated profit = paid order revenue \u2212 recorded item costs \u2212 recorded expenses. Missing historical item costs may understate profit."
    });
  }
  if (path === "/api/fx" && method === "GET") {
    let rate=await latestRate(env);
    const fetchedAt=Date.parse(rate?.fetched_at||"");
    if(env.FXAPI_KEY&&(!rate||!Number.isFinite(fetchedAt)||Date.now()-fetchedAt>24*60*60*1000)){try{await refreshRate(env);rate=await latestRate(env);}catch{}}
    const history=await env.DB.prepare("SELECT rate_date,rate FROM exchange_rates WHERE base_currency='USD' AND quote_currency='NGN' AND rate_date>=date('now','-90 days') ORDER BY rate_date ASC").all();
    return json({latest:rate||null,history:history.results||[],update_frequency:"Daily reference rate on FXAPI Free plan"});
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
    const b=await bodyJSON(request),name=cleanText(b.name,180);if(!name)return json({error:"Product name is required."},400);
    const rate=await latestRate(env),usd=b.price_usd===""||b.price_usd==null?null:num(b.price_usd,-1);
    if(usd!==null&&(usd<0||!rate?.rate))return json({error:"A valid saved FX rate is required before saving a USD price. Refresh the exchange rate first."},400);
    const ngn=usd!==null?Math.round(usd*Number(rate.rate)):Math.max(0,Math.round(num(b.price_ngn)));
    const sizes=Array.isArray(b.sizes)?b.sizes:[],colors=Array.isArray(b.colors)?b.colors:[];
    const stock=Math.max(0,Math.round(num(b.stock_quantity))),cost=Math.max(0,Math.round(num(b.cost_price_ngn)));
    const results=await env.DB.batch([
      env.DB.prepare("INSERT INTO products (name,description,price_ngn,price_usd,category,image_url,sizes_json,colors_json,stock_quantity,is_active,cost_price_ngn,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(name,cleanText(b.description),ngn,usd,cleanText(b.category,100),cleanText(b.image_url,2000),JSON.stringify(sizes.map(x=>cleanText(x,80)).filter(Boolean)),JSON.stringify(colors.map(x=>cleanText(x,80)).filter(Boolean)),stock,b.is_active===false?0:1,cost),
      env.DB.prepare("INSERT INTO inventory_movements (product_id,movement_type,quantity,note) SELECT last_insert_rowid(),?,?,? WHERE ?>0").bind("in",stock,"Opening stock",stock)
    ]);
    return json({ok:true,id:results[0]?.meta?.last_row_id,price_ngn:ngn});
  }
  const productMatch = path.match(/^\/api\/products\/(\d+)$/);
  if (productMatch && method === "PUT") {
    const id=Number(productMatch[1]),b=await bodyJSON(request);
    const existing=await env.DB.prepare("SELECT id,stock_quantity FROM products WHERE id=?").bind(id).first();
    if(!existing)return json({error:"Product not found."},404);
    const name=cleanText(b.name,180);if(!name)return json({error:"Product name is required."},400);
    const rate=await latestRate(env),usd=b.price_usd===""||b.price_usd==null?null:num(b.price_usd,-1);
    if(usd!==null&&(usd<0||!rate?.rate))return json({error:"A valid saved FX rate is required before saving a USD price."},400);
    const ngn=usd!==null?Math.round(usd*Number(rate.rate)):Math.max(0,Math.round(num(b.price_ngn)));
    const oldStock=Math.max(0,Math.round(num(existing.stock_quantity))),newStock=b.stock_quantity===undefined?oldStock:Math.max(0,Math.round(num(b.stock_quantity,oldStock))),delta=newStock-oldStock;
    const productUpdate=env.DB.prepare("UPDATE products SET name=?,description=?,price_ngn=?,price_usd=?,category=?,image_url=?,sizes_json=?,colors_json=?,stock_quantity=?,is_active=?,cost_price_ngn=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name,cleanText(b.description),ngn,usd,cleanText(b.category,100),cleanText(b.image_url,2000),JSON.stringify(Array.isArray(b.sizes)?b.sizes.map(x=>cleanText(x,80)).filter(Boolean):[]),JSON.stringify(Array.isArray(b.colors)?b.colors.map(x=>cleanText(x,80)).filter(Boolean):[]),newStock,b.is_active===false?0:1,Math.max(0,Math.round(num(b.cost_price_ngn))),id);
    const movement=env.DB.prepare("INSERT INTO inventory_movements (product_id,movement_type,quantity,note) SELECT ?,?,?,? WHERE ?>0").bind(id,delta>=0?"in":"out",Math.abs(delta),"Stock adjusted from product editor",Math.abs(delta));
    await env.DB.batch([productUpdate,movement]);
    return json({ok:true,price_ngn:ngn,stock_quantity:newStock});
  }
  if (productMatch && method === "DELETE") {
    const id=Number(productMatch[1]);
    const result=await env.DB.prepare("UPDATE products SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    if(!result.meta?.changes)return json({error:"Product not found."},404);
    return json({ok:true,deactivated:true});
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
    const allowed = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return json({ error: "Invalid order status." }, 400);
    }
    await env.DB.prepare(
      "UPDATE orders SET status=? WHERE id=?"
    ).bind(status, Number(orderMatch[1])).run();
    return json({ ok: true });
  }
  if (path === "/api/inventory" && method === "GET") {
    const [productResult,movementResult]=await Promise.all([
      env.DB.prepare("SELECT id,name,category,price_ngn,cost_price_ngn,stock_quantity,is_active FROM products ORDER BY name COLLATE NOCASE").all(),
      env.DB.prepare("SELECT m.id,m.product_id,p.name AS product_name,m.movement_type,m.quantity,m.note,m.created_at FROM inventory_movements m LEFT JOIN products p ON p.id=m.product_id ORDER BY m.created_at DESC,m.id DESC LIMIT 100").all()
    ]);
    return json({products:productResult.results||[],movements:movementResult.results||[]});
  }
  if (path === "/api/inventory" && method === "POST") {
    const body=await bodyJSON(request),productId=Number(body?.product_id),type=body?.movement_type,quantity=Number(body?.quantity),note=cleanText(body?.note,500);
    if(!Number.isSafeInteger(productId)||productId<1||!["in","out"].includes(type)||!Number.isSafeInteger(quantity)||quantity<1||quantity>1000000)return json({error:"Choose a product, movement type, and whole quantity greater than zero."},400);
    const delta=type==="in"?quantity:-quantity;
    try {
      const results=await env.DB.batch([
        env.DB.prepare("UPDATE products SET stock_quantity=stock_quantity+?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (?=\'in\' OR stock_quantity>=?)").bind(delta,productId,type,quantity),
        env.DB.prepare("INSERT INTO inventory_movements (product_id,movement_type,quantity,note) SELECT ?,?,?,? WHERE changes()>0").bind(productId,type,quantity,note||(type==="in"?"Stock received":"Stock removed"))
      ]);
      if(!results[0]?.meta?.changes)return json({error:"Product not found or stock is insufficient for this stock-out."},400);
      if(!results[1]?.meta?.changes)return json({error:"Movement log was not saved. Inspect inventory before retrying."},500);
      return json({ok:true,product_id:productId,movement_type:type,quantity});
    } catch { return json({error:"Unable to record inventory movement."},500); }
  }
  if (path === "/api/customers" && method === "GET") {
    const result=await env.DB.prepare("SELECT MAX(customer_name) AS customer_name,MAX(customer_email) AS customer_email,MAX(customer_phone) AS customer_phone,COUNT(*) AS order_count,COALESCE(SUM(CASE WHEN LOWER(payment_status)=\'paid\' THEN total_ngn ELSE 0 END),0) AS paid_total_ngn,MAX(created_at) AS last_order FROM orders GROUP BY CASE WHEN NULLIF(TRIM(customer_email),\'\') IS NOT NULL THEN LOWER(TRIM(customer_email)) ELSE LOWER(TRIM(COALESCE(customer_name,\'\'))||\'|\'||TRIM(COALESCE(customer_phone,\'\'))) END ORDER BY last_order DESC LIMIT 300").all();
    return json({customers:result.results||[]});
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
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.expense_date || "")) ? b.expense_date : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
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
    const message = cleanText(b.message, 5e3);
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
  if (path === "/api/store-categories" && method === "GET") {
    await ensureCmsTables(env);
    const rows=await env.DB.prepare("SELECT id,name,slug,description,image_url,sort_order,is_active FROM store_categories ORDER BY sort_order,id").all();
    return json({categories:rows.results||[]});
  }
  if (path === "/api/store-categories" && method === "POST") {
    await ensureCmsTables(env);
    const b=await bodyJSON(request),name=cleanText(b.name,100);
    const slug=cleanText(b.slug,120).toLowerCase()||name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    if(!name||!slug)return json({error:"Category name is required."},400);
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return json({error:"Use a simple lowercase URL slug."},400);
    try{
      const result=await env.DB.prepare("INSERT INTO store_categories(name,slug,description,image_url,sort_order,is_active) VALUES(?,?,?,?,?,?)").bind(name,slug,cleanText(b.description,500),cleanText(b.image_url,2000),Math.max(0,Math.min(1000,Math.round(num(b.sort_order)))),b.is_active===false?0:1).run();
      return json({ok:true,id:result.meta?.last_row_id});
    }catch(e){return json({error:"That category slug already exists."},409);}
  }
  const categoryMatch=path.match(/^\/api\/store-categories\/(\d+)$/);
  if(categoryMatch&&method==="PUT"){
    await ensureCmsTables(env);
    const b=await bodyJSON(request),id=Number(categoryMatch[1]),name=cleanText(b.name,100);
    const slug=cleanText(b.slug,120).toLowerCase();
    if(!name||!slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return json({error:"A category name and valid lowercase slug are required."},400);
    try{
      const result=await env.DB.prepare("UPDATE store_categories SET name=?,slug=?,description=?,image_url=?,sort_order=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(name,slug,cleanText(b.description,500),cleanText(b.image_url,2000),Math.max(0,Math.min(1000,Math.round(num(b.sort_order)))),b.is_active===false?0:1,id).run();
      if(!result.meta?.changes)return json({error:"Category not found."},404);
      return json({ok:true});
    }catch(e){return json({error:"That category slug already exists."},409);}
  }
  if(categoryMatch&&method==="DELETE"){
    await ensureCmsTables(env);
    const result=await env.DB.prepare("UPDATE store_categories SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Number(categoryMatch[1])).run();
    if(!result.meta?.changes)return json({error:"Category not found."},404);
    return json({ok:true,deactivated:true});
  }

  if (path === "/api/site-content/history" && method === "GET") {
    await ensureCmsTables(env);
    const rows = await env.DB.prepare("SELECT id,published_at,length(content_json) AS size_bytes FROM site_publications ORDER BY id DESC LIMIT 50").all();
    return json({publications:rows.results||[]});
  }
  if (path === "/api/site-content/restore" && method === "POST") {
    await ensureCmsTables(env);
    const body = await bodyJSON(request), id = Number(body?.publication_id);
    if (!Number.isSafeInteger(id) || id < 1) return json({error:"A valid publication ID is required."},400);
    const selected = await env.DB.prepare("SELECT content_json FROM site_publications WHERE id=?").bind(id).first();
    if (!selected) return json({error:"Publication not found."},404);
    let snapshot;
    try { snapshot = JSON.parse(selected.content_json); } catch { return json({error:"That publication is damaged and cannot be restored."},422); }
    if (!snapshot || typeof snapshot !== "object" || !snapshot.settings || !Array.isArray(snapshot.slides) || !Array.isArray(snapshot.categories)) return json({error:"That publication has an unsupported format."},422);
    const statements = [
      env.DB.prepare("DELETE FROM site_settings"),
      env.DB.prepare("DELETE FROM hero_slides"),
      env.DB.prepare("DELETE FROM store_categories")
    ];
    for (const [key,value] of Object.entries(snapshot.settings)) {
      if (["brand_name","hero_title","hero_subtitle","tagline","footer_text","contact_email","instagram_url","facebook_url","x_url","storefront_theme"].includes(key))
        statements.push(env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value) VALUES(?,?)").bind(key,cleanText(value,2000)));
    }
    for (const slide of snapshot.slides) {
      statements.push(env.DB.prepare("INSERT INTO hero_slides(id,title,subtitle,media_type,media_url,poster_url,cta_label,cta_url,sort_order,is_active) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(Number(slide.id)||null,cleanText(slide.title,180),cleanText(slide.subtitle,500),slide.media_type==="video"?"video":"image",cleanText(slide.media_url,2000),cleanText(slide.poster_url,2000),cleanText(slide.cta_label,80)||"Shop now",cleanText(slide.cta_url,500)||"/shop",Math.max(0,Math.min(1000,Math.round(num(slide.sort_order)))),1));
    }
    for (const category of snapshot.categories) {
      statements.push(env.DB.prepare("INSERT INTO store_categories(id,name,slug,description,image_url,sort_order,is_active) VALUES(?,?,?,?,?,?,1)").bind(Number(category.id)||null,cleanText(category.name,100),cleanText(category.slug,120),cleanText(category.description,500),cleanText(category.image_url,2000),Math.max(0,Math.min(1000,Math.round(num(category.sort_order))))));
    }
    statements.push(env.DB.prepare("INSERT INTO site_publications(content_json) VALUES(?)").bind(JSON.stringify(snapshot)));
    await env.DB.batch(statements);
    return json({ok:true,restored_from:id});
  }
  if (path === "/api/site-content/publish" && method === "POST") {
    await ensureCmsTables(env);
    const [settings, slides, categories] = await Promise.all([
      env.DB.prepare("SELECT setting_key,setting_value FROM site_settings ORDER BY setting_key").all(),
      env.DB.prepare("SELECT id,title,subtitle,media_type,media_url,poster_url,cta_label,cta_url,sort_order,is_active FROM hero_slides WHERE is_active=1 ORDER BY sort_order,id").all(),
      env.DB.prepare("SELECT id,name,slug,description,image_url,sort_order,is_active FROM store_categories WHERE is_active=1 ORDER BY sort_order,id").all()
    ]);
    const snapshot = {settings:Object.fromEntries((settings.results||[]).map(x=>[x.setting_key,x.setting_value])),slides:slides.results||[],categories:categories.results||[]};
    const result = await env.DB.prepare("INSERT INTO site_publications(content_json) VALUES(?)").bind(JSON.stringify(snapshot)).run();
    return json({ok:true,publication_id:result.meta?.last_row_id});
  }
  if (path === "/api/site-content" && method === "GET") {
    await ensureCmsTables(env);
    const [settings, slides] = await Promise.all([
      env.DB.prepare("SELECT setting_key,setting_value FROM site_settings ORDER BY setting_key").all(),
      env.DB.prepare("SELECT id,title,subtitle,media_type,media_url,poster_url,cta_label,cta_url,sort_order,is_active FROM hero_slides ORDER BY sort_order,id").all()
    ]);
    return json({settings:Object.fromEntries((settings.results||[]).map(x=>[x.setting_key,x.setting_value])),slides:slides.results||[]});
  }
  if (path === "/api/site-settings" && method === "PUT") {
    await ensureCmsTables(env);
    const body=await bodyJSON(request), values=body?.settings;
    const allowed=["brand_name","hero_title","hero_subtitle","tagline","footer_text","contact_email","instagram_url","facebook_url","x_url","storefront_theme"];
    if(!values||typeof values!=="object"||Array.isArray(values))return json({error:"Settings object is required."},400);
    const statements=allowed.filter(k=>Object.prototype.hasOwnProperty.call(values,k)).map(k=>
      env.DB.prepare("INSERT INTO site_settings(setting_key,setting_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP").bind(k,cleanText(values[k],2000))
    );
    if(!statements.length)return json({error:"No supported settings were supplied."},400);
    await env.DB.batch(statements);
    return json({ok:true,saved:statements.length});
  }
  if (path === "/api/hero-slides" && method === "POST") {
    await ensureCmsTables(env);
    const b=await bodyJSON(request),title=cleanText(b.title,180),type=b.media_type==="video"?"video":"image",media=cleanText(b.media_url,2000);
    if(!title||!media)return json({error:"A slide title and media URL are required."},400);
    if(!/^https:\/\//i.test(media)&&!media.startsWith("/media/"))return json({error:"Use a secure HTTPS media URL or a KINGSMADE media path."},400);
    const result=await env.DB.prepare("INSERT INTO hero_slides(title,subtitle,media_type,media_url,poster_url,cta_label,cta_url,sort_order,is_active) VALUES(?,?,?,?,?,?,?,?,?)").bind(title,cleanText(b.subtitle,500),type,media,cleanText(b.poster_url,2000),cleanText(b.cta_label,80)||"Shop now",cleanText(b.cta_url,500)||"/shop",Math.max(0,Math.min(1000,Math.round(num(b.sort_order)))),b.is_active===false?0:1).run();
    return json({ok:true,id:result.meta?.last_row_id});
  }
  const slideMatch=path.match(/^\/api\/hero-slides\/(\d+)$/);
  if(slideMatch&&method==="PUT"){
    await ensureCmsTables(env);
    const b=await bodyJSON(request),id=Number(slideMatch[1]),title=cleanText(b.title,180),type=b.media_type==="video"?"video":"image",media=cleanText(b.media_url,2000);
    if(!title||!media)return json({error:"A slide title and media URL are required."},400);
    if(!/^https:\/\//i.test(media)&&!media.startsWith("/media/"))return json({error:"Use a secure HTTPS media URL or a KINGSMADE media path."},400);
    const result=await env.DB.prepare("UPDATE hero_slides SET title=?,subtitle=?,media_type=?,media_url=?,poster_url=?,cta_label=?,cta_url=?,sort_order=?,is_active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(title,cleanText(b.subtitle,500),type,media,cleanText(b.poster_url,2000),cleanText(b.cta_label,80)||"Shop now",cleanText(b.cta_url,500)||"/shop",Math.max(0,Math.min(1000,Math.round(num(b.sort_order)))),b.is_active===false?0:1,id).run();
    if(!result.meta?.changes)return json({error:"Hero slide not found."},404);
    return json({ok:true});
  }
  if(slideMatch&&method==="DELETE"){
    await ensureCmsTables(env);
    await env.DB.prepare("UPDATE hero_slides SET is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(Number(slideMatch[1])).run();
    return json({ok:true,deactivated:true});
  }
  return json({ error: "API route not found." }, 404);
}
__name(api, "api");
var _a;
var PAGE = String.raw(_a || (_a = __template([`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#111110">
<title>KINGSMADE | Private Command Center</title>
<style>
:root{--bg:#07182d;--panel:#0d2340;--panel2:#142d4c;--line:#29435f;--gold:#c8ad78;--gold2:#e0c99b;--ivory:#f4f0e8;--muted:#b7c5d6;--green:#78b99a;--red:#d77d78;--radius:15px}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(ellipse at 18% 12%,#17385a 0,transparent 42%),radial-gradient(ellipse at 84% 82%,#102b49 0,transparent 46%),var(--bg);background-size:150% 150%;animation:kmAtmosphere 28s ease-in-out infinite alternate;color:var(--ivory);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px}
@keyframes kmAtmosphere{from{background-position:0% 0%,100% 100%,0 0}to{background-position:35% 22%,65% 78%,0 0}}
@media(prefers-reduced-motion:reduce){body{animation:none}}
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
    <div class="muted" style="text-align:center;font-size:10px;margin-top:18px">SECURE PRIVATE ACCESS \xB7 CRAFT FOR KINGS</div>
  </div>
</div>

<div id="appView" class="app hidden">
  <aside class="sidebar" id="sidebar">
    <div class="side-logo">KINGSMADE</div>
    <div class="side-caption">PRIVATE COMMAND CENTER</div>
    <div class="nav-label">MANAGEMENT</div>
    <nav class="nav">
      <button class="active" data-page="overview"><span class="ico">\u25C8</span>Overview</button>
      <button data-page="products"><span class="ico">\u25C7</span>Products</button>
      <button data-page="inventory"><span class="ico">\u25A6</span>Inventory</button>
      <button data-page="orders"><span class="ico">\u25A4</span>Orders</button>
      <button data-page="customers"><span class="ico">\u2659</span>Customers</button>
      <button data-page="complaints"><span class="ico">\u2709</span>Complaints</button>
      <button data-page="expenses"><span class="ico">\u2197</span>Expenses</button>
      <button data-page="exchange"><span class="ico">\u21C4</span>Exchange rate</button>
      <button data-page="analytics"><span class="ico">\u25A7</span>Analytics</button>
      <button data-page="cms"><span class="ico">\u25A3</span>Storefront manager</button>
    </nav>
    <div class="side-bottom">
      <div class="side-user">AUTHORIZED ADMINISTRATOR</div>
      <button class="btn ghost" id="logoutBtn" style="width:100%">Sign out \u2197</button>
    </div>
  </aside>

  <main class="main">
    <header class="topbar">
      <div style="display:flex;gap:12px;align-items:center">
        <button class="btn ghost hamb" id="menuBtn">\u2630</button>
        <div>
          <h1 class="page-title" id="pageTitle">Overview</h1>
          <div class="page-sub">KINGSMADE \xB7 CRAFT FOR KINGS</div>
        </div>
      </div>
      <div class="top-actions">
        <div class="rate-pill" id="ratePill">USD/NGN \xB7 Loading\u2026</div>
        <button class="btn ghost" id="refreshBtn">\u21BB Refresh</button>
      </div>
    </header>

    <section class="section active" id="page-overview">
      <div class="grid" id="statsGrid"></div>
      <div class="two-col">
        <div class="panel">
          <h3 class="panel-title">USD / NGN \xB7 Daily reference history</h3>
          <div id="rateChart" class="chart-wrap"><div class="empty">Exchange-rate history will appear here.</div></div>
          <div class="chart-labels"><span>Daily mid-market reference rate</span><span id="chartRange">Last 90 days</span></div>
        </div>
        <div class="panel">
          <h3 class="panel-title">Financial position</h3>
          <div id="financeSummary" class="muted">Loading financial summary\u2026</div>
          <div class="notice">Profit is an estimate based on paid orders, recorded product costs and recorded expenses. It is not a substitute for reconciled accounts.</div>
        </div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Recent orders</h3>
        <div id="recentOrders"></div>
      </div>
    </section>

    <section class="section" id="page-products">
      <div class="section-head"><h2>Product collection</h2><button class="btn" id="addProductBtn">\uFF0B Add product</button></div>
      <div class="toolbar">
        <input id="productSearch" placeholder="Search products\u2026">
        <select id="productFilter">
          <option value="all">All products</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <div id="productsTable"></div>
    </section>

    <section class="section" id="page-inventory">
      <div class="section-head"><h2>Inventory control</h2></div>
      <div class="panel"><h3 class="panel-title">Record stock movement</h3>
        <form id="inventoryForm" class="form-grid">
          <div class="field"><label>Product</label><select id="inventoryProduct" required></select></div>
          <div class="field"><label>Movement</label><select id="inventoryType"><option value="in">Stock in</option><option value="out">Stock out</option></select></div>
          <div class="field"><label>Quantity</label><input id="inventoryQuantity" type="number" min="1" step="1" required></div>
          <div class="field"><label>Reason / note</label><input id="inventoryNote" maxlength="500" placeholder="New delivery, damaged item, etc."></div>
          <div class="span2 form-actions"><button class="btn" id="saveMovement" type="submit">Record movement</button><span id="inventoryMessage" class="muted"></span></div>
        </form>
      </div>
      <div class="panel" style="margin-top:16px"><h3 class="panel-title">Current stock</h3><div id="inventoryProducts"></div></div>
      <div class="panel" style="margin-top:16px"><h3 class="panel-title">Recent stock history</h3><div id="inventoryMovements"></div></div>
      <div class="notice">Stock movements are recorded in the inventory ledger. Payment status is controlled by verified Paystack callbacks and cannot be manually marked paid here.</div>
    </section>
    <section class="section" id="page-orders">
      <div class="section-head"><h2>Order management</h2></div>
      <div class="toolbar">
        <input id="orderSearch" placeholder="Search order or customer\u2026">
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
      <div class="notice">Customer email and phone are shown only when those details were provided at checkout.</div>
    </section>

    <section class="section" id="page-complaints">
      <div class="section-head"><h2>Customer complaints</h2><button class="btn" id="addComplaintBtn">\uFF0B Record complaint</button></div>
      <div id="complaintsTable"></div>
    </section>

    <section class="section" id="page-expenses">
      <div class="section-head"><h2>Business expenses</h2><button class="btn" id="addExpenseBtn">\uFF0B Add expense</button></div>
      <div id="expensesTable"></div>
    </section>

    <section class="section" id="page-analytics">
      <div class="section-head"><h2>Business analytics</h2></div>
      <div class="grid" id="analyticsStats"></div>
      <div class="two-col"><div class="panel"><h3 class="panel-title">Daily paid sales</h3><div id="dailySalesTable"></div></div>
      <div class="panel"><h3 class="panel-title">Best-selling products</h3><div id="topProductsTable"></div></div></div>
      <div class="notice">Analytics use verified paid orders and order-item records only. Pending and failed payments are excluded.</div>
    </section>
    <section class="section" id="page-cms">
      <div class="section-head"><h2>Storefront content</h2><div class="form-actions"><button class="btn ghost" id="cmsReloadBtn" type="button">Refresh content</button><button class="btn" id="publishSiteBtn" type="button">Publish storefront</button></div></div>
      <div class="notice">Edits are drafts until you publish. Publishing sends the saved text, active hero slides and active categories to the storefront. Media upload is still pending R2 setup; these fields currently accept secure media URLs.</div>
      <p id="publishStatus" class="muted" aria-live="polite"></p>
      <div class="panel" style="margin-top:16px"><h3 class="panel-title">Publication history</h3><p class="muted">Restore a previous published version. Restoring creates a new publication and replaces the current editable CMS content.</p><div id="publicationHistory"></div></div>
      <div class="panel">
        <h3 class="panel-title">Brand and storefront text</h3>
        <form id="siteSettingsForm" class="form-grid">
          <div class="field"><label>Brand name</label><input name="brand_name" maxlength="120"></div>
          <div class="field"><label>Hero title</label><input name="hero_title" maxlength="180"></div>
          <div class="field"><label>Hero subtitle</label><input name="hero_subtitle" maxlength="300"></div>
          <div class="field"><label>Tagline</label><input name="tagline" maxlength="300"></div>
          <div class="field span2"><label>Footer text</label><input name="footer_text" maxlength="500"></div>
          <div class="field"><label>Contact email</label><input name="contact_email" type="email" maxlength="180"></div>
          <div class="field"><label>Storefront theme</label><input name="storefront_theme" placeholder="Ivory, midnight navy, champagne gold"></div>
          <div class="field"><label>Instagram URL</label><input name="instagram_url" type="url"></div>
          <div class="field"><label>Facebook URL</label><input name="facebook_url" type="url"></div>
          <div class="field"><label>X URL</label><input name="x_url" type="url"></div>
          <div class="span2 form-actions"><button class="btn" type="submit">Save storefront text</button><span id="cmsSettingsMessage" class="muted"></span></div>
        </form>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Hero slide manager</h3>
        <form id="heroSlideForm" class="form-grid">
          <div class="field"><label>Slide title</label><input name="title" maxlength="180" required></div>
          <div class="field"><label>Subtitle</label><input name="subtitle" maxlength="500"></div>
          <div class="field"><label>Media type</label><select name="media_type"><option value="image">Image</option><option value="video">Video</option></select></div>
          <div class="field"><label>Media URL (temporary)</label><input name="media_url" type="url" placeholder="https://…" required></div>
          <div class="field"><label>Video poster URL</label><input name="poster_url" type="url"></div>
          <div class="field"><label>Button label</label><input name="cta_label" value="Shop now"></div>
          <div class="field"><label>Button destination</label><input name="cta_url" value="/shop"></div>
          <div class="field"><label>Display order</label><input name="sort_order" type="number" min="0" step="1" value="0"></div>
          <div class="span2 form-actions"><button class="btn" type="submit">Add hero slide</button><span id="heroSlideMessage" class="muted"></span></div>
        </form>
        <div id="heroSlidesTable" style="margin-top:18px"></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Store categories</h3>
        <p class="muted">Manage category names, descriptions, images and order. Storefront display and product assignment still need the integration pass.</p>
        <form id="storeCategoryForm" class="form-grid">
          <div class="field"><label>Category name</label><input name="name" maxlength="100" required placeholder="Traditional wear"></div>
          <div class="field"><label>URL slug</label><input name="slug" maxlength="120" placeholder="traditional-wear"></div>
          <div class="field"><label>Description</label><input name="description" maxlength="500"></div>
          <div class="field"><label>Category image URL (temporary)</label><input name="image_url" type="url"></div>
          <div class="field"><label>Display order</label><input name="sort_order" type="number" min="0" value="0"></div>
          <div class="span2 form-actions"><button class="btn" type="submit">Add category</button><span id="categoryMessage" class="muted"></span></div>
        </form>
        <div id="storeCategoriesTable" style="margin-top:18px"></div>
      </div>
    </section>
    <section class="section" id="page-exchange">
      <div class="section-head"><h2>Exchange-rate intelligence</h2><button class="btn" id="fxRefreshBtn">\u21BB Update rate</button></div>
      <div class="grid" id="fxStats"></div>
      <div class="panel" style="margin-top:16px">
        <h3 class="panel-title">Daily USD/NGN history</h3>
        <div id="rateChartLarge" class="chart-wrap"></div>
        <div class="chart-labels"><span>FXAPI mid-market reference data</span><span>Daily updates \xB7 Free plan</span></div>
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
let state={products:[],orders:[],customers:[],complaints:[],expenses:[],inventory:{products:[],movements:[]},dashboard:null,fx:null,siteContent:{settings:{},slides:[]},page:'overview'};
let seenOrderIds=new Set();
let orderPollingReady=false;

const money=n=>'\u20A6'+Number(n||0).toLocaleString('en-NG',{maximumFractionDigits:0});
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
    exchange:'Exchange rate',
    inventory:'Inventory control',
    analytics:'Business analytics',
    cms:'Storefront manager'
  })[page]||'Overview';

  $('sidebar').classList.remove('open');

  if(page==='products')renderProducts();
  if(page==='orders')renderOrders();
  if(page==='customers')renderCustomers();
  if(page==='complaints')renderComplaints();
  if(page==='expenses')renderExpenses();
  if(page==='exchange')renderExchange();
  if(page==='inventory')renderInventory();
  if(page==='analytics')renderAnalytics();
  if(page==='cms')loadSiteContent();
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
    const [d,p,o,c,x,co,fx,inv,site]=await Promise.all([
      api('/api/dashboard'),api('/api/products'),api('/api/orders'),api('/api/customers'),
      api('/api/expenses'),api('/api/complaints'),api('/api/fx'),api('/api/inventory'),api('/api/site-content')
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
    state.inventory=inv||{products:[],movements:[]};
    state.siteContent=site||{settings:{},slides:[]};

    renderOverview();
    renderProducts();
    renderInventory();
    renderAnalytics();
  }catch(e){
    toast(e.message);
  }
}


async function loadPublicationHistory(){
  try{
    const data=await api('/api/site-content/history');
    const rows=data.publications||[];
    $('publicationHistory').innerHTML=rows.length?table(['VERSION','PUBLISHED','SIZE','ACTION'],rows.map(item=>
      '<tr><td>#'+Number(item.id)+'</td><td>'+esc(item.published_at)+'</td><td>'+Math.max(1,Math.round(Number(item.size_bytes||0)/1024))+' KB</td><td><button class="btn ghost small" onclick="restorePublication('+Number(item.id)+')">Restore</button></td></tr>'
    )):'<p class="muted">No published versions yet.</p>';
  }catch(e){$('publicationHistory').textContent=e.message;}
}
async function restorePublication(id){
  if(!confirm('Restore publication #'+id+'? This replaces current CMS edits and publishes that version again.'))return;
  try{
    await api('/api/site-content/restore',{method:'POST',body:JSON.stringify({publication_id:id})});
    await loadSiteContent();
    toast('Previous version restored and published.');
  }catch(e){toast(e.message);}
}
async function loadSiteContent(){
  try{
    const data=await api('/api/site-content');
    state.siteContent=data;
    const form=$('siteSettingsForm');
    if(form)for(const [key,value] of Object.entries(data.settings||{})){if(form.elements[key])form.elements[key].value=value;}
    renderHeroSlides();\n    await loadStoreCategories();\n    await loadPublicationHistory();
  }catch(e){toast(e.message);}
}
function renderHeroSlides(){
  const slides=state.siteContent?.slides||[];
  $('heroSlidesTable').innerHTML=table(['ORDER','TITLE','TYPE','MEDIA','STATUS','ACTION'],slides.map(s=>
    '<tr><td>'+Number(s.sort_order)+'</td><td>'+esc(s.title)+'</td><td>'+esc(s.media_type)+'</td><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">'+esc(s.media_url)+'</td><td>'+statusBadge(Number(s.is_active)===1?'active':'inactive')+'</td><td><div class="actions"><button class="btn ghost small" onclick="editHeroSlide('+Number(s.id)+')">Edit</button><button class="btn danger small" onclick="archiveHeroSlide('+Number(s.id)+')">Hide</button></div></td></tr>'
  ));
}
async function loadStoreCategories(){
  try{
    const data=await api('/api/store-categories');
    state.siteContent.categories=data.categories||[];
    $('storeCategoriesTable').innerHTML=table(['ORDER','CATEGORY','SLUG','IMAGE','STATUS','ACTION'],state.siteContent.categories.map(s=>
      '<tr><td>'+Number(s.sort_order)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.slug)+'</td><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis">'+esc(s.image_url||'—')+'</td><td>'+statusBadge(Number(s.is_active)===1?'active':'inactive')+'</td><td><div class="actions"><button class="btn ghost small" onclick="editStoreCategory('+Number(s.id)+')">Edit</button><button class="btn danger small" onclick="archiveStoreCategory('+Number(s.id)+')">Hide</button></div></td></tr>'
    ));
  }catch(e){$('storeCategoriesTable').textContent=e.message;}
}
async function editStoreCategory(id){
  const s=(state.siteContent?.categories||[]).find(x=>Number(x.id)===Number(id));if(!s)return;
  const name=prompt('Category name',s.name);if(name===null)return;
  const slug=prompt('URL slug',s.slug);if(slug===null)return;
  const description=prompt('Description',s.description||'');if(description===null)return;
  const image_url=prompt('Image URL',s.image_url||'');if(image_url===null)return;
  const sort_order=prompt('Display order',String(s.sort_order??0));if(sort_order===null)return;
  try{await api('/api/store-categories/'+id,{method:'PUT',body:JSON.stringify({...s,name,slug,description,image_url,sort_order:Number(sort_order)})});await loadStoreCategories();toast('Category updated.');}
  catch(e){toast(e.message);}
}
async function archiveStoreCategory(id){
  if(!confirm('Hide this category?'))return;
  try{await api('/api/store-categories/'+id,{method:'DELETE'});await loadStoreCategories();toast('Category hidden.');}catch(e){toast(e.message);}
}
async function editHeroSlide(id){
  const s=(state.siteContent?.slides||[]).find(x=>Number(x.id)===Number(id));
  if(!s)return;
  const title=prompt('Slide title',s.title);if(title===null)return;
  const subtitle=prompt('Slide subtitle',s.subtitle||'');if(subtitle===null)return;
  const media_type=prompt('Media type: image or video',s.media_type||'image');if(media_type===null)return;
  const media_url=prompt('Secure media URL',s.media_url||'');if(media_url===null)return;
  const poster_url=prompt('Video poster URL (leave blank if not needed)',s.poster_url||'');if(poster_url===null)return;
  const cta_label=prompt('Button label',s.cta_label||'Shop now');if(cta_label===null)return;
  const cta_url=prompt('Button destination',s.cta_url||'/shop');if(cta_url===null)return;
  const sort_order=prompt('Display order',String(s.sort_order??0));if(sort_order===null)return;
  try{
    await api('/api/hero-slides/'+id,{method:'PUT',body:JSON.stringify({...s,title,subtitle,media_type,media_url,poster_url,cta_label,cta_url,sort_order:Number(sort_order)})});
    await loadSiteContent();toast('Hero slide updated.');
  }catch(e){toast(e.message);}
}
async function archiveHeroSlide(id){
  if(!confirm('Hide this hero slide?'))return;
  try{await api('/api/hero-slides/'+id,{method:'DELETE'});await loadSiteContent();toast('Hero slide hidden.');}catch(e){toast(e.message);}
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
    ['ESTIMATED PROFIT',d.profit_complete?money(d.estimated_profit_ngn):'Incomplete',d.profit_complete?'After recorded costs and expenses':(Number(d.missing_cost_lines||0)+' item lines missing cost')],
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
    (d.profit_complete?(d.estimated_profit_ngn>=0?'profit-positive':'profit-negative'):'muted')+'">'+
    (d.profit_complete?money(d.estimated_profit_ngn):'Incomplete — cost data missing')+'</b></div>';

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
    ?'USD/NGN \xB7 '+Number(r.rate).toLocaleString('en-US',{maximumFractionDigits:2})
    :'USD/NGN \xB7 Not loaded';
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
    (p.name+' '+p.category+' '+(p.description||'')).toLowerCase().includes(q)&&
    (f==='all'||(f==='active'?p.is_active:!p.is_active))
  );

  $('productsTable').innerHTML=table(
    ['PRODUCT','CATEGORY','USD PRICE','NGN PRICE','UNIT COST','STOCK','STATUS','ACTIONS'],
    list.map(p=>
      '<tr><td><b>'+esc(p.name)+'</b><div class="muted">#'+p.id+'</div></td>'+
      '<td>'+esc(p.category)+'</td>'+
      '<td>'+(p.price_usd==null?'\u2014':usd(p.price_usd))+'</td>'+
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
    '<button class="btn ghost small" onclick="closeModal()">\u2715</button></div>'+
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
    '<div class="field"><label>Category</label><input name="category" value="'+esc(p.category||'')+'" placeholder="Menswear, accessories\u2026"></div>'+
    '<div class="field"><label>USD selling price</label><input name="price_usd" type="number" min="0" step="0.01" value="'+(p.price_usd??'')+'" placeholder="e.g. 45.00"></div>'+
    '<div class="field"><label>NGN selling price (converted)</label><input name="price_ngn" type="number" min="0" value="'+(p.price_ngn||0)+'" readonly></div>'+
    '<div class="field"><label>Unit cost (NGN)</label><input name="cost_price_ngn" type="number" min="0" value="'+(p.cost_price_ngn||0)+'"></div>'+
    '<div class="field"><label>Stock quantity</label><input name="stock_quantity" type="number" min="0" value="'+(p.stock_quantity||0)+'"></div>'+
    '<div class="field"><label>Sizes (comma separated)</label><input name="sizes" value="'+esc(sizes)+'" placeholder="S, M, L, XL"></div>'+
    '<div class="field"><label>Colours (comma separated)</label><input name="colors" value="'+esc(colors)+'" placeholder="Black, White"></div>'+
    '<div class="field span2"><label>Image URL</label><input name="image_url" value="'+esc(p.image_url||'')+'" placeholder="https://\u2026"></div>'+
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
  if(!confirm('Archive this product? It will be hidden while order and stock history are preserved.'))return;

  try{
    await api('/api/products/'+id,{method:'DELETE'});
    await loadAll();
    toast('Product archived and hidden from the store.');
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
      ['pending','confirmed','processing','shipped','delivered','cancelled'].map(s=>
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
 $('customersTable').innerHTML=table(['CUSTOMER','EMAIL','PHONE','ORDERS','PAID ORDER VALUE','LAST ORDER'],state.customers.map(c=>'<tr><td>'+esc(c.customer_name||'Unnamed customer')+'</td><td>'+esc(c.customer_email||'—')+'</td><td>'+esc(c.customer_phone||'—')+'</td><td>'+Number(c.order_count||0)+'</td><td>'+money(c.paid_total_ngn)+'</td><td>'+esc(c.last_order||'')+'</td></tr>'));
}
function renderInventory(){
 const products=state.inventory?.products||[],movements=state.inventory?.movements||[],select=$('inventoryProduct');
 if(select){const selected=select.value;select.innerHTML=products.map(p=>'<option value='+Number(p.id)+'>'+esc(p.name)+' · '+Number(p.stock_quantity)+' in stock</option>').join('');if(products.some(p=>String(p.id)===selected))select.value=selected;}
 $('inventoryProducts').innerHTML=table(['PRODUCT','CATEGORY','STOCK','UNIT COST','RETAIL VALUE','STATUS'],products.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+esc(p.category||'—')+'</td><td>'+Number(p.stock_quantity||0)+'</td><td>'+money(p.cost_price_ngn)+'</td><td>'+money(Number(p.price_ngn||0)*Number(p.stock_quantity||0))+'</td><td>'+statusBadge(Number(p.is_active)===1?'active':'inactive')+'</td></tr>'));
 $('inventoryMovements').innerHTML=table(['DATE','PRODUCT','MOVEMENT','QUANTITY','NOTE'],movements.map(m=>'<tr><td>'+esc(m.created_at||'')+'</td><td>'+esc(m.product_name||('Product #'+m.product_id))+'</td><td>'+statusBadge(m.movement_type)+'</td><td>'+Number(m.quantity||0)+'</td><td>'+esc(m.note||'—')+'</td></tr>'));
}
function renderAnalytics(){
 const d=state.dashboard||{},daily=d.daily_sales||[],top=d.top_products||[];
 const low=state.products.filter(p=>Number(p.is_active)===1&&Number(p.stock_quantity)<=5).length;
 $('analyticsStats').innerHTML=[['PAID REVENUE',money(d.revenue_ngn),'Confirmed paid orders'],['ESTIMATED PROFIT',money(d.estimated_profit_ngn),'After recorded costs and expenses'],['LOW-STOCK PRODUCTS',String(low),'Five units or fewer'],['UNITS IN STOCK',Number(d.stock_units||0).toLocaleString(),'Active catalogue inventory']].map(c=>'<div class=stat><div class=stat-label>'+c[0]+'</div><div class=stat-value>'+c[1]+'</div><div class=stat-note>'+c[2]+'</div></div>').join('');
 $('dailySalesTable').innerHTML=table(['DATE','PAID ORDERS','REVENUE'],daily.map(x=>'<tr><td>'+esc(x.sale_date||'')+'</td><td>'+Number(x.paid_orders||0)+'</td><td>'+money(x.revenue_ngn)+'</td></tr>'));
 $('topProductsTable').innerHTML=table(['PRODUCT','UNITS SOLD','PAID REVENUE'],top.map(x=>'<tr><td>'+esc(x.product_name||'Product')+'</td><td>'+Number(x.units_sold||0)+'</td><td>'+money(x.revenue_ngn)+'</td></tr>'));
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
    '<div class="field"><label>Category</label><input name="category" placeholder="Delivery, packaging, marketing\u2026"></div>'+
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
    ['RATE DATE',r?.rate_date||'\u2014','Provider date'],
    ['HISTORY POINTS',(fx.history||[]).length,'Saved daily observations'],
    ['SOURCE',r?.source||'\u2014','Mid-market reference']
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
$('storeCategoryForm').addEventListener('submit',async e=>{
  e.preventDefault();const values=Object.fromEntries(new FormData(e.target));
  try{await api('/api/store-categories',{method:'POST',body:JSON.stringify(values)});e.target.reset();e.target.elements.sort_order.value='0';$('categoryMessage').textContent='Category saved.';await loadStoreCategories();toast('Category added.');}
  catch(err){$('categoryMessage').textContent=err.message;}
});
$('cmsReloadBtn').addEventListener('click',loadSiteContent);\n$('publishSiteBtn').addEventListener('click',async()=>{
$('publishSiteBtn').addEventListener('click',async()=>{
  const button=$('publishSiteBtn');
  if(!confirm('Publish the current saved storefront content now?'))return;
  button.disabled=true;$('publishStatus').textContent='Publishing…';
  try{
    const result=await api('/api/site-content/publish',{method:'POST',body:'{}'});
    $('publishStatus').textContent='Published successfully. Publication #'+result.publication_id;
    toast('Storefront content published.');
  }catch(error){$('publishStatus').textContent='Publish failed: '+error.message;}
  finally{button.disabled=false;}
});
$('siteSettingsForm').addEventListener('submit',async e=>{
  e.preventDefault();const values=Object.fromEntries(new FormData(e.target));
  try{await api('/api/site-settings',{method:'PUT',body:JSON.stringify({settings:values})});$('cmsSettingsMessage').textContent='Saved securely.';await loadSiteContent();toast('Storefront text saved.');}
  catch(err){$('cmsSettingsMessage').textContent=err.message;}
});
$('heroSlideForm').addEventListener('submit',async e=>{
  e.preventDefault();const values=Object.fromEntries(new FormData(e.target));
  try{await api('/api/hero-slides',{method:'POST',body:JSON.stringify(values)});e.target.reset();e.target.elements.cta_label.value='Shop now';e.target.elements.cta_url.value='/shop';e.target.elements.sort_order.value='0';await loadSiteContent();toast('Hero slide added.');}
  catch(err){$('heroSlideMessage').textContent=err.message;}
});

$('refreshBtn').addEventListener('click',loadAll);
$('inventoryForm').addEventListener('submit',async e=>{
 e.preventDefault();const button=$('saveMovement'),product_id=Number($('inventoryProduct').value),quantity=Number($('inventoryQuantity').value),movement_type=$('inventoryType').value,note=$('inventoryNote').value.trim();
 if(!Number.isSafeInteger(product_id)||product_id<1||!Number.isSafeInteger(quantity)||quantity<1){$('inventoryMessage').textContent='Select a product and enter a whole quantity greater than zero.';return;}
 button.disabled=true;$('inventoryMessage').textContent='Recording movement…';
 try{await api('/api/inventory',{method:'POST',body:JSON.stringify({product_id,movement_type,quantity,note})});$('inventoryQuantity').value='';$('inventoryNote').value='';await loadAll();$('inventoryMessage').textContent='Stock movement recorded.';}
 catch(error){$('inventoryMessage').textContent=error.message;}finally{button.disabled=false;}
});

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
<\/script>
</body>
</html>`])));
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.DB) {
      return json({
        error: "Missing D1 binding. Add DB \u2192 kingsmade-store to this Worker."
      }, 503);
    }
    if (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin/") {
      return html(PAGE);
    }

    if (url.pathname.startsWith("/media/")) {
      if (!env.MEDIA) return new Response("Media storage is not enabled.",{status:503});
      const key=url.pathname.slice(7);
      if(!/^(products|hero|categories|site)\/[a-f0-9-]+\.(jpg|png|webp|gif|mp4|webm)$/i.test(key))return new Response("Not found",{status:404});
      const object=await env.MEDIA.get(key);
      if(!object)return new Response("Not found",{status:404});
      const headers=new Headers();object.writeHttpMetadata(headers);headers.set("ETag",object.httpEtag);headers.set("X-Content-Type-Options","nosniff");headers.set("Cache-Control","public, max-age=31536000, immutable");
      return new Response(object.body,{headers});
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
    if (!env.DB || !env.FXAPI_KEY) {
      console.warn(JSON.stringify({event:"fx_refresh_skipped",reason:"missing_binding_or_key"}));
      return;
    }
    try {
      const latest = await refreshRate(env);
      console.log(JSON.stringify({event:"fx_refresh_succeeded",rate_date:latest.rate_date,source:latest.source}));
    } catch (error) {
      console.error(JSON.stringify({event:"fx_refresh_failed",message:String(error?.message||"unknown error")}));
      throw error;
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map