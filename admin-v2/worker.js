const COOKIE = "km_admin_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
let schemaPromise;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function page(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    }
  });
}

function originAllowed(request) {
  const own = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin) {
    try { const value = new URL(origin); return value.origin === own.origin; } catch { return false; }
  }
  const referer = request.headers.get("Referer");
  if (referer) {
    try { const value = new URL(referer); return value.origin === own.origin; } catch { return false; }
  }
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

async function ensureSchema(env) {
  if (!schemaPromise) {
    schemaPromise = env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT NOT NULL, attempted_at INTEGER NOT NULL)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_login_attempts_hash_time ON login_attempts(ip_hash, attempted_at)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS revoked_sessions (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)")
    ]).catch(error => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromB64url(value) {
  const base = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base + "=".repeat((4 - base.length % 4) % 4)), c => c.charCodeAt(0));
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function equalSecret(a, b) {
  const [left, right] = await Promise.all([digest(String(a)), digest(String(b))]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

async function createSession(secret) {
  const expiry = String(Date.now() + SESSION_MS);
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(18)));
  return { token: expiry + "." + nonce + "." + await sign(expiry + "." + nonce, secret), expiry: Number(expiry), nonce };
}

function readCookie(request) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const index = part.indexOf("=");
    if (index > -1 && part.slice(0, index).trim() === COOKIE) return part.slice(index + 1).trim();
  }
  return "";
}

async function readSession(request, env) {
  const token = readCookie(request);
  if (!token || !env.SESSION_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiry, nonce, signature] = parts;
  if (!/^\d+$/.test(expiry) || Number(expiry) <= Date.now()) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(signature), new TextEncoder().encode(expiry + "." + nonce));
    return valid ? { expiry: Number(expiry), nonce } : null;
  } catch { return null; }
}

async function authenticated(request, env) {
  const session = await readSession(request, env);
  if (!session) return false;
  await ensureSchema(env);
  const revoked = await env.DB.prepare("SELECT 1 AS hit FROM revoked_sessions WHERE nonce=? AND expires_at>=?").bind(session.nonce, Date.now()).first();
  return !revoked;
}

function cookie(value, age) {
  return COOKIE + "=" + value + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + age;
}

const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b1426">
<title>KINGSMADE | Private Command Center</title>
<style>
:root{color-scheme:dark;--navy:#0b1426;--panel:#111f36;--panel2:#162640;--gold:#d6b878;--muted:#a8b1c1;--line:#293b55;--white:#f4f2ed}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 20% 0%,#1a2b46 0%,var(--navy) 54%);color:var(--white);font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}
button,input{font:inherit}.screen{min-height:100vh;display:grid;place-items:center;padding:24px}.login{width:min(100%,430px);padding:38px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,rgba(22,38,64,.97),rgba(12,22,39,.98));box-shadow:0 28px 90px #0008}
.brand{color:var(--gold);font-family:Georgia,serif;letter-spacing:.22em;text-align:center;font-size:25px}.sub{text-align:center;color:var(--muted);font-size:11px;letter-spacing:.22em;margin:8px 0 34px}
h1{font-size:18px;letter-spacing:.12em;text-align:center;margin:0 0 8px}.hint{text-align:center;color:var(--muted);font-size:12px;margin:0 0 28px}
label{display:block;font-size:11px;letter-spacing:.16em;color:#c9d0db;margin:0 0 9px}input{width:100%;border:1px solid #40516a;border-radius:9px;background:#0a1527;color:white;padding:14px;outline:none}input:focus{border-color:var(--gold);box-shadow:0 0 0 3px #d6b87822}
button{width:100%;border:0;border-radius:9px;padding:14px;margin-top:18px;background:linear-gradient(110deg,#b89553,#e1ca91);color:#101a2b;font-weight:800;letter-spacing:.1em;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
.error{min-height:22px;color:#ff9b9b;font-size:12px;margin-top:13px;text-align:center}.foot{text-align:center;color:#7f8da2;font-size:10px;letter-spacing:.16em;margin-top:24px}
.app{display:none;min-height:100vh}.sidebar{position:fixed;inset:0 auto 0 0;width:245px;padding:28px 18px;background:#091222;border-right:1px solid var(--line)}.sidebrand{font:20px Georgia,serif;letter-spacing:.2em;color:var(--gold);padding:0 12px 34px}.side-label{color:#6f7e94;font-size:10px;letter-spacing:.18em;padding:0 12px 12px}.nav{display:grid;gap:7px}.nav span{padding:12px;border-radius:8px;color:#c1c9d5;font-size:13px}.nav span:first-child{background:#1a2b45;color:var(--gold);border:1px solid #33445e}
.main{margin-left:245px;padding:30px;max-width:1600px}.top{display:flex;justify-content:space-between;align-items:center;gap:18px;border-bottom:1px solid var(--line);padding-bottom:22px}.eyebrow{font-size:10px;color:var(--gold);letter-spacing:.2em}.top h2{font:24px Georgia,serif;margin:5px 0}.status{font-size:11px;color:#a8d4ae;border:1px solid #315a43;padding:7px 11px;border-radius:30px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:24px 0}.card,.panel{background:linear-gradient(145deg,#14243b,#101d31);border:1px solid var(--line);border-radius:12px;padding:18px}.card small{color:var(--muted);font-size:10px;letter-spacing:.12em}.card strong{display:block;font:26px Georgia,serif;color:var(--gold);margin-top:9px}.grid{display:grid;grid-template-columns:1.4fr 1fr;gap:14px}.panel h3{font:18px Georgia,serif;margin:0 0 8px}.panel p{color:var(--muted);font-size:13px;margin:0}.placeholder{height:190px;border:1px dashed #40516a;border-radius:8px;margin-top:16px;display:grid;place-items:center;color:#8998ac;font-size:12px}
@media(max-width:900px){.sidebar{position:static;width:auto;height:auto;padding:16px}.sidebrand{padding:0 6px 14px}.nav{display:flex;overflow:auto}.nav span{white-space:nowrap}.side-label{display:none}.main{margin:0;padding:18px}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.grid{grid-template-columns:1fr}}
@media(max-width:480px){.login{padding:28px 22px}.top{align-items:flex-start;flex-direction:column}.cards{gap:9px}.card{padding:13px}.card strong{font-size:22px}}
</style>
</head>
<body>
<section class="screen" id="loginScreen"><div class="login">
<div class="brand">KINGSMADE</div><div class="sub">PRIVATE COMMAND CENTER</div>
<h1>ADMINISTRATOR ACCESS</h1><p class="hint">Sign in to manage your business securely.</p>
<form id="loginForm"><label for="password">ACCESS PASSWORD</label><input id="password" type="password" autocomplete="current-password" required maxlength="256">
<button id="loginButton" type="submit">ENTER COMMAND CENTER</button><div class="error" id="loginError" role="alert" aria-live="polite"></div></form>
<div class="foot">SECURE PRIVATE ACCESS · CRAFT FOR KINGS</div>
</div></section>
<div class="app" id="app">
<aside class="sidebar"><div class="sidebrand">KINGSMADE</div><div class="side-label">COMMAND CENTER</div><nav class="nav"><span>Overview</span><span>Products</span><span>Orders</span><span>Inventory</span><span>Customers</span><span>Store Editor</span><span>Settings</span></nav></aside>
<main class="main"><header class="top"><div><div class="eyebrow">PRIVATE COMMAND CENTER</div><h2>Business Overview</h2></div><div class="status">SECURE SESSION ACTIVE</div></header>
<section class="cards"><div class="card"><small>TOTAL REVENUE</small><strong>—</strong></div><div class="card"><small>NET PROFIT</small><strong>—</strong></div><div class="card"><small>ORDERS</small><strong>—</strong></div><div class="card"><small>STOCK UNITS</small><strong>—</strong></div></section>
<section class="grid"><div class="panel"><h3>Performance</h3><p>Sales and business performance will appear here once the dashboard modules are connected.</p><div class="placeholder">Chart module — foundation stage</div></div><div class="panel"><h3>System status</h3><p id="systemStatus">Checking secure services…</p><div class="placeholder">Dashboard modules will be added and tested one at a time.</div><button id="logoutButton" type="button">SIGN OUT</button></div></section>
</main></div>
<script>
(function(){
 const form=document.getElementById("loginForm");
 const input=document.getElementById("password");
 const button=document.getElementById("loginButton");
 const error=document.getElementById("loginError");
 const loginScreen=document.getElementById("loginScreen");
 const app=document.getElementById("app");
 function showApp(){loginScreen.style.display="none";app.style.display="block";}
 async function checkSession(){
  try{const response=await fetch("/api/me",{credentials:"same-origin"});if(response.ok)showApp();}
  catch(e){}
 }
 form.addEventListener("submit",async function(event){
  event.preventDefault();error.textContent="";
  if(!input.value){error.textContent="Enter your access password.";return;}
  button.disabled=true;button.textContent="VERIFYING ACCESS…";
  try{
   const response=await fetch("/api/login",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:input.value})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Sign-in failed.");
   input.value="";showApp();
   document.getElementById("systemStatus").textContent="Secure login verified. Database connection is active.";
  }catch(e){error.textContent=e.message||"Unable to sign in. Please try again.";}
  finally{button.disabled=false;button.textContent="ENTER COMMAND CENTER";}
 });
 document.getElementById("logoutButton").addEventListener("click",async function(){
  try{await fetch("/api/logout",{method:"POST",credentials:"same-origin"});}finally{app.style.display="none";loginScreen.style.display="grid";}
 });
 checkSession();
})();
</script>
</body></html>`;

async function handleApi(request, env, url) {
  const path = url.pathname;
  if (path === "/api/health" && request.method === "GET") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, database: true, admin_password_configured: Boolean(env.ADMIN_PASSWORD), session_secret_configured: Boolean(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) });
    } catch {
      return json({ ok: false, database: false }, 503);
    }
  }
  if (path === "/api/login" && request.method === "POST") {
    if (!originAllowed(request)) return json({ error: "Request origin rejected." }, 403);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: "Admin secrets are not configured correctly." }, 503);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    if (typeof body?.password !== "string" || body.password.length > 256) return json({ error: "Invalid credentials." }, 401);
    try {
      await ensureSchema(env);
      const now = Date.now();
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipHash = b64url(await digest(ip));
      await env.DB.prepare("DELETE FROM login_attempts WHERE attempted_at < ?").bind(now - 15 * 60 * 1000).run();
      const count = await env.DB.prepare("SELECT COUNT(*) AS failures FROM login_attempts WHERE ip_hash=? AND attempted_at>=?").bind(ipHash, now - 15 * 60 * 1000).first();
      if (Number(count?.failures || 0) >= 5) return json({ error: "Too many attempts. Wait 15 minutes and try again." }, 429, { "Retry-After": "900" });
      if (!await equalSecret(body.password, env.ADMIN_PASSWORD)) {
        await env.DB.prepare("INSERT INTO login_attempts (ip_hash,attempted_at) VALUES (?,?)").bind(ipHash, now).run();
        return json({ error: "Incorrect password." }, 401);
      }
      await env.DB.prepare("DELETE FROM login_attempts WHERE ip_hash=?").bind(ipHash).run();
      const session = await createSession(env.SESSION_SECRET);
      return json({ ok: true }, 200, { "Set-Cookie": cookie(session.token, 8 * 60 * 60) });
    } catch {
      return json({ error: "Secure sign-in is temporarily unavailable. Please retry." }, 503);
    }
  }
  if (path === "/api/logout" && request.method === "POST") {
    if (!originAllowed(request)) return json({ error: "Request origin rejected." }, 403);
    const session = await readSession(request, env);
    if (session) {
      try {
        await ensureSchema(env);
        await env.DB.prepare("INSERT OR REPLACE INTO revoked_sessions (nonce,expires_at) VALUES (?,?)").bind(session.nonce, session.expiry).run();
      } catch { return json({ error: "Could not revoke session. Retry sign out." }, 503); }
    }
    return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
  }
  if (path === "/api/me" && request.method === "GET") {
    return await authenticated(request, env) ? json({ authenticated: true }) : json({ authenticated: false }, 401);
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (url.pathname === "/" || url.pathname === "/admin" || url.pathname === "/admin/") return page(APP_HTML);
    return new Response("Not found", { status: 404 });
  }
};