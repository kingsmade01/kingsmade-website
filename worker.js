/* =====================================================
   KINGSMADE MAIN WEBSITE WORKER
   Public storefront API + static website

   D1 binding: DB
   Static assets binding: ASSETS

   This is NOT the private admin Worker.
   ===================================================== */

const DEFAULT_HERO = {
  heading: "DRESS LIKE YOU MEAN IT.",
  subtitle: "Discover the KINGSMADE collection.",
  image_url: "",
  button_text: "SHOP COLLECTION",
  button_url: "/#shop",
  is_visible: 1
};

function secureResponse(response) {
  const headers = new Headers(response.headers);

  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' https: data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(data, status = 200) {
  return secureResponse(Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  }));
}

/* ---------------- PUBLIC PRODUCTS ---------------- */

async function getProducts(env) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM products
    WHERE is_active = 1
    ORDER BY id DESC
  `).all();

  return (result.results || []).map(product => ({
    id: product.id,
    name: product.name,
    description: product.description || "",
    price_ngn: product.price_ngn,
    category: product.category || "",
    image_url: product.image_url || "",
    sizes_json: product.sizes_json || "[]",
    colors_json: product.colors_json || "[]",
    stock_quantity: product.stock_quantity,
    is_active: product.is_active
  }));
}

/* ---------------- PUBLIC HERO ---------------- */

async function getHero(env) {
  try {
    const result = await env.DB.prepare(`
      SELECT setting_value
      FROM km_site_settings
      WHERE setting_key = 'hero'
      LIMIT 1
    `).first();

    if (!result || !result.setting_value) {
      return DEFAULT_HERO;
    }

    const saved = JSON.parse(result.setting_value);

    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      return DEFAULT_HERO;
    }

    return {
      ...DEFAULT_HERO,
      ...saved
    };

  } catch (error) {
    if (/no such table/i.test(error.message || "")) {
      return DEFAULT_HERO;
    }

    throw error;
  }
}


function htmlEscape(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

async function getShareSettings(env) {
  const db = env.SETTINGS || env.DB;
  if (!db) return null;
  try {
    return await db.prepare("SELECT primary_domain, site_name, page_title, description, image_url FROM site_settings WHERE id=1").first();
  } catch (error) {
    if (/no such table/i.test(error.message || "")) return null;
    throw error;
  }
}

async function addSocialMetadata(response, request, env) {
  if (!response || !response.ok || request.method === "HEAD" ||
      !(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    return response;
  }

  const settings = await getShareSettings(env);
  if (!settings) return response;

  const requestUrl = new URL(request.url);
  const domain = String(settings.primary_domain || requestUrl.hostname).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return response;

  const canonical = "https://" + domain + requestUrl.pathname;
  const title = htmlEscape(settings.page_title || settings.site_name || "KINGSMADE | Craft for Kings");
  const description = htmlEscape(settings.description || "Premium menswear, accessories and fabrics. Simple. Clean. Timeless.");
  let image = String(settings.image_url || "").trim();
  if (image.startsWith("/")) image = "https://" + domain + image;
  if (image && !/^https:\/\//i.test(image)) image = "";

  let html = await response.text();
  html = html.replace(/<title>[^<]*<\/title>/i, "<title>" + title + "</title>");
  html = html.replace(/<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i,
    '<meta name="description" content="' + description + '">');

  const tags = [
    '<link rel="canonical" href="' + htmlEscape(canonical) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="' + htmlEscape(settings.site_name || "KINGSMADE") + '">',
    '<meta property="og:title" content="' + title + '">',
    '<meta property="og:description" content="' + description + '">',
    '<meta property="og:url" content="' + htmlEscape(canonical) + '">',
    image ? '<meta property="og:image" content="' + htmlEscape(image) + '">' : '',
    image ? '<meta property="og:image:width" content="1200">' : '',
    image ? '<meta property="og:image:height" content="630">' : '',
    '<meta name="twitter:card" content="' + (image ? 'summary_large_image' : 'summary') + '">',
    '<meta name="twitter:title" content="' + title + '">',
    '<meta name="twitter:description" content="' + description + '">',
    image ? '<meta name="twitter:image" content="' + htmlEscape(image) + '">' : ''
  ].filter(Boolean).join("\n");

  if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, tags + "\n</head>");
  else return response;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

const PREVIEW_ASSETS = {
  "/": { body: "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#f5f1e9\">\n<meta name=\"description\" content=\"KINGSMADE — Premium menswear. Style is a statement. Excellence is a standard.\">\n<title>KINGSMADE | An Expression of Excellence</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<link rel=\"stylesheet\" href=\"/style.css\">\n</head>\n<body>\n<div class=\"announcement\">COMPLIMENTARY STYLE. UNCOMPROMISING QUALITY. <span>CRAFT FOR KINGS</span></div>\n<header class=\"site-header\">\n  <a class=\"brand\" href=\"/\" aria-label=\"KINGSMADE home\"><span>KINGSMADE</span><small>EST. 2025</small></a>\n  <nav class=\"desktop-nav\" aria-label=\"Main navigation\">\n    <a href=\"#shop\">NEW ARRIVALS</a><a href=\"#categories\">CATEGORIES</a><a href=\"#shop\">CLOTHING</a><a href=\"#shop\">FOOTWEAR</a><a href=\"#footer\">ABOUT</a>\n  </nav>\n  <div class=\"header-actions\">\n    <a class=\"contact-link\" href=\"mailto:kingsmade01@gmail.com\">CONTACT KINGSMADE</a>\n    <button class=\"icon-btn menu-btn\" type=\"button\" aria-label=\"Open menu\" id=\"menuButton\">☰</button>\n    <button class=\"bag-btn\" type=\"button\" id=\"bagButton\" aria-label=\"Open shopping bag\">BAG <span id=\"cartCount\">0</span></button>\n  </div>\n</header>\n<nav class=\"mobile-nav\"><a href=\"#shop\">Shop collection</a><a href=\"#categories\">Categories</a><a href=\"mailto:kingsmade01@gmail.com\">Contact</a></nav>\n<main>\n<section class=\"hero\" id=\"homepageHero\">\n  <img id=\"heroBackground\" class=\"hero-image\" alt=\"\" hidden>\n  <div class=\"hero-shade\"></div>\n  <div class=\"hero-content\">\n    <p class=\"eyebrow\" id=\"heroEyebrow\">KINGSMADE · LUXURY MENSWEAR</p>\n    <h1 id=\"heroHeading\">AN EXPRESSION<br>OF EXCELLENCE.</h1>\n    <p class=\"hero-copy\" id=\"heroSubtitle\">Style is a statement. Excellence is a standard.</p>\n    <a class=\"shop-btn\" id=\"heroButton\" href=\"#shop\">DISCOVER THE COLLECTION <span>↗</span></a>\n  </div>\n  <div class=\"hero-signature\"><span>KM</span><b>KINGSMADE</b><small>CRAFT FOR KINGS</small></div>\n  <div class=\"hero-index\">01 <i></i> THE SIGNATURE COLLECTION</div>\n</section>\n<section class=\"intro-strip\"><span>PREMIUM QUALITY</span><i>✳</i><span>TIMELESS STYLE</span><i>✳</i><span>MADE FOR KINGS</span></section>\n<section class=\"categories section-wrap\" id=\"categories\">\n  <div class=\"section-kicker\">DISCOVER YOUR STYLE</div>\n  <div class=\"section-title-row\"><h2>Find what fits<br><em>your standard.</em></h2><p>Considered essentials. Confident silhouettes.<br>Pieces made to become part of your signature.</p></div>\n  <div class=\"category-grid\">\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=85\" alt=\"T-shirts\"><span>01 / T-SHIRTS</span></a>\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=700&q=85\" alt=\"Hoodies\"><span>02 / HOODIES</span></a>\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1517438476312-10d79c077509?auto=format&fit=crop&w=700&q=85\" alt=\"Footwear\"><span>03 / FOOTWEAR</span></a>\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=700&q=85\" alt=\"Accessories\"><span>04 / ACCESSORIES</span></a>\n  </div>\n</section>\n<section class=\"collection section-wrap\" id=\"shop\">\n  <div class=\"section-kicker\">THE KINGSMADE COLLECTION</div>\n  <div class=\"section-title-row\"><h2>Designed to be<br><em>remembered.</em></h2><p>Explore the collection.<br>Every detail has a purpose.</p></div>\n  <div id=\"products\" class=\"grid\"><p>Loading KINGSMADE collection...</p></div>\n</section>\n<section class=\"closing-banner\"><div><p>THE KINGSMADE STANDARD</p><h2>Dress like<br><em>you mean it.</em></h2><a href=\"#shop\">SHOP THE COLLECTION ↗</a></div></section>\n</main>\n<aside id=\"cart\" class=\"cart-panel\" aria-label=\"Shopping cart\">\n <div class=\"cart-head\"><div><small>YOUR SELECTION</small><h2>Shopping bag</h2></div><button type=\"button\" aria-label=\"Close cart\" id=\"closeCartButton\">×</button></div>\n <div id=\"cartItems\"></div>\n <div class=\"cart-total\"><span>Subtotal</span><strong id=\"cartTotal\">₦0</strong></div>\n <button class=\"checkout\" type=\"button\" id=\"checkoutButton\">PROCEED TO CHECKOUT</button>\n <p class=\"cart-note\">Secure checkout · Crafted for kings</p>\n</aside>\n<div id=\"overlay\" class=\"overlay\" ></div>\n<footer id=\"footer\">\n <div class=\"footer-main\"><div class=\"footer-brand\"><span>KINGSMADE</span><small>CRAFT FOR KINGS</small><p>Premium menswear.<br>Made for those who set the standard.</p></div>\n <div><b>EXPLORE</b><a href=\"#shop\">Shop all</a><a href=\"#categories\">Categories</a><a href=\"#shop\">New arrivals</a></div>\n <div><b>CLIENT CARE</b><a href=\"mailto:kingsmade01@gmail.com\">Contact</a><a href=\"mailto:kingsmade01@gmail.com\">Customer support</a></div>\n <div><b>FOLLOW KINGSMADE</b><a href=\"https://www.instagram.com/kingsmade01/\" target=\"_blank\" rel=\"noopener\">Instagram ↗</a><a href=\"https://x.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener\">X ↗</a><a href=\"https://www.facebook.com/profile.php?id=61595227090232\" target=\"_blank\" rel=\"noopener\">Facebook ↗</a></div></div>\n <div class=\"footer-bottom\"><span>© 2026 KINGSMADE. ALL RIGHTS RESERVED.</span><span>EST. 2025 · CRAFT FOR KINGS</span></div>\n</footer>\n<script src=\"/script.js\" defer></script>\n</body></html>", type: "text/html; charset=utf-8" },
  "/index.html": { body: "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#f5f1e9\">\n<meta name=\"description\" content=\"KINGSMADE — Premium menswear. Style is a statement. Excellence is a standard.\">\n<title>KINGSMADE | An Expression of Excellence</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<link rel=\"stylesheet\" href=\"/style.css\">\n</head>\n<body>\n<div class=\"announcement\">COMPLIMENTARY STYLE. UNCOMPROMISING QUALITY. <span>CRAFT FOR KINGS</span></div>\n<header class=\"site-header\">\n  <a class=\"brand\" href=\"/\" aria-label=\"KINGSMADE home\"><span>KINGSMADE</span><small>EST. 2025</small></a>\n  <nav class=\"desktop-nav\" aria-label=\"Main navigation\">\n    <a href=\"#shop\">NEW ARRIVALS</a><a href=\"#categories\">CATEGORIES</a><a href=\"#shop\">CLOTHING</a><a href=\"#shop\">FOOTWEAR</a><a href=\"#footer\">ABOUT</a>\n  </nav>\n  <div class=\"header-actions\">\n    <a class=\"contact-link\" href=\"mailto:kingsmade01@gmail.com\">CONTACT KINGSMADE</a>\n    <button class=\"icon-btn menu-btn\" type=\"button\" aria-label=\"Open menu\" id=\"menuButton\">☰</button>\n    <button class=\"bag-btn\" type=\"button\" id=\"bagButton\" aria-label=\"Open shopping bag\">BAG <span id=\"cartCount\">0</span></button>\n  </div>\n</header>\n<nav class=\"mobile-nav\"><a href=\"#shop\">Shop collection</a><a href=\"#categories\">Categories</a><a href=\"mailto:kingsmade01@gmail.com\">Contact</a></nav>\n<main>\n<section class=\"hero\" id=\"homepageHero\">\n  <img id=\"heroBackground\" class=\"hero-image\" alt=\"\" hidden>\n  <div class=\"hero-shade\"></div>\n  <div class=\"hero-content\">\n    <p class=\"eyebrow\" id=\"heroEyebrow\">KINGSMADE · LUXURY MENSWEAR</p>\n    <h1 id=\"heroHeading\">AN EXPRESSION<br>OF EXCELLENCE.</h1>\n    <p class=\"hero-copy\" id=\"heroSubtitle\">Style is a statement. Excellence is a standard.</p>\n    <a class=\"shop-btn\" id=\"heroButton\" href=\"#shop\">DISCOVER THE COLLECTION <span>↗</span></a>\n  </div>\n  <div class=\"hero-signature\"><span>KM</span><b>KINGSMADE</b><small>CRAFT FOR KINGS</small></div>\n  <div class=\"hero-index\">01 <i></i> THE SIGNATURE COLLECTION</div>\n</section>\n<section class=\"intro-strip\"><span>PREMIUM QUALITY</span><i>✳</i><span>TIMELESS STYLE</span><i>✳</i><span>MADE FOR KINGS</span></section>\n<section class=\"categories section-wrap\" id=\"categories\">\n  <div class=\"section-kicker\">DISCOVER YOUR STYLE</div>\n  <div class=\"section-title-row\"><h2>Find what fits<br><em>your standard.</em></h2><p>Considered essentials. Confident silhouettes.<br>Pieces made to become part of your signature.</p></div>\n  <div class=\"category-grid\">\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=85\" alt=\"T-shirts\"><span>01 / T-SHIRTS</span></a>\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=700&q=85\" alt=\"Hoodies\"><span>02 / HOODIES</span></a>\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1517438476312-10d79c077509?auto=format&fit=crop&w=700&q=85\" alt=\"Footwear\"><span>03 / FOOTWEAR</span></a>\n    <a class=\"category-tile\" href=\"#shop\"><img src=\"https://images.unsplash.com/photo-1523381210434-271e8be1f52b?auto=format&fit=crop&w=700&q=85\" alt=\"Accessories\"><span>04 / ACCESSORIES</span></a>\n  </div>\n</section>\n<section class=\"collection section-wrap\" id=\"shop\">\n  <div class=\"section-kicker\">THE KINGSMADE COLLECTION</div>\n  <div class=\"section-title-row\"><h2>Designed to be<br><em>remembered.</em></h2><p>Explore the collection.<br>Every detail has a purpose.</p></div>\n  <div id=\"products\" class=\"grid\"><p>Loading KINGSMADE collection...</p></div>\n</section>\n<section class=\"closing-banner\"><div><p>THE KINGSMADE STANDARD</p><h2>Dress like<br><em>you mean it.</em></h2><a href=\"#shop\">SHOP THE COLLECTION ↗</a></div></section>\n</main>\n<aside id=\"cart\" class=\"cart-panel\" aria-label=\"Shopping cart\">\n <div class=\"cart-head\"><div><small>YOUR SELECTION</small><h2>Shopping bag</h2></div><button type=\"button\" aria-label=\"Close cart\" id=\"closeCartButton\">×</button></div>\n <div id=\"cartItems\"></div>\n <div class=\"cart-total\"><span>Subtotal</span><strong id=\"cartTotal\">₦0</strong></div>\n <button class=\"checkout\" type=\"button\" id=\"checkoutButton\">PROCEED TO CHECKOUT</button>\n <p class=\"cart-note\">Secure checkout · Crafted for kings</p>\n</aside>\n<div id=\"overlay\" class=\"overlay\" ></div>\n<footer id=\"footer\">\n <div class=\"footer-main\"><div class=\"footer-brand\"><span>KINGSMADE</span><small>CRAFT FOR KINGS</small><p>Premium menswear.<br>Made for those who set the standard.</p></div>\n <div><b>EXPLORE</b><a href=\"#shop\">Shop all</a><a href=\"#categories\">Categories</a><a href=\"#shop\">New arrivals</a></div>\n <div><b>CLIENT CARE</b><a href=\"mailto:kingsmade01@gmail.com\">Contact</a><a href=\"mailto:kingsmade01@gmail.com\">Customer support</a></div>\n <div><b>FOLLOW KINGSMADE</b><a href=\"https://www.instagram.com/kingsmade01/\" target=\"_blank\" rel=\"noopener\">Instagram ↗</a><a href=\"https://x.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener\">X ↗</a><a href=\"https://www.facebook.com/profile.php?id=61595227090232\" target=\"_blank\" rel=\"noopener\">Facebook ↗</a></div></div>\n <div class=\"footer-bottom\"><span>© 2026 KINGSMADE. ALL RIGHTS RESERVED.</span><span>EST. 2025 · CRAFT FOR KINGS</span></div>\n</footer>\n<script src=\"/script.js\" defer></script>\n</body></html>", type: "text/html; charset=utf-8" },
  "/style.css": { body: ":root{--ivory:#f5f1e9;--paper:#fbf9f5;--ink:#171613;--muted:#77736b;--gold:#b69a62;--line:#ded8cc;--white:#fff;--serif:\"Cormorant Garamond\",Georgia,serif;--sans:\"DM Sans\",Arial,sans-serif}\n*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ivory);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}a{color:inherit;text-decoration:none}button{font:inherit}.announcement{height:29px;background:#171613;color:#e9e1d2;display:flex;align-items:center;justify-content:center;gap:13px;font-size:8px;letter-spacing:2px}.announcement span{color:#c6a76c}.site-header{height:88px;padding:0 5.8%;display:flex;align-items:center;justify-content:space-between;background:var(--paper);border-bottom:1px solid #e9e3d9;position:relative;z-index:5}.brand{display:flex;flex-direction:column;align-items:center;min-width:145px}.brand span,.footer-brand>span{font-family:var(--serif);font-weight:600;font-size:28px;letter-spacing:3px}.brand small,.footer-brand small{font-size:7px;letter-spacing:2.5px;margin-top:1px}.desktop-nav{display:flex;gap:27px;align-items:center}.desktop-nav a,.contact-link,.bag-btn{font-size:9px;letter-spacing:1.2px;font-weight:600}.desktop-nav a:hover,.footer-main a:hover{color:var(--gold)}.header-actions{display:flex;align-items:center;gap:22px}.contact-link{border-bottom:1px solid var(--gold);padding-bottom:5px}.bag-btn,.icon-btn{border:0;background:none;cursor:pointer;letter-spacing:1px;font-size:10px}.bag-btn span{display:inline-grid;place-items:center;background:#1b1a17;color:white;border-radius:50%;width:21px;height:21px;margin-left:5px}.menu-btn,.mobile-nav{display:none}.hero{height:min(650px,68vw);min-height:470px;position:relative;overflow:hidden;background:#24211d url(\"https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=2000&q=90\") center 36%/cover no-repeat;color:#fff;display:flex;align-items:center;padding:0 9%}.hero-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 35%;opacity:.3;z-index:0}.hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,8,.88) 0%,rgba(8,8,8,.66) 43%,rgba(8,8,8,.1) 100%);z-index:0}.hero-content{position:relative;z-index:1;max-width:610px}.eyebrow,.section-kicker{font-size:9px;letter-spacing:3px;color:var(--gold);font-weight:600}.hero h1{font:500 clamp(48px,6.4vw,88px)/.91 var(--serif);letter-spacing:-1.5px;margin:24px 0 17px;max-width:700px}.hero-copy{font:italic 19px var(--serif);color:#e6e0d6;margin:0 0 32px}.shop-btn{display:inline-flex;gap:34px;align-items:center;padding:15px 19px;background:#c3a36a;color:#15130f;font-size:9px;letter-spacing:1.5px;font-weight:700}.shop-btn:hover{background:#e0c18a}.hero-signature{position:absolute;right:8%;top:38%;z-index:1;display:flex;flex-direction:column;align-items:center;text-shadow:0 2px 12px #000}.hero-signature span{font:600 70px var(--serif);letter-spacing:-9px}.hero-signature b{font:500 19px var(--serif);letter-spacing:5px}.hero-signature small{font-size:7px;letter-spacing:3px;margin-top:8px}.hero-index{position:absolute;bottom:25px;left:9%;font-size:8px;letter-spacing:2px;color:#d9d1c5}.hero-index i{display:inline-block;width:42px;height:1px;background:var(--gold);vertical-align:middle;margin:0 10px}.intro-strip{height:65px;display:flex;align-items:center;justify-content:center;gap:35px;border-bottom:1px solid var(--line);font-size:8px;letter-spacing:2.4px;color:#625e55}.intro-strip i{font-style:normal;color:var(--gold)}.section-wrap{padding:92px 7% 86px}.section-kicker{text-align:center;margin-bottom:17px}.section-title-row{display:flex;justify-content:space-between;align-items:end;margin-bottom:38px}.section-title-row h2{font:500 clamp(43px,5vw,66px)/.91 var(--serif);letter-spacing:-1px;margin:0}.section-title-row h2 em,.closing-banner h2 em{color:#a88b58;font-weight:400}.section-title-row>p{font:italic 16px/1.5 var(--serif);color:#777168;margin:0 2% 4px 0}.category-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.category-tile{position:relative;display:block;height:260px;overflow:hidden;background:#ddd5c9}.category-tile img{width:100%;height:100%;object-fit:cover;filter:saturate(.68);transition:transform .7s}.category-tile:hover img{transform:scale(1.06)}.category-tile:after{content:\"\";position:absolute;inset:45% 0 0;background:linear-gradient(transparent,rgba(0,0,0,.62))}.category-tile span{position:absolute;bottom:17px;left:17px;color:white;font-size:9px;letter-spacing:1.8px;z-index:1}.collection{background:#f0ece4;padding-top:88px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 16px}.card{background:#faf8f3;border:1px solid #e6e0d5;min-width:0;transition:transform .25s,box-shadow .25s}.card:hover{transform:translateY(-4px);box-shadow:0 14px 35px #211b1012}.product-img{height:300px;position:relative;overflow:hidden;background:#e7e1d7;display:flex;align-items:center;justify-content:center;color:#27231e;font:500 32px var(--serif);letter-spacing:4px}.product-img img{width:100%;height:100%;object-fit:cover;transition:transform .6s}.card:hover .product-img img{transform:scale(1.04)}.card-body{padding:17px 17px 19px}.card-body h3{font:500 22px var(--serif);margin:0 0 5px}.product-category{font-size:8px;letter-spacing:1.5px;color:#9b8050;text-transform:uppercase;margin:5px 0}.product-description,.product-options,.product-stock{font-size:10px;color:#79746c;line-height:1.7;margin:7px 0}.price{font:600 16px var(--sans);margin:13px 0}.add{width:100%;padding:12px;background:#171613;color:#fff;border:1px solid #171613;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer}.add:hover{background:#b69a62;border-color:#b69a62;color:#15130f}.add:disabled{opacity:.45;cursor:not-allowed}.closing-banner{min-height:340px;background:linear-gradient(90deg,rgba(8,8,8,.91),rgba(8,8,8,.45)),url(\"https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1800&q=85\") center 40%/cover;color:white;display:flex;align-items:center;padding:55px 9%}.closing-banner>div{max-width:520px}.closing-banner p{font-size:8px;letter-spacing:3px;color:#c9ad78}.closing-banner h2{font:500 62px/.9 var(--serif);margin:20px 0 28px}.closing-banner a{font-size:9px;letter-spacing:1.7px;border-bottom:1px solid #b69a62;padding-bottom:9px}footer{background:#171613;color:#e9e4da;padding:55px 7% 18px}.footer-main{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:35px;padding-bottom:48px}.footer-brand>span{display:block;font-size:30px}.footer-brand small{display:block;color:#c4a66e}.footer-brand p{font:italic 16px/1.5 var(--serif);color:#aaa49a;margin-top:24px}.footer-main>div:not(:first-child){display:flex;flex-direction:column;gap:13px}.footer-main>div>b{font-size:8px;letter-spacing:2px;color:#c4a66e;margin-bottom:8px}.footer-main a{font-size:11px;color:#d0cbc2}.footer-bottom{border-top:1px solid #403c35;padding-top:17px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1.5px;color:#9b968d}.cart-panel{position:fixed;z-index:20;right:0;top:0;height:100dvh;width:min(430px,100%);background:#fbf9f5;padding:27px;transform:translateX(105%);transition:transform .3s;overflow:auto;box-shadow:-15px 0 50px #0002}.cart-panel.open{transform:translateX(0)}.cart-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:20px}.cart-head small{font-size:8px;letter-spacing:2px;color:var(--gold)}.cart-head h2{font:500 34px var(--serif);margin:5px 0}.cart-head button{border:0;background:none;font-size:28px;cursor:pointer}.cart-line{display:flex;justify-content:space-between;gap:12px;padding:18px 0;border-bottom:1px solid var(--line);font-size:12px}.cart-line strong{white-space:nowrap}.cart-controls{display:flex;gap:7px;margin-top:8px}.cart-controls button{border:1px solid var(--line);background:transparent;padding:5px 10px;cursor:pointer}.cart-controls button:last-child{color:#934747;border:0;text-decoration:underline}.cart-total{display:flex;justify-content:space-between;padding:24px 0;font-size:13px}.checkout{width:100%;padding:16px;background:#171613;color:white;border:0;font-size:9px;letter-spacing:1.5px;cursor:pointer}.cart-note{text-align:center;font:italic 13px var(--serif);color:#817b71}.overlay{position:fixed;inset:0;background:#0007;z-index:19;opacity:0;visibility:hidden;transition:.3s}.overlay.open{opacity:1;visibility:visible}.hero.is-hidden{display:none!important}#products>p{grid-column:1/-1;text-align:center;padding:45px;color:var(--muted)}\n@media(max-width:900px){.site-header{padding:0 4%;height:78px}.desktop-nav{gap:13px}.desktop-nav a{font-size:8px}.contact-link{display:none}.section-wrap{padding:70px 5%}.category-tile{height:210px}.product-img{height:245px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{min-height:490px}.hero-signature{right:6%}.footer-main{grid-template-columns:1.5fr 1fr 1fr;}.footer-main>div:last-child{grid-column:2}}\n@media(max-width:600px){.announcement{font-size:7px;letter-spacing:1.2px}.site-header{height:72px}.brand{min-width:auto}.brand span{font-size:24px}.desktop-nav{display:none}.header-actions{gap:12px}.menu-btn{display:block}.mobile-nav{position:absolute;z-index:4;left:0;right:0;background:var(--paper);padding:0 6%;max-height:0;overflow:hidden;display:flex;flex-direction:column;transition:max-height .25s}.menu-open .mobile-nav{max-height:180px;padding-top:15px;padding-bottom:15px}.mobile-nav a{padding:10px 0;border-top:1px solid var(--line);font-size:11px}.hero{min-height:570px;height:76vh;max-height:700px;padding:0 7%;background-position:62% center}.hero-shade{background:linear-gradient(90deg,rgba(8,8,8,.85),rgba(8,8,8,.32))}.hero h1{font-size:52px;max-width:350px}.hero-copy{font-size:17px;max-width:280px}.hero-signature{right:7%;top:auto;bottom:72px}.hero-signature span{font-size:45px}.hero-signature b{font-size:12px}.hero-index{left:7%;font-size:7px}.intro-strip{height:54px;gap:12px;font-size:6px;letter-spacing:1px}.section-wrap{padding:62px 5%}.section-title-row{display:block}.section-title-row h2{font-size:49px}.section-title-row>p{margin-top:18px;font-size:15px}.category-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.category-tile{height:185px}.category-tile span{font-size:8px;left:11px;bottom:12px}.grid{gap:12px 9px}.product-img{height:210px}.card-body{padding:12px}.card-body h3{font-size:19px}.price{font-size:14px}.add{padding:12px 6px;font-size:8px}.closing-banner{min-height:290px;padding:45px 7%}.closing-banner h2{font-size:53px}.footer-main{grid-template-columns:1fr 1fr;gap:30px 18px}.footer-brand{grid-column:1/-1}.footer-main>div:last-child{grid-column:auto}.footer-bottom{gap:12px;flex-direction:column;font-size:7px}}\n", type: "text/css; charset=utf-8" },
  "/script.js": { body: "/* =====================================================\n   KINGSMADE STOREFRONT\n   Product catalogue + persistent shopping cart\n   Current database price field: price_ngn\n   ===================================================== */\n\n\"use strict\";\n\nlet products = [];\nlet cart = [];\n\nconst CART_STORAGE_KEY = \"kingsmade_cart_v1\";\n\nconst $ = id => document.getElementById(id);\n\nconst naira = value =>\n  new Intl.NumberFormat(\"en-NG\", {\n    style: \"currency\",\n    currency: \"NGN\",\n    maximumFractionDigits: 0\n  }).format(Number(value) || 0);\n\nfunction parseList(value) {\n  if (Array.isArray(value)) return value;\n\n  try {\n    const parsed = JSON.parse(value || \"[]\");\n    return Array.isArray(parsed) ? parsed : [];\n  } catch {\n    return [];\n  }\n}\n\nfunction safeImageURL(value) {\n  if (typeof value !== \"string\" || !value.trim()) return \"\";\n\n  try {\n    const url = new URL(value, location.origin);\n\n    if (\n      url.origin === location.origin ||\n      url.protocol === \"https:\"\n    ) {\n      return url.href;\n    }\n  } catch {}\n\n  return \"\";\n}\n\n/* ---------------- CART STORAGE ---------------- */\n\nfunction saveCart() {\n  try {\n    localStorage.setItem(\n      CART_STORAGE_KEY,\n      JSON.stringify(\n        cart.map(item => ({\n          id: item.id,\n          qty: item.qty\n        }))\n      )\n    );\n  } catch (error) {\n    console.warn(\"Could not save KINGSMADE cart:\", error);\n  }\n}\n\nfunction restoreCart() {\n  try {\n    const saved = JSON.parse(\n      localStorage.getItem(CART_STORAGE_KEY) || \"[]\"\n    );\n\n    if (!Array.isArray(saved)) return [];\n\n    return saved\n      .filter(item =>\n        item &&\n        item.id !== undefined &&\n        Number.isInteger(Number(item.qty)) &&\n        Number(item.qty) > 0\n      )\n      .map(item => ({\n        id: item.id,\n        qty: Number(item.qty)\n      }));\n  } catch {\n    return [];\n  }\n}\n\n/* ---------------- LOAD PRODUCTS ---------------- */\n\nasync function loadProducts() {\n  const container = $(\"products\");\n\n  if (!container) return;\n\n  container.replaceChildren();\n\n  const loading = document.createElement(\"p\");\n  loading.textContent = \"Loading KINGSMADE collection...\";\n  container.appendChild(loading);\n\n  try {\n    const response = await fetch(\"/api/products\", {\n      method: \"GET\",\n      cache: \"no-store\"\n    });\n\n    if (!response.ok) {\n      throw new Error(\"Unable to retrieve products.\");\n    }\n\n    const data = await response.json();\n\n    if (!Array.isArray(data.products)) {\n      throw new Error(\"Invalid product information received.\");\n    }\n\n    products = data.products\n      .filter(product => Number(product.is_active) === 1)\n      .map(product => ({\n        id: product.id,\n        name: String(product.name || \"KINGSMADE Product\"),\n        description: String(product.description || \"\"),\n        category: String(product.category || \"\"),\n        price: Math.max(0, Number(product.price_ngn) || 0),\n        image: product.image_url || \"\",\n        stock: Math.max(\n          0,\n          Math.floor(Number(product.stock_quantity) || 0)\n        ),\n        sizes: parseList(product.sizes_json),\n        colors: parseList(product.colors_json)\n      }));\n\n    restoreCartFromStorage();\n    renderProducts();\n    renderCart();\n\n  } catch (error) {\n    console.error(\"KINGSMADE product loading:\", error);\n\n    container.replaceChildren();\n\n    const message = document.createElement(\"p\");\n    message.textContent =\n      \"Our collection is temporarily unavailable. Please refresh the page.\";\n\n    container.appendChild(message);\n  }\n}\n\n/* ---------------- RESTORE CART ---------------- */\n\nfunction restoreCartFromStorage() {\n  const saved = restoreCart();\n\n  cart = saved\n    .map(savedItem => {\n      const product = products.find(\n        item => String(item.id) === String(savedItem.id)\n      );\n\n      if (!product || product.stock <= 0) return null;\n\n      return {\n        ...product,\n        qty: Math.min(savedItem.qty, product.stock)\n      };\n    })\n    .filter(Boolean);\n\n  saveCart();\n}\n\n/* ---------------- DISPLAY PRODUCTS ---------------- */\n\nfunction renderProducts() {\n  const container = $(\"products\");\n  container.replaceChildren();\n\n  if (!products.length) {\n    const empty = document.createElement(\"p\");\n    empty.textContent = \"New KINGSMADE products coming soon.\";\n    container.appendChild(empty);\n    return;\n  }\n\n  products.forEach(product => {\n    const card = document.createElement(\"article\");\n    card.className = \"card\";\n\n    const imageBox = document.createElement(\"div\");\n    imageBox.className = \"product-img\";\n\n    const imageURL = safeImageURL(product.image);\n\n    if (imageURL) {\n      const image = document.createElement(\"img\");\n      image.src = imageURL;\n      image.alt = product.name;\n      image.loading = \"lazy\";\n\n      image.onerror = () => {\n        image.remove();\n        imageBox.textContent = \"KM\";\n      };\n\n      imageBox.appendChild(image);\n    } else {\n      imageBox.textContent = \"KM\";\n    }\n\n    const body = document.createElement(\"div\");\n    body.className = \"card-body\";\n\n    const name = document.createElement(\"h3\");\n    name.textContent = product.name;\n    body.appendChild(name);\n\n    if (product.category) {\n      const category = document.createElement(\"p\");\n      category.className = \"product-category\";\n      category.textContent = product.category;\n      body.appendChild(category);\n    }\n\n    if (product.description) {\n      const description = document.createElement(\"p\");\n      description.className = \"product-description\";\n      description.textContent = product.description;\n      body.appendChild(description);\n    }\n\n    if (product.sizes.length) {\n      const sizes = document.createElement(\"p\");\n      sizes.className = \"product-options\";\n      sizes.textContent = \"Sizes: \" + product.sizes.join(\", \");\n      body.appendChild(sizes);\n    }\n\n    if (product.colors.length) {\n      const colors = document.createElement(\"p\");\n      colors.className = \"product-options\";\n      colors.textContent = \"Colours: \" + product.colors.join(\", \");\n      body.appendChild(colors);\n    }\n\n    const price = document.createElement(\"div\");\n    price.className = \"price\";\n    price.textContent = naira(product.price);\n    body.appendChild(price);\n\n    const stock = document.createElement(\"p\");\n    stock.className = \"product-stock\";\n\n    const button = document.createElement(\"button\");\n    button.type = \"button\";\n    button.className = \"add\";\n\n    if (product.stock <= 0) {\n      stock.textContent = \"Out of stock\";\n      button.textContent = \"Out of stock\";\n      button.disabled = true;\n    } else {\n      stock.textContent = product.stock <= 5\n        ? \"Only \" + product.stock + \" left\"\n        : \"In stock\";\n\n      button.textContent = \"Add to cart\";\n      button.addEventListener(\"click\", () => add(product.id));\n    }\n\n    body.append(stock, button);\n    card.append(imageBox, body);\n    container.appendChild(card);\n  });\n}\n\n/* ---------------- ADD TO CART ---------------- */\n\nfunction add(id) {\n  const product = products.find(\n    item => String(item.id) === String(id)\n  );\n\n  if (!product || product.stock <= 0) return;\n\n  const item = cart.find(\n    entry => String(entry.id) === String(id)\n  );\n\n  if (item) {\n    if (item.qty >= product.stock) {\n      alert(\"You have reached the available stock quantity.\");\n      return;\n    }\n\n    item.qty += 1;\n  } else {\n    cart.push({\n      ...product,\n      qty: 1\n    });\n  }\n\n  saveCart();\n  renderCart();\n  toggleCart(true);\n}\n\n/* ---------------- CHANGE QUANTITY ---------------- */\n\nfunction changeQuantity(id, amount) {\n  const item = cart.find(\n    entry => String(entry.id) === String(id)\n  );\n\n  if (!item) return;\n\n  const product = products.find(\n    entry => String(entry.id) === String(id)\n  );\n\n  const nextQuantity = item.qty + amount;\n\n  if (nextQuantity <= 0) {\n    removeFromCart(id);\n    return;\n  }\n\n  if (!product || nextQuantity > product.stock) {\n    alert(\"Not enough stock available.\");\n    return;\n  }\n\n  item.qty = nextQuantity;\n\n  saveCart();\n  renderCart();\n}\n\n/* ---------------- REMOVE ITEM ---------------- */\n\nfunction removeFromCart(id) {\n  cart = cart.filter(\n    item => String(item.id) !== String(id)\n  );\n\n  saveCart();\n  renderCart();\n}\n\n/* ---------------- DISPLAY CART ---------------- */\n\nfunction renderCart() {\n  const cartItems = $(\"cartItems\");\n  if (!cartItems) return;\n\n  cartItems.replaceChildren();\n\n  const count = cart.reduce(\n    (sum, item) => sum + item.qty,\n    0\n  );\n\n  $(\"cartCount\").textContent = count;\n\n  if (!cart.length) {\n    const empty = document.createElement(\"p\");\n    empty.textContent = \"Your cart is empty.\";\n    cartItems.appendChild(empty);\n  }\n\n  cart.forEach(item => {\n    const line = document.createElement(\"div\");\n    line.className = \"cart-line\";\n\n    const details = document.createElement(\"div\");\n\n    const name = document.createElement(\"b\");\n    name.textContent = item.name;\n\n    const quantity = document.createElement(\"div\");\n    quantity.textContent = \"Qty: \" + item.qty;\n\n    const controls = document.createElement(\"div\");\n    controls.className = \"cart-controls\";\n\n    const minus = document.createElement(\"button\");\n    minus.type = \"button\";\n    minus.textContent = \"−\";\n    minus.setAttribute(\"aria-label\", \"Decrease quantity\");\n    minus.addEventListener(\"click\", () =>\n      changeQuantity(item.id, -1)\n    );\n\n    const plus = document.createElement(\"button\");\n    plus.type = \"button\";\n    plus.textContent = \"+\";\n    plus.setAttribute(\"aria-label\", \"Increase quantity\");\n    plus.addEventListener(\"click\", () =>\n      changeQuantity(item.id, 1)\n    );\n\n    const remove = document.createElement(\"button\");\n    remove.type = \"button\";\n    remove.textContent = \"Remove\";\n    remove.addEventListener(\"click\", () =>\n      removeFromCart(item.id)\n    );\n\n    controls.append(minus, plus, remove);\n    details.append(name, quantity, controls);\n\n    const price = document.createElement(\"strong\");\n    price.textContent = naira(item.price * item.qty);\n\n    line.append(details, price);\n    cartItems.appendChild(line);\n  });\n\n  const total = cart.reduce(\n    (sum, item) => sum + item.price * item.qty,\n    0\n  );\n\n  $(\"cartTotal\").textContent = naira(total);\n}\n\n/* ---------------- CART PANEL ---------------- */\n\nfunction toggleCart(force) {\n  const cartPanel = $(\"cart\");\n  const overlay = $(\"overlay\");\n\n  if (!cartPanel || !overlay) return;\n\n  const open = typeof force === \"boolean\"\n    ? force\n    : !cartPanel.classList.contains(\"open\");\n\n  cartPanel.classList.toggle(\"open\", open);\n  overlay.classList.toggle(\"open\", open);\n}\n\n/* ---------------- CHECKOUT ---------------- */\n\nfunction checkout() {\n  if (!cart.length) {\n    alert(\"Your cart is empty.\");\n    return;\n  }\n\n  alert(\n    \"KINGSMADE checkout is not connected yet. \" +\n    \"Your cart has been saved. Payment is not available yet.\"\n  );\n}\n\n/* ---------------- HERO SETTINGS ---------------- */\n\nfunction safeNavigationURL(value) {\n  try {\n    const target = new URL(\n      typeof value === \"string\" ? value : \"/#shop\",\n      location.origin\n    );\n\n    if (target.origin === location.origin && target.protocol === \"https:\") {\n      return target.pathname + target.search + target.hash;\n    }\n  } catch {}\n\n  return \"/#shop\";\n}\n\nasync function loadKingsmadeHero() {\n  const hero = $(\"homepageHero\");\n  if (!hero) return;\n\n  try {\n    const response = await fetch(\"/api/hero\", {\n      method: \"GET\",\n      cache: \"no-store\"\n    });\n\n    if (!response.ok) return;\n\n    const data = await response.json();\n    const settings = data.hero;\n\n    if (!settings || typeof settings !== \"object\" || Array.isArray(settings)) {\n      return;\n    }\n\n    hero.classList.toggle(\n      \"is-hidden\",\n      settings.is_visible !== undefined &&\n      Number(settings.is_visible) !== 1\n    );\n\n    if (typeof settings.heading === \"string\" && settings.heading) {\n      $(\"heroHeading\").textContent = settings.heading;\n    }\n\n    if (typeof settings.subtitle === \"string\" && settings.subtitle) {\n      $(\"heroSubtitle\").textContent = settings.subtitle;\n    }\n\n    const button = $(\"heroButton\");\n    button.textContent =\n      (typeof settings.button_text === \"string\" && settings.button_text\n        ? settings.button_text\n        : \"DISCOVER THE COLLECTION\") + \" ↗\";\n    button.href = safeNavigationURL(settings.button_url);\n\n    const image = $(\"heroBackground\");\n    const imageURL = safeImageURL(settings.image_url);\n\n    if (imageURL) {\n      image.src = imageURL;\n      image.hidden = false;\n    } else {\n      image.removeAttribute(\"src\");\n      image.hidden = true;\n    }\n  } catch (error) {\n    console.error(\"KINGSMADE hero settings:\", error);\n  }\n}\n\n/* ---------------- INITIALISE STORE ---------------- */\n\n$(\"menuButton\")?.addEventListener(\"click\", () => {\n  document.body.classList.toggle(\"menu-open\");\n});\n\n$(\"bagButton\")?.addEventListener(\"click\", () => toggleCart());\n\n$(\"closeCartButton\")?.addEventListener(\"click\", () => toggleCart(false));\n\n$(\"checkoutButton\")?.addEventListener(\"click\", checkout);\n\n$(\"overlay\")?.addEventListener(\"click\", () => toggleCart(false));\n\nrenderCart();\nloadProducts();\nloadKingsmadeHero();", type: "text/javascript; charset=utf-8" }
};

/* ---------------- MAIN WORKER ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method)) {
          return json(
            { error: "Method not allowed." },
            405
          );
        }

        if (!env.DB) {
          return json(
            { error: "Database binding DB is missing." },
            503
          );
        }

        if (path === "/api/products") {
          const products = await getProducts(env);
          return json({ products });
        }

        if (path === "/api/hero") {
          const hero = await getHero(env);
          return json({ hero });
        }

        if (path === "/api/health") {
          return json({
            ok: true,
            service: "KINGSMADE Storefront API"
          });
        }

        return json(
          { error: "API endpoint not found." },
          404
        );
      }

      const asset = PREVIEW_ASSETS[path];
      if (!asset) return secureResponse(new Response("Not found.", { status: 404 }));
      const assetResponse = new Response(request.method === "HEAD" ? null : asset.body, {
        headers: { "Content-Type": asset.type, "Cache-Control": "no-store" }
      });
      const withMetadata = await addSocialMetadata(assetResponse, request, env);
      return secureResponse(withMetadata);

    } catch (error) {
      console.error("KINGSMADE storefront error:", error);

      return json(
        { error: "Storefront service temporarily unavailable." },
        500
      );
    }
  }
};