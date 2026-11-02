/* =====================================================
   KINGSMADE MAIN WEBSITE WORKER
   Public storefront API + static website

   D1 binding: DB
   Static assets binding: ASSETS

   Admin dashboard remains on the separate test Worker.
   ===================================================== */

const DEFAULT_HERO = {
  heading: "DRESS LIKE YOU MEAN IT.",
  subtitle: "Discover the KINGSMADE collection.",
  image_url: "",
  button_text: "SHOP COLLECTION",
  button_url: "/#shop",
  is_visible: 1
};

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

/* ---------------- PUBLIC PRODUCTS ---------------- */

async function getProducts(env) {
  const result = await env.DB.prepare(`
    SELECT
      id,
      name,
      description,
      price_ngn,
      category,
      image_url,
      sizes_json,
      colors_json,
      stock_quantity,
      is_active
    FROM products
    WHERE is_active = 1
    ORDER BY id DESC
  `).all();

  return result.results || [];
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

    return {
      ...DEFAULT_HERO,
      ...saved
    };

  } catch (error) {
    // The admin Worker creates this table.
    // Until then, display the default homepage hero.
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

      // Public product catalogue
      if (path === "/api/products") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return json(
            { error: "Method not allowed." },
            405
          );
        }

        const products = await getProducts(env);

        return json({ products });
      }

      // Public homepage hero settings
      if (path === "/api/hero") {
        if (!["GET", "HEAD"].includes(request.method)) {
          return json(
            { error: "Method not allowed." },
            405
          );
        }

        const hero = await getHero(env);

        return json({ hero });
      }

      // API health check
      if (path === "/api/health") {
        return json({
          ok: true,
          service: "KINGSMADE Storefront API"
        });
      }

      // Prevent unknown API requests from becoming homepage HTML.
      if (path.startsWith("/api/")) {
        return json(
          { error: "API endpoint not found." },
          404
        );
      }

      // Serve the existing HTML, CSS, JS and images.
      if (!env.ASSETS) {
        return new Response(
          "Static assets binding ASSETS is missing.",
          { status: 503 }
        );
      }

      return await env.ASSETS.fetch(request);

    } catch (error) {
      console.error("KINGSMADE storefront error:", error);

      return json(
        { error: "Storefront service temporarily unavailable." },
        500
      );
    }
  }
};
