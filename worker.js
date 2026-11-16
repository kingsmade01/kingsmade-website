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

const DEFAULT_CATEGORIES = [{"id":"mens-clothing","name":"Men's Clothing","slug":"mens-clothing","image_url":"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":0},{"id":"shirts","name":"Shirts","slug":"shirts","image_url":"https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":1},{"id":"trousers","name":"Trousers","slug":"trousers","image_url":"https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":2},{"id":"traditional-wear","name":"Traditional Wear","slug":"traditional-wear","image_url":"https://images.unsplash.com/photo-1592878904946-b3cd8ae243d0?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":3},{"id":"fabrics","name":"Fabrics","slug":"fabrics","image_url":"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":4},{"id":"shoes","name":"Shoes","slug":"shoes","image_url":"https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":5},{"id":"watches","name":"Watches","slug":"watches","image_url":"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":6},{"id":"bracelets","name":"Bracelets","slug":"bracelets","image_url":"https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":7},{"id":"caps","name":"Caps","slug":"caps","image_url":"https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":8},{"id":"bags-and-accessories","name":"Bags & Accessories","slug":"bags-and-accessories","image_url":"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=85","is_active":true,"sort_order":9}];



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
  "/": { body: "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#071b33\">\n<meta name=\"description\" content=\"KINGSMADE — Premium menswear. Style is a statement. Excellence is a standard.\">\n<title>KINGSMADE | An Expression of Excellence</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<link rel=\"stylesheet\" href=\"/style.css\">\n</head>\n<body>\n<header class=\"site-header reference-header\">\n  <a class=\"brand\" href=\"/\" aria-label=\"KINGSMADE home\"><span>KINGSMADE</span></a>\n  <nav class=\"desktop-nav\" aria-label=\"Main navigation\"><a class=\"active\" href=\"/\">Home</a><a href=\"#categories\">Shop⌄</a><a href=\"#about\">About</a><a href=\"#footer\">Contact</a></nav>\n  <div class=\"header-actions\"><label class=\"store-search\"><input id=\"storeSearch\" type=\"search\" placeholder=\"Search products…\" aria-label=\"Search products\"><span>⌕</span></label>\n  <button class=\"bag-btn\" type=\"button\" aria-label=\"Open shopping bag\"><span class=\"bag-icon\">♧</span><span id=\"cartCount\">0</span></button>\n  <button class=\"icon-btn menu-btn\" type=\"button\" aria-label=\"Open menu\" aria-expanded=\"false\">☰</button></div>\n</header><nav class=\"mobile-nav\"><a href=\"/\">Home</a><a href=\"#categories\">Shop by category</a><a href=\"#about\">About</a><a href=\"#footer\">Contact</a></nav>\n<main>\n<section class=\"hero reference-hero\" id=\"homepageHero\" aria-label=\"KINGSMADE featured collection\">\n<img id=\"heroBackground\" class=\"hero-image\" alt=\"\" hidden><div class=\"hero-shade\"></div>\n<div class=\"hero-content\"><p class=\"eyebrow\" id=\"heroEyebrow\">CRAFT FOR KINGS</p><h1 id=\"heroHeading\">KINGSMADE</h1><p class=\"hero-copy\" id=\"heroSubtitle\">SIMPLE / CLEAN / TIMELESS</p><a class=\"shop-btn\" id=\"heroButton\" href=\"#shop\">START SHOPPING</a></div>\n<div class=\"hero-signature\"><svg class=\"km-monogram\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"200 250 1200 1100\" role=\"img\" aria-label=\"KINGSMADE KM monogram\"><path fill=\"#c6a36b\" fill-rule=\"evenodd\" d=\"M 556 832 560 836 574 840 592 857 656 928 656 930 708 990 769 1057 800 1087 827 1105 859 1118 878 1122 900 1123 917 1121 942 1115 960 1107 964 1107 995 1092 976 1090 957 1084 935 1071 917 1056 892 1030 734 849 709 824 688 808 654 794 644 792 620 792 599 800 Z M 673 737 679 746 740 810 818 898 892 978 895 978 930 938 987 865 1000 851 1003 845 1078 757 1080 764 1080 1022 1078 1039 1074 1054 1061 1076 1044 1091 1017 1104 1021 1106 1258 1105 1257 1102 1243 1098 1225 1088 1211 1076 1199 1060 1189 1029 1187 991 1188 688 1190 673 1196 652 1203 640 1229 616 1248 607 1255 606 1259 603 1258 602 1104 602 1076 643 929 839 927 839 895 806 882 790 765 664 759 666 746 678 705 709 Z M 942 501 716 500 715 503 729 508 740 519 743 525 741 542 734 551 706 580 665 618 568 704 547 725 516 752 514 752 513 576 516 561 526 539 544 520 556 512 579 504 582 501 344 500 344 503 356 505 375 514 395 531 407 553 411 575 412 991 409 1028 399 1054 393 1062 376 1077 355 1088 346 1090 343 1093 582 1094 583 1092 581 1090 562 1084 540 1071 525 1054 516 1033 513 1019 513 833 580 780 636 732 654 719 868 539 896 519 914 510 940 503 Z\"/></svg></div><div class=\"hero-wave hero-wave-left\"></div><div class=\"hero-wave hero-wave-right\"></div><div class=\"hero-dots\" id=\"heroDots\" aria-label=\"Choose hero slide\"></div></section>\n\n<section class=\"categories section-wrap reference-categories\" id=\"categories\">\n<div class=\"reference-section-heading\"><span></span><h2>SHOP BY CATEGORY</h2><span></span></div><div class=\"category-grid\">\n<a class=\"category-tile\" href=\"/category/men-s-clothing\" data-category=\"Men's Clothing\"><img src=\"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=85\" alt=\"Men's clothing\"><span>MEN'S<br>CLOTHING</span></a>\n<a class=\"category-tile\" href=\"/category/shirts\" data-category=\"Shirts\"><img src=\"https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=700&q=85\" alt=\"Shirts\"><span>SHIRTS</span></a>\n<a class=\"category-tile\" href=\"/category/trousers\" data-category=\"Trousers\"><img src=\"https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=700&q=85\" alt=\"Trousers\"><span>TROUSERS</span></a>\n<a class=\"category-tile\" href=\"/category/traditional-wear\" data-category=\"Traditional Wear\"><img src=\"https://images.unsplash.com/photo-1592878904946-b3cd8ae243d0?auto=format&fit=crop&w=700&q=85\" alt=\"Traditional wear\"><span>TRADITIONAL<br>WEAR</span></a>\n<a class=\"category-tile\" href=\"/category/fabrics\" data-category=\"Fabrics\"><img src=\"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=700&q=85\" alt=\"Shadda yards and fabrics\"><span>SHADDA, YARDS &<br>FABRICS</span></a>\n<a class=\"category-tile\" href=\"/category/shoes\" data-category=\"Shoes\"><img src=\"https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=85\" alt=\"Shoes\"><span>SHOES</span></a>\n<a class=\"category-tile\" href=\"/category/watches\" data-category=\"Watches\"><img src=\"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=85\" alt=\"Watches\"><span>WATCHES</span></a>\n<a class=\"category-tile\" href=\"/category/bracelets\" data-category=\"Bracelets\"><img src=\"https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=700&q=85\" alt=\"Bracelets\"><span>BRACELETS</span></a>\n<a class=\"category-tile\" href=\"/category/caps\" data-category=\"Caps\"><img src=\"https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=700&q=85\" alt=\"Caps\"><span>CAPS</span></a>\n<a class=\"category-tile\" href=\"/category/bags-and-accessories\" data-category=\"Bags & Accessories\"><img src=\"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=85\" alt=\"Bags and accessories\"><span>BAGS &<br>ACCESSORIES</span></a>\n</div></section>\n<section class=\"collection section-wrap reference-products\" id=\"shop\"><div class=\"reference-section-heading\"><span></span><h2>FEATURED PRODUCTS</h2><span></span></div><div id=\"products\" class=\"grid\"><p>Loading KINGSMADE collection...</p></div></section>\n\n</main>\n\n<section id=\"checkoutPage\" class=\"checkout-page\" hidden aria-labelledby=\"checkoutTitle\">\n  <div class=\"checkout-topline\"><a href=\"/\" id=\"returnToShop\">← CONTINUE SHOPPING</a><span> KINGSMADE PRIVATE CHECKOUT </span></div>\n  <div class=\"checkout-heading\"><p class=\"checkout-kicker\">A REFINED ORDER EXPERIENCE</p><h1 id=\"checkoutTitle\">Complete your order</h1><p>Your details are used only to prepare and deliver your order.</p></div>\n  <div class=\"checkout-layout\">\n    <div class=\"checkout-main\">\n      <ol class=\"checkout-progress\" aria-label=\"Checkout progress\">\n        <li class=\"active\" data-step-indicator=\"1\"><span>01</span><b>Delivery details</b></li>\n        <li data-step-indicator=\"2\"><span>02</span><b>Delivery method</b></li>\n        <li data-step-indicator=\"3\"><span>03</span><b>Review</b></li>\n      </ol>\n      <form id=\"checkoutForm\" novalidate>\n        <section class=\"checkout-step\" data-checkout-step=\"1\">\n          <div class=\"checkout-step-heading\"><span>01</span><div><h2>Where should we deliver?</h2><p>Please provide accurate contact and address details.</p></div></div>\n          <div class=\"checkout-fields\">\n            <label class=\"field full\"><span>Full name *</span><input name=\"full_name\" autocomplete=\"name\" required maxlength=\"120\" placeholder=\"Your full name\"></label>\n            <label class=\"field\"><span>Email address *</span><input name=\"email\" type=\"email\" autocomplete=\"email\" required maxlength=\"160\" placeholder=\"you@example.com\"></label>\n            <label class=\"field\"><span>Phone number *</span><input name=\"phone\" type=\"tel\" autocomplete=\"tel\" required maxlength=\"30\" placeholder=\"+234\"></label>\n            <label class=\"field full\"><span>WhatsApp number <em>Optional</em></span><input name=\"whatsapp\" type=\"tel\" maxlength=\"30\" placeholder=\"If different from your phone number\"></label>\n            <label class=\"field\"><span>Country *</span><input name=\"country\" autocomplete=\"country-name\" required maxlength=\"80\" value=\"Nigeria\"></label>\n            <label class=\"field\"><span>State / Region *</span><input name=\"state\" autocomplete=\"address-level1\" required maxlength=\"100\" placeholder=\"State or region\"></label>\n            <label class=\"field\"><span>City *</span><input name=\"city\" autocomplete=\"address-level2\" required maxlength=\"100\" placeholder=\"City\"></label>\n            <label class=\"field\"><span>Area / Neighbourhood *</span><input name=\"area\" required maxlength=\"120\" placeholder=\"Area or neighbourhood\"></label>\n            <label class=\"field full\"><span>Street address *</span><input name=\"address_line1\" autocomplete=\"address-line1\" required maxlength=\"180\" placeholder=\"Street name and address\"></label>\n            <label class=\"field\"><span>House / Building number *</span><input name=\"building_number\" required maxlength=\"60\" placeholder=\"House or building number\"></label>\n            <label class=\"field\"><span>Apartment / Floor <em>Optional</em></span><input name=\"address_line2\" autocomplete=\"address-line2\" maxlength=\"120\" placeholder=\"Apartment, floor, unit\"></label>\n            <label class=\"field full\"><span>Nearby landmark <em>Optional</em></span><input name=\"landmark\" maxlength=\"160\" placeholder=\"A nearby landmark to help our delivery team\"></label>\n            <label class=\"field full\"><span>Delivery instructions <em>Optional</em></span><textarea name=\"delivery_instructions\" rows=\"3\" maxlength=\"500\" placeholder=\"Any helpful delivery notes?\"></textarea></label>\n          </div>\n          <div class=\"checkout-actions\"><span class=\"checkout-secure-note\">Your information is kept private.</span><button type=\"button\" class=\"checkout-primary\" data-checkout-next=\"2\">CONTINUE TO DELIVERY</button></div>\n        </section>\n        <section class=\"checkout-step\" data-checkout-step=\"2\" hidden>\n          <div class=\"checkout-step-heading\"><span>02</span><div><h2>Choose your delivery preference</h2><p>Final delivery availability and charges will be confirmed before payment.</p></div></div>\n          <div class=\"delivery-choice-list\">\n            <label class=\"delivery-choice\"><input type=\"radio\" name=\"delivery_method\" value=\"standard\" checked><span><b>Standard delivery</b><small>Our regular delivery service. Timing and fee confirmed for your address.</small></span><strong>Fee to be confirmed</strong></label>\n            <label class=\"delivery-choice\"><input type=\"radio\" name=\"delivery_method\" value=\"express\"><span><b>Express delivery</b><small>Request priority delivery. Availability depends on your location.</small></span><strong>Fee to be confirmed</strong></label>\n          </div>\n          <p class=\"checkout-info-note\">No delivery fee is being charged at this stage. We will confirm the applicable fee before payment is enabled.</p>\n          <div class=\"checkout-actions\"><button type=\"button\" class=\"checkout-secondary\" data-checkout-back=\"1\">BACK</button><button type=\"button\" class=\"checkout-primary\" data-checkout-next=\"3\">REVIEW YOUR ORDER</button></div>\n        </section>\n        <section class=\"checkout-step\" data-checkout-step=\"3\" hidden>\n          <div class=\"checkout-step-heading\"><span>03</span><div><h2>Review your order</h2><p>Check your items and delivery details before proceeding.</p></div></div>\n          <div id=\"checkoutReview\" class=\"checkout-review\"></div>\n          <div class=\"checkout-info-note payment-not-ready\"><b>Payment is not active yet.</b><br>This checkout preview does not submit an order or collect payment. Order submission and verified payment will be connected and tested in the next stage.</div>\n          <div class=\"checkout-actions\"><button type=\"button\" class=\"checkout-secondary\" data-checkout-back=\"2\">BACK</button><button type=\"button\" class=\"checkout-primary\" disabled aria-disabled=\"true\">PAYMENT NOT YET AVAILABLE</button></div>\n        </section>\n      </form>\n    </div>\n    <aside class=\"checkout-summary\"><div class=\"summary-heading\"><span>YOUR SELECTION</span><h2>Order summary</h2></div><div id=\"checkoutSummaryItems\"></div><div class=\"summary-total\"><span>Items subtotal</span><strong id=\"checkoutSubtotal\">₦0</strong></div><div class=\"summary-delivery\"><span>Delivery</span><strong>To be confirmed</strong></div><div class=\"summary-grand-total\"><span>Estimated total before delivery</span><strong id=\"checkoutGrandTotal\">₦0</strong></div><p>Final total will include the confirmed delivery fee.</p></aside>\n  </div>\n</section>\n<aside id=\"cart\" class=\"cart-panel\" aria-label=\"Shopping cart\">\n <div class=\"cart-head\"><div><small>YOUR SELECTION</small><h2>Shopping bag</h2></div><button type=\"button\" aria-label=\"Close cart\">×</button></div>\n <div id=\"cartItems\"></div>\n <div class=\"cart-total\"><span>Subtotal</span><strong id=\"cartTotal\">₦0</strong></div>\n <button id=\"checkoutButton\" class=\"checkout\" type=\"button\">PROCEED TO CHECKOUT</button>\n <p class=\"cart-note\">Secure checkout · Crafted for kings</p>\n</aside>\n<div id=\"overlay\" class=\"overlay\"></div>\n<footer id=\"footer\"><div class=\"footer-reference\"><div class=\"footer-brand\"><span>KINGSMADE</span></div><div class=\"footer-motto\"><b>CRAFT FOR KINGS.</b><small>SIMPLE / CLEAN / TIMELESS</small></div><div class=\"footer-social\">\n<a class=\"social-icon instagram\" href=\"https://www.instagram.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"Instagram\">\n<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle class=\"instagram-dot\" cx=\"17.5\" cy=\"6.5\" r=\"1.15\"/></svg></a>\n<a class=\"social-icon facebook\" href=\"https://www.facebook.com/profile.php?id=61595227090232\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"Facebook\">\n<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M13.4 21v-8.1h2.8l.42-3.16H13.4V7.72c0-.92.27-1.55 1.6-1.55h1.72V3.34c-.3-.04-1.35-.13-2.57-.13-2.55 0-4.3 1.56-4.3 4.43v2.09H7v3.16h2.85V21h3.55Z\"/></svg></a>\n<a class=\"social-icon x-brand\" href=\"https://x.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"X\">\n<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18.9 2H22l-6.8 7.77L23.2 22h-6.26l-4.9-7.38L5.6 22H2.45l7.27-8.32L1.9 2h6.42l4.43 6.75L18.9 2Zm-1.1 18h1.74L7.36 3.9H5.5L17.8 20Z\"/></svg></a></div></div>\n <div class=\"footer-main\"><div class=\"footer-brand\"><span>KINGSMADE</span><small>CRAFT FOR KINGS</small><p>Premium menswear.<br>Made for those who set the standard.</p></div>\n <div><b>EXPLORE</b><a href=\"#shop\">Shop all</a><a href=\"#categories\">Categories</a><a href=\"#shop\">New arrivals</a></div>\n <div><b>CLIENT CARE</b><a href=\"mailto:kingsmade01@gmail.com\">Contact</a><a href=\"mailto:kingsmade01@gmail.com\">Customer support</a></div>\n <div><b>FOLLOW KINGSMADE</b><a href=\"https://www.instagram.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener\">Instagram</a><a href=\"https://x.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener\">X</a><a href=\"https://www.facebook.com/profile.php?id=61595227090232\" target=\"_blank\" rel=\"noopener\">Facebook</a></div></div>\n <div class=\"footer-bottom\"><span>© 2026 KINGSMADE. ALL RIGHTS RESERVED.</span><span>EST. 2025 · CRAFT FOR KINGS</span></div>\n</footer>\n<script src=\"/script.js\" defer></script>\n\n</body></html>", type: "text/html; charset=utf-8" },
  "/index.html": { body: "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<meta name=\"theme-color\" content=\"#071b33\">\n<meta name=\"description\" content=\"KINGSMADE — Premium menswear. Style is a statement. Excellence is a standard.\">\n<title>KINGSMADE | An Expression of Excellence</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>\n<link href=\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap\" rel=\"stylesheet\">\n<link rel=\"stylesheet\" href=\"/style.css\">\n</head>\n<body>\n<header class=\"site-header reference-header\">\n  <a class=\"brand\" href=\"/\" aria-label=\"KINGSMADE home\"><span>KINGSMADE</span></a>\n  <nav class=\"desktop-nav\" aria-label=\"Main navigation\"><a class=\"active\" href=\"/\">Home</a><a href=\"#categories\">Shop⌄</a><a href=\"#about\">About</a><a href=\"#footer\">Contact</a></nav>\n  <div class=\"header-actions\"><label class=\"store-search\"><input id=\"storeSearch\" type=\"search\" placeholder=\"Search products…\" aria-label=\"Search products\"><span>⌕</span></label>\n  <button class=\"bag-btn\" type=\"button\" aria-label=\"Open shopping bag\"><span class=\"bag-icon\">♧</span><span id=\"cartCount\">0</span></button>\n  <button class=\"icon-btn menu-btn\" type=\"button\" aria-label=\"Open menu\" aria-expanded=\"false\">☰</button></div>\n</header><nav class=\"mobile-nav\"><a href=\"/\">Home</a><a href=\"#categories\">Shop by category</a><a href=\"#about\">About</a><a href=\"#footer\">Contact</a></nav>\n<main>\n<section class=\"hero reference-hero\" id=\"homepageHero\" aria-label=\"KINGSMADE featured collection\">\n<img id=\"heroBackground\" class=\"hero-image\" alt=\"\" hidden><div class=\"hero-shade\"></div>\n<div class=\"hero-content\"><p class=\"eyebrow\" id=\"heroEyebrow\">CRAFT FOR KINGS</p><h1 id=\"heroHeading\">KINGSMADE</h1><p class=\"hero-copy\" id=\"heroSubtitle\">SIMPLE / CLEAN / TIMELESS</p><a class=\"shop-btn\" id=\"heroButton\" href=\"#shop\">START SHOPPING</a></div>\n<div class=\"hero-signature\"><svg class=\"km-monogram\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"200 250 1200 1100\" role=\"img\" aria-label=\"KINGSMADE KM monogram\"><path fill=\"#c6a36b\" fill-rule=\"evenodd\" d=\"M 556 832 560 836 574 840 592 857 656 928 656 930 708 990 769 1057 800 1087 827 1105 859 1118 878 1122 900 1123 917 1121 942 1115 960 1107 964 1107 995 1092 976 1090 957 1084 935 1071 917 1056 892 1030 734 849 709 824 688 808 654 794 644 792 620 792 599 800 Z M 673 737 679 746 740 810 818 898 892 978 895 978 930 938 987 865 1000 851 1003 845 1078 757 1080 764 1080 1022 1078 1039 1074 1054 1061 1076 1044 1091 1017 1104 1021 1106 1258 1105 1257 1102 1243 1098 1225 1088 1211 1076 1199 1060 1189 1029 1187 991 1188 688 1190 673 1196 652 1203 640 1229 616 1248 607 1255 606 1259 603 1258 602 1104 602 1076 643 929 839 927 839 895 806 882 790 765 664 759 666 746 678 705 709 Z M 942 501 716 500 715 503 729 508 740 519 743 525 741 542 734 551 706 580 665 618 568 704 547 725 516 752 514 752 513 576 516 561 526 539 544 520 556 512 579 504 582 501 344 500 344 503 356 505 375 514 395 531 407 553 411 575 412 991 409 1028 399 1054 393 1062 376 1077 355 1088 346 1090 343 1093 582 1094 583 1092 581 1090 562 1084 540 1071 525 1054 516 1033 513 1019 513 833 580 780 636 732 654 719 868 539 896 519 914 510 940 503 Z\"/></svg></div><div class=\"hero-wave hero-wave-left\"></div><div class=\"hero-wave hero-wave-right\"></div><div class=\"hero-dots\" id=\"heroDots\" aria-label=\"Choose hero slide\"></div></section>\n\n<section class=\"categories section-wrap reference-categories\" id=\"categories\">\n<div class=\"reference-section-heading\"><span></span><h2>SHOP BY CATEGORY</h2><span></span></div><div class=\"category-grid\">\n<a class=\"category-tile\" href=\"/category/men-s-clothing\" data-category=\"Men's Clothing\"><img src=\"https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=85\" alt=\"Men's clothing\"><span>MEN'S<br>CLOTHING</span></a>\n<a class=\"category-tile\" href=\"/category/shirts\" data-category=\"Shirts\"><img src=\"https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=700&q=85\" alt=\"Shirts\"><span>SHIRTS</span></a>\n<a class=\"category-tile\" href=\"/category/trousers\" data-category=\"Trousers\"><img src=\"https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=700&q=85\" alt=\"Trousers\"><span>TROUSERS</span></a>\n<a class=\"category-tile\" href=\"/category/traditional-wear\" data-category=\"Traditional Wear\"><img src=\"https://images.unsplash.com/photo-1592878904946-b3cd8ae243d0?auto=format&fit=crop&w=700&q=85\" alt=\"Traditional wear\"><span>TRADITIONAL<br>WEAR</span></a>\n<a class=\"category-tile\" href=\"/category/fabrics\" data-category=\"Fabrics\"><img src=\"https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=700&q=85\" alt=\"Shadda yards and fabrics\"><span>SHADDA, YARDS &<br>FABRICS</span></a>\n<a class=\"category-tile\" href=\"/category/shoes\" data-category=\"Shoes\"><img src=\"https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=85\" alt=\"Shoes\"><span>SHOES</span></a>\n<a class=\"category-tile\" href=\"/category/watches\" data-category=\"Watches\"><img src=\"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=700&q=85\" alt=\"Watches\"><span>WATCHES</span></a>\n<a class=\"category-tile\" href=\"/category/bracelets\" data-category=\"Bracelets\"><img src=\"https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=700&q=85\" alt=\"Bracelets\"><span>BRACELETS</span></a>\n<a class=\"category-tile\" href=\"/category/caps\" data-category=\"Caps\"><img src=\"https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=700&q=85\" alt=\"Caps\"><span>CAPS</span></a>\n<a class=\"category-tile\" href=\"/category/bags-and-accessories\" data-category=\"Bags & Accessories\"><img src=\"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=700&q=85\" alt=\"Bags and accessories\"><span>BAGS &<br>ACCESSORIES</span></a>\n</div></section>\n<section class=\"collection section-wrap reference-products\" id=\"shop\"><div class=\"reference-section-heading\"><span></span><h2>FEATURED PRODUCTS</h2><span></span></div><div id=\"products\" class=\"grid\"><p>Loading KINGSMADE collection...</p></div></section>\n\n</main>\n\n<section id=\"checkoutPage\" class=\"checkout-page\" hidden aria-labelledby=\"checkoutTitle\">\n  <div class=\"checkout-topline\"><a href=\"/\" id=\"returnToShop\">← CONTINUE SHOPPING</a><span> KINGSMADE PRIVATE CHECKOUT </span></div>\n  <div class=\"checkout-heading\"><p class=\"checkout-kicker\">A REFINED ORDER EXPERIENCE</p><h1 id=\"checkoutTitle\">Complete your order</h1><p>Your details are used only to prepare and deliver your order.</p></div>\n  <div class=\"checkout-layout\">\n    <div class=\"checkout-main\">\n      <ol class=\"checkout-progress\" aria-label=\"Checkout progress\">\n        <li class=\"active\" data-step-indicator=\"1\"><span>01</span><b>Delivery details</b></li>\n        <li data-step-indicator=\"2\"><span>02</span><b>Delivery method</b></li>\n        <li data-step-indicator=\"3\"><span>03</span><b>Review</b></li>\n      </ol>\n      <form id=\"checkoutForm\" novalidate>\n        <section class=\"checkout-step\" data-checkout-step=\"1\">\n          <div class=\"checkout-step-heading\"><span>01</span><div><h2>Where should we deliver?</h2><p>Please provide accurate contact and address details.</p></div></div>\n          <div class=\"checkout-fields\">\n            <label class=\"field full\"><span>Full name *</span><input name=\"full_name\" autocomplete=\"name\" required maxlength=\"120\" placeholder=\"Your full name\"></label>\n            <label class=\"field\"><span>Email address *</span><input name=\"email\" type=\"email\" autocomplete=\"email\" required maxlength=\"160\" placeholder=\"you@example.com\"></label>\n            <label class=\"field\"><span>Phone number *</span><input name=\"phone\" type=\"tel\" autocomplete=\"tel\" required maxlength=\"30\" placeholder=\"+234\"></label>\n            <label class=\"field full\"><span>WhatsApp number <em>Optional</em></span><input name=\"whatsapp\" type=\"tel\" maxlength=\"30\" placeholder=\"If different from your phone number\"></label>\n            <label class=\"field\"><span>Country *</span><input name=\"country\" autocomplete=\"country-name\" required maxlength=\"80\" value=\"Nigeria\"></label>\n            <label class=\"field\"><span>State / Region *</span><input name=\"state\" autocomplete=\"address-level1\" required maxlength=\"100\" placeholder=\"State or region\"></label>\n            <label class=\"field\"><span>City *</span><input name=\"city\" autocomplete=\"address-level2\" required maxlength=\"100\" placeholder=\"City\"></label>\n            <label class=\"field\"><span>Area / Neighbourhood *</span><input name=\"area\" required maxlength=\"120\" placeholder=\"Area or neighbourhood\"></label>\n            <label class=\"field full\"><span>Street address *</span><input name=\"address_line1\" autocomplete=\"address-line1\" required maxlength=\"180\" placeholder=\"Street name and address\"></label>\n            <label class=\"field\"><span>House / Building number *</span><input name=\"building_number\" required maxlength=\"60\" placeholder=\"House or building number\"></label>\n            <label class=\"field\"><span>Apartment / Floor <em>Optional</em></span><input name=\"address_line2\" autocomplete=\"address-line2\" maxlength=\"120\" placeholder=\"Apartment, floor, unit\"></label>\n            <label class=\"field full\"><span>Nearby landmark <em>Optional</em></span><input name=\"landmark\" maxlength=\"160\" placeholder=\"A nearby landmark to help our delivery team\"></label>\n            <label class=\"field full\"><span>Delivery instructions <em>Optional</em></span><textarea name=\"delivery_instructions\" rows=\"3\" maxlength=\"500\" placeholder=\"Any helpful delivery notes?\"></textarea></label>\n          </div>\n          <div class=\"checkout-actions\"><span class=\"checkout-secure-note\">Your information is kept private.</span><button type=\"button\" class=\"checkout-primary\" data-checkout-next=\"2\">CONTINUE TO DELIVERY</button></div>\n        </section>\n        <section class=\"checkout-step\" data-checkout-step=\"2\" hidden>\n          <div class=\"checkout-step-heading\"><span>02</span><div><h2>Choose your delivery preference</h2><p>Final delivery availability and charges will be confirmed before payment.</p></div></div>\n          <div class=\"delivery-choice-list\">\n            <label class=\"delivery-choice\"><input type=\"radio\" name=\"delivery_method\" value=\"standard\" checked><span><b>Standard delivery</b><small>Our regular delivery service. Timing and fee confirmed for your address.</small></span><strong>Fee to be confirmed</strong></label>\n            <label class=\"delivery-choice\"><input type=\"radio\" name=\"delivery_method\" value=\"express\"><span><b>Express delivery</b><small>Request priority delivery. Availability depends on your location.</small></span><strong>Fee to be confirmed</strong></label>\n          </div>\n          <p class=\"checkout-info-note\">No delivery fee is being charged at this stage. We will confirm the applicable fee before payment is enabled.</p>\n          <div class=\"checkout-actions\"><button type=\"button\" class=\"checkout-secondary\" data-checkout-back=\"1\">BACK</button><button type=\"button\" class=\"checkout-primary\" data-checkout-next=\"3\">REVIEW YOUR ORDER</button></div>\n        </section>\n        <section class=\"checkout-step\" data-checkout-step=\"3\" hidden>\n          <div class=\"checkout-step-heading\"><span>03</span><div><h2>Review your order</h2><p>Check your items and delivery details before proceeding.</p></div></div>\n          <div id=\"checkoutReview\" class=\"checkout-review\"></div>\n          <div class=\"checkout-info-note payment-not-ready\"><b>Payment is not active yet.</b><br>This checkout preview does not submit an order or collect payment. Order submission and verified payment will be connected and tested in the next stage.</div>\n          <div class=\"checkout-actions\"><button type=\"button\" class=\"checkout-secondary\" data-checkout-back=\"2\">BACK</button><button type=\"button\" class=\"checkout-primary\" disabled aria-disabled=\"true\">PAYMENT NOT YET AVAILABLE</button></div>\n        </section>\n      </form>\n    </div>\n    <aside class=\"checkout-summary\"><div class=\"summary-heading\"><span>YOUR SELECTION</span><h2>Order summary</h2></div><div id=\"checkoutSummaryItems\"></div><div class=\"summary-total\"><span>Items subtotal</span><strong id=\"checkoutSubtotal\">₦0</strong></div><div class=\"summary-delivery\"><span>Delivery</span><strong>To be confirmed</strong></div><div class=\"summary-grand-total\"><span>Estimated total before delivery</span><strong id=\"checkoutGrandTotal\">₦0</strong></div><p>Final total will include the confirmed delivery fee.</p></aside>\n  </div>\n</section>\n<aside id=\"cart\" class=\"cart-panel\" aria-label=\"Shopping cart\">\n <div class=\"cart-head\"><div><small>YOUR SELECTION</small><h2>Shopping bag</h2></div><button type=\"button\" aria-label=\"Close cart\">×</button></div>\n <div id=\"cartItems\"></div>\n <div class=\"cart-total\"><span>Subtotal</span><strong id=\"cartTotal\">₦0</strong></div>\n <button id=\"checkoutButton\" class=\"checkout\" type=\"button\">PROCEED TO CHECKOUT</button>\n <p class=\"cart-note\">Secure checkout · Crafted for kings</p>\n</aside>\n<div id=\"overlay\" class=\"overlay\"></div>\n<footer id=\"footer\"><div class=\"footer-reference\"><div class=\"footer-brand\"><span>KINGSMADE</span></div><div class=\"footer-motto\"><b>CRAFT FOR KINGS.</b><small>SIMPLE / CLEAN / TIMELESS</small></div><div class=\"footer-social\">\n<a class=\"social-icon instagram\" href=\"https://www.instagram.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"Instagram\">\n<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle class=\"instagram-dot\" cx=\"17.5\" cy=\"6.5\" r=\"1.15\"/></svg></a>\n<a class=\"social-icon facebook\" href=\"https://www.facebook.com/profile.php?id=61595227090232\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"Facebook\">\n<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M13.4 21v-8.1h2.8l.42-3.16H13.4V7.72c0-.92.27-1.55 1.6-1.55h1.72V3.34c-.3-.04-1.35-.13-2.57-.13-2.55 0-4.3 1.56-4.3 4.43v2.09H7v3.16h2.85V21h3.55Z\"/></svg></a>\n<a class=\"social-icon x-brand\" href=\"https://x.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener noreferrer\" aria-label=\"X\">\n<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M18.9 2H22l-6.8 7.77L23.2 22h-6.26l-4.9-7.38L5.6 22H2.45l7.27-8.32L1.9 2h6.42l4.43 6.75L18.9 2Zm-1.1 18h1.74L7.36 3.9H5.5L17.8 20Z\"/></svg></a></div></div>\n <div class=\"footer-main\"><div class=\"footer-brand\"><span>KINGSMADE</span><small>CRAFT FOR KINGS</small><p>Premium menswear.<br>Made for those who set the standard.</p></div>\n <div><b>EXPLORE</b><a href=\"#shop\">Shop all</a><a href=\"#categories\">Categories</a><a href=\"#shop\">New arrivals</a></div>\n <div><b>CLIENT CARE</b><a href=\"mailto:kingsmade01@gmail.com\">Contact</a><a href=\"mailto:kingsmade01@gmail.com\">Customer support</a></div>\n <div><b>FOLLOW KINGSMADE</b><a href=\"https://www.instagram.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener\">Instagram</a><a href=\"https://x.com/kingsmadebrand/\" target=\"_blank\" rel=\"noopener\">X</a><a href=\"https://www.facebook.com/profile.php?id=61595227090232\" target=\"_blank\" rel=\"noopener\">Facebook</a></div></div>\n <div class=\"footer-bottom\"><span>© 2026 KINGSMADE. ALL RIGHTS RESERVED.</span><span>EST. 2025 · CRAFT FOR KINGS</span></div>\n</footer>\n<script src=\"/script.js\" defer></script>\n\n</body></html>", type: "text/html; charset=utf-8" },
  "/style.css": { body: ":root{--ivory:#f5f1e9;--paper:#fbf9f5;--ink:#171613;--muted:#77736b;--gold:#b69a62;--line:#ded8cc;--white:#fff;--serif:\"Cormorant Garamond\",Georgia,serif;--sans:\"DM Sans\",Arial,sans-serif}\n*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--ivory);color:var(--ink);font-family:var(--sans);-webkit-font-smoothing:antialiased}a{color:inherit;text-decoration:none}button{font:inherit}.announcement{height:29px;background:#171613;color:#e9e1d2;display:flex;align-items:center;justify-content:center;gap:13px;font-size:8px;letter-spacing:2px}.announcement span{color:#c6a76c}.site-header{height:88px;padding:0 5.8%;display:flex;align-items:center;justify-content:space-between;background:var(--paper);border-bottom:1px solid #e9e3d9;position:relative;z-index:5}.brand{display:flex;flex-direction:column;align-items:center;min-width:145px}.brand span,.footer-brand>span{font-family:var(--serif);font-weight:600;font-size:28px;letter-spacing:3px}.brand small,.footer-brand small{font-size:7px;letter-spacing:2.5px;margin-top:1px}.desktop-nav{display:flex;gap:27px;align-items:center}.desktop-nav a,.contact-link,.bag-btn{font-size:9px;letter-spacing:1.2px;font-weight:600}.desktop-nav a:hover,.footer-main a:hover{color:var(--gold)}.header-actions{display:flex;align-items:center;gap:22px}.contact-link{border-bottom:1px solid var(--gold);padding-bottom:5px}.bag-btn,.icon-btn{border:0;background:none;cursor:pointer;letter-spacing:1px;font-size:10px}.bag-btn span{display:inline-grid;place-items:center;background:#1b1a17;color:white;border-radius:50%;width:21px;height:21px;margin-left:5px}.menu-btn,.mobile-nav{display:none}.hero{height:min(650px,68vw);min-height:470px;position:relative;overflow:hidden;background:#24211d url(\"https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=2000&q=90\") center 36%/cover no-repeat;color:#fff;display:flex;align-items:center;padding:0 9%}.hero-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 35%;opacity:.3;z-index:0}.hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,8,.88) 0%,rgba(8,8,8,.66) 43%,rgba(8,8,8,.1) 100%);z-index:0}.hero-content{position:relative;z-index:1;max-width:610px}.eyebrow,.section-kicker{font-size:9px;letter-spacing:3px;color:var(--gold);font-weight:600}.hero h1{font:500 clamp(48px,6.4vw,88px)/.91 var(--serif);letter-spacing:-1.5px;margin:24px 0 17px;max-width:700px}.hero-copy{font:italic 19px var(--serif);color:#e6e0d6;margin:0 0 32px}.shop-btn{display:inline-flex;gap:34px;align-items:center;padding:15px 19px;background:#c3a36a;color:#15130f;font-size:9px;letter-spacing:1.5px;font-weight:700}.shop-btn:hover{background:#e0c18a}.hero-signature{position:absolute;right:8%;top:38%;z-index:1;display:flex;flex-direction:column;align-items:center;text-shadow:0 2px 12px #000}.hero-signature span{font:600 70px var(--serif);letter-spacing:-9px}.hero-signature b{font:500 19px var(--serif);letter-spacing:5px}.hero-signature small{font-size:7px;letter-spacing:3px;margin-top:8px}.hero-index{position:absolute;bottom:25px;left:9%;font-size:8px;letter-spacing:2px;color:#d9d1c5}.hero-index i{display:inline-block;width:42px;height:1px;background:var(--gold);vertical-align:middle;margin:0 10px}.intro-strip{height:65px;display:flex;align-items:center;justify-content:center;gap:35px;border-bottom:1px solid var(--line);font-size:8px;letter-spacing:2.4px;color:#625e55}.intro-strip i{font-style:normal;color:var(--gold)}.section-wrap{padding:92px 7% 86px}.section-kicker{text-align:center;margin-bottom:17px}.section-title-row{display:flex;justify-content:space-between;align-items:end;margin-bottom:38px}.section-title-row h2{font:500 clamp(43px,5vw,66px)/.91 var(--serif);letter-spacing:-1px;margin:0}.section-title-row h2 em,.closing-banner h2 em{color:#a88b58;font-weight:400}.section-title-row>p{font:italic 16px/1.5 var(--serif);color:#777168;margin:0 2% 4px 0}.category-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.category-tile{position:relative;display:block;height:260px;overflow:hidden;background:#ddd5c9}.category-tile img{width:100%;height:100%;object-fit:cover;filter:saturate(.68);transition:transform .7s}.category-tile:hover img{transform:scale(1.06)}.category-tile:after{content:\"\";position:absolute;inset:45% 0 0;background:linear-gradient(transparent,rgba(0,0,0,.62))}.category-tile span{position:absolute;bottom:17px;left:17px;color:white;font-size:9px;letter-spacing:1.8px;z-index:1}.collection{background:#f0ece4;padding-top:88px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px 16px}.card{background:#faf8f3;border:1px solid #e6e0d5;min-width:0;transition:transform .25s,box-shadow .25s}.card:hover{transform:translateY(-4px);box-shadow:0 14px 35px #211b1012}.product-img{height:300px;position:relative;overflow:hidden;background:#e7e1d7;display:flex;align-items:center;justify-content:center;color:#27231e;font:500 32px var(--serif);letter-spacing:4px}.product-img img{width:100%;height:100%;object-fit:cover;transition:transform .6s}.card:hover .product-img img{transform:scale(1.04)}.card-body{padding:17px 17px 19px}.card-body h3{font:500 22px var(--serif);margin:0 0 5px}.product-category{font-size:8px;letter-spacing:1.5px;color:#9b8050;text-transform:uppercase;margin:5px 0}.product-description,.product-options,.product-stock{font-size:10px;color:#79746c;line-height:1.7;margin:7px 0}.price{font:600 16px var(--sans);margin:13px 0}.add{width:100%;padding:12px;background:#171613;color:#fff;border:1px solid #171613;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;cursor:pointer}.add:hover{background:#b69a62;border-color:#b69a62;color:#15130f}.add:disabled{opacity:.45;cursor:not-allowed}.closing-banner{min-height:340px;background:linear-gradient(90deg,rgba(8,8,8,.91),rgba(8,8,8,.45)),url(\"https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1800&q=85\") center 40%/cover;color:white;display:flex;align-items:center;padding:55px 9%}.closing-banner>div{max-width:520px}.closing-banner p{font-size:8px;letter-spacing:3px;color:#c9ad78}.closing-banner h2{font:500 62px/.9 var(--serif);margin:20px 0 28px}.closing-banner a{font-size:9px;letter-spacing:1.7px;border-bottom:1px solid #b69a62;padding-bottom:9px}footer{background:#171613;color:#e9e4da;padding:55px 7% 18px}.footer-main{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:35px;padding-bottom:48px}.footer-brand>span{display:block;font-size:30px}.footer-brand small{display:block;color:#c4a66e}.footer-brand p{font:italic 16px/1.5 var(--serif);color:#aaa49a;margin-top:24px}.footer-main>div:not(:first-child){display:flex;flex-direction:column;gap:13px}.footer-main>div>b{font-size:8px;letter-spacing:2px;color:#c4a66e;margin-bottom:8px}.footer-main a{font-size:11px;color:#d0cbc2}.footer-bottom{border-top:1px solid #403c35;padding-top:17px;display:flex;justify-content:space-between;font-size:8px;letter-spacing:1.5px;color:#9b968d}.cart-panel{position:fixed;z-index:20;right:0;top:0;height:100dvh;width:min(430px,100%);background:#fbf9f5;padding:27px;transform:translateX(105%);transition:transform .3s;overflow:auto;box-shadow:-15px 0 50px #0002}.cart-panel.open{transform:translateX(0)}.cart-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:20px}.cart-head small{font-size:8px;letter-spacing:2px;color:var(--gold)}.cart-head h2{font:500 34px var(--serif);margin:5px 0}.cart-head button{border:0;background:none;font-size:28px;cursor:pointer}.cart-line{display:flex;justify-content:space-between;gap:12px;padding:18px 0;border-bottom:1px solid var(--line);font-size:12px}.cart-line strong{white-space:nowrap}.cart-controls{display:flex;gap:7px;margin-top:8px}.cart-controls button{border:1px solid var(--line);background:transparent;padding:5px 10px;cursor:pointer}.cart-controls button:last-child{color:#934747;border:0;text-decoration:underline}.cart-total{display:flex;justify-content:space-between;padding:24px 0;font-size:13px}.checkout{width:100%;padding:16px;background:#171613;color:white;border:0;font-size:9px;letter-spacing:1.5px;cursor:pointer}.cart-note{text-align:center;font:italic 13px var(--serif);color:#817b71}.overlay{position:fixed;inset:0;background:#0007;z-index:19;opacity:0;visibility:hidden;transition:.3s}.overlay.open{opacity:1;visibility:visible}.hero.is-hidden{display:none!important}#products>p{grid-column:1/-1;text-align:center;padding:45px;color:var(--muted)}\n@media(max-width:900px){.site-header{padding:0 4%;height:78px}.desktop-nav{gap:13px}.desktop-nav a{font-size:8px}.contact-link{display:none}.section-wrap{padding:70px 5%}.category-tile{height:210px}.product-img{height:245px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{min-height:490px}.hero-signature{right:6%}.footer-main{grid-template-columns:1.5fr 1fr 1fr;}.footer-main>div:last-child{grid-column:2}}\n@media(max-width:600px){.announcement{font-size:7px;letter-spacing:1.2px}.site-header{height:72px}.brand{min-width:auto}.brand span{font-size:24px}.desktop-nav{display:none}.header-actions{gap:12px}.menu-btn{display:block}.mobile-nav{position:absolute;z-index:4;left:0;right:0;background:var(--paper);padding:0 6%;max-height:0;overflow:hidden;display:flex;flex-direction:column;transition:max-height .25s}.menu-open .mobile-nav{max-height:180px;padding-top:15px;padding-bottom:15px}.mobile-nav a{padding:10px 0;border-top:1px solid var(--line);font-size:11px}.hero{min-height:570px;height:76vh;max-height:700px;padding:0 7%;background-position:62% center}.hero-shade{background:linear-gradient(90deg,rgba(8,8,8,.85),rgba(8,8,8,.32))}.hero h1{font-size:52px;max-width:350px}.hero-copy{font-size:17px;max-width:280px}.hero-signature{right:7%;top:auto;bottom:72px}.hero-signature span{font-size:45px}.hero-signature b{font-size:12px}.hero-index{left:7%;font-size:7px}.intro-strip{height:54px;gap:12px;font-size:6px;letter-spacing:1px}.section-wrap{padding:62px 5%}.section-title-row{display:block}.section-title-row h2{font-size:49px}.section-title-row>p{margin-top:18px;font-size:15px}.category-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.category-tile{height:185px}.category-tile span{font-size:8px;left:11px;bottom:12px}.grid{gap:12px 9px}.product-img{height:210px}.card-body{padding:12px}.card-body h3{font-size:19px}.price{font-size:14px}.add{padding:12px 6px;font-size:8px}.closing-banner{min-height:290px;padding:45px 7%}.closing-banner h2{font-size:53px}.footer-main{grid-template-columns:1fr 1fr;gap:30px 18px}.footer-brand{grid-column:1/-1}.footer-main>div:last-child{grid-column:auto}.footer-bottom{gap:12px;flex-direction:column;font-size:7px}}\n", type: "text/javascript; charset=utf-8" },
};

async function getCategories(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS km_site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)").run();
  const row = await env.DB.prepare("SELECT setting_value FROM km_site_settings WHERE setting_key='categories' LIMIT 1").first();
  let categories = [];
  try { categories = row?.setting_value ? JSON.parse(row.setting_value) : []; } catch {}
  if (!Array.isArray(categories) || !categories.length) categories = DEFAULT_CATEGORIES;
  return categories.filter(category => category && category.is_active !== false).sort((a,b) => Number(a.sort_order||0)-Number(b.sort_order||0));
}

async function getHeroSlides(env) {
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS km_site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)"
    ).run();
    const row = await env.DB.prepare(
      "SELECT setting_value FROM km_site_settings WHERE setting_key='hero_slides' LIMIT 1"
    ).first();
    if (row?.setting_value) {
      const slides = JSON.parse(row.setting_value);
      if (Array.isArray(slides) && slides.length) return slides;
    }
    const legacy = await getHero(env);
    return [{
      id: "default",
      eyebrow: "CRAFT FOR KINGS",
      heading: "KINGSMADE",
      subtitle: "SIMPLE / CLEAN / TIMELESS",
      image_url: legacy.image_url || "",
      button_text: legacy.button_text || "START SHOPPING",
      button_url: legacy.button_url || "#shop",
      is_active: true,
      sort_order: 0
    }];
  } catch (error) {
    if (/no such table/i.test(error.message || "")) {
      return [{
        id: "default",
        eyebrow: "CRAFT FOR KINGS",
        heading: "KINGSMADE",
        subtitle: "SIMPLE / CLEAN / TIMELESS",
        image_url: "",
        button_text: "START SHOPPING",
        button_url: "#shop",
        is_active: true,
        sort_order: 0
      }];
    }
    throw error;
  }
}


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

        if (path === "/api/categories") {
          const categories = await getCategories(env);
          return json({ categories });
        }

        if (path === "/api/hero-slides") {
          const slides = await getHeroSlides(env);
          return json({ slides });
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

      let asset = PREVIEW_ASSETS[path];
      if (!asset && new RegExp("^/category/[a-z0-9-]+/?$", "i").test(path)) asset = PREVIEW_ASSETS["/"];
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