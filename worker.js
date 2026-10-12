
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/products") {
      if (request.method !== "GET") {
        return Response.json(
          { error: "Method not allowed" },
          { status: 405 }
        );
      }

      try {
        const { results } = await env.DB.prepare(
          `SELECT id, name, description, price_ngn, category,
           image_url, sizes_json, colors_json, stock_quantity, is_active
           FROM products
           WHERE is_active = 1
           ORDER BY created_at DESC`
        ).all();

        return Response.json({ products: results });
      } catch (error) {
        return Response.json(
          { error: "Unable to load products" },
          { status: 500 }
        );
      }
    }

    if (url.pathname.startsWith("/api/")) {
      return Response.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    return env.ASSETS.fetch(request);
  }
};
