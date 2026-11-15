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

      if (!env.ASSETS) {
        return secureResponse(new Response(
          "Static assets binding ASSETS is missing.",
          { status: 503 }
        ));
      }

      const assetResponse = await env.ASSETS.fetch(request);
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