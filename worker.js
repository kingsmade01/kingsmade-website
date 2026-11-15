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
  headers.set("Strict-Transport-Security", "max-age=31536000");

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
      return secureResponse(assetResponse);

    } catch (error) {
      console.error("KINGSMADE storefront error:", error);

      return json(
        { error: "Storefront service temporarily unavailable." },
        500
      );
    }
  }
};