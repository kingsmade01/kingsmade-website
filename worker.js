
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/products" && request.method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, name, description, price_ngn, category, image_url, sizes_json, colors_json, stock_quantity, is_active FROM products WHERE is_active = 1 ORDER BY created_at DESC"
        ).all();

        return Response.json({ products: results });
      } catch (error) {
        return Response.json(
          { error: "Unable to load products" },
          { status: 500 }
        );
      }
    }

    return new Response("KINGSMADE API is running.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
};
