/* =====================================================
   KINGSMADE STOREFRONT
   Dynamic products + shopping cart
   Currency: Nigerian Naira
   ===================================================== */

let products = [];
let cart = [];

const naira = n =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format(Number(n) || 0);

const $ = id => document.getElementById(id);

function safeImageURL(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url, location.origin);

    if (
      parsed.origin === location.origin ||
      parsed.protocol === "https:"
    ) {
      return parsed.href;
    }
  } catch {}

  return "";
}

/* ---------------- LOAD PRODUCTS ---------------- */

async function loadProducts() {
  const container = $("products");

  container.replaceChildren();

  const loading = document.createElement("p");
  loading.textContent = "Loading KINGSMADE collection...";
  container.appendChild(loading);

  try {
    const response = await fetch("/api/products", {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Unable to retrieve products.");
    }

    const data = await response.json();

    if (!Array.isArray(data.products)) {
      throw new Error("Invalid product information received.");
    }

    products = data.products
      .filter(p => Number(p.is_active) === 1)
      .map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || "",
        category: p.category || "",
        price: Number(p.price_ngn),
        image: p.image_url || "",
        stock: Math.max(0, Number(p.stock_quantity) || 0),
        sizes: parseList(p.sizes_json),
        colors: parseList(p.colors_json)
      }));

    renderProducts();
    updateCartAvailability();

  } catch (error) {
    console.error("KINGSMADE product loading:", error);

    container.replaceChildren();

    const message = document.createElement("p");
    message.textContent =
      "Our collection is temporarily unavailable. Please refresh the page.";

    container.appendChild(message);
  }
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ---------------- DISPLAY PRODUCTS ---------------- */

function renderProducts() {
  const container = $("products");

  container.replaceChildren();

  if (!products.length) {
    const empty = document.createElement("p");
    empty.textContent = "New KINGSMADE products coming soon.";
    container.appendChild(empty);
    return;
  }

  products.forEach(product => {
    const card = document.createElement("article");
    card.className = "card";

    const imageBox = document.createElement("div");
    imageBox.className = "product-img";

    const imageURL = safeImageURL(product.image);

    if (imageURL) {
      const image = document.createElement("img");
      image.src = imageURL;
      image.alt = product.name;
      image.loading = "lazy";
      image.onerror = () => {
        image.remove();
        imageBox.textContent = "KM";
      };

      imageBox.appendChild(image);
    } else {
      imageBox.textContent = "KM";
    }

    const body = document.createElement("div");
    body.className = "card-body";

    const name = document.createElement("h3");
    name.textContent = product.name;

    const category = document.createElement("p");
    category.className = "product-category";
    category.textContent = product.category;

    const description = document.createElement("p");
    description.className = "product-description";
    description.textContent = product.description;

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = naira(product.price);

    body.append(name);

    if (product.category) body.append(category);
    if (product.description) body.append(description);

    if (product.sizes.length) {
      const sizes = document.createElement("p");
      sizes.className = "product-options";
      sizes.textContent = "Sizes: " + product.sizes.join(", ");
      body.append(sizes);
    }

    if (product.colors.length) {
      const colors = document.createElement("p");
      colors.className = "product-options";
      colors.textContent = "Colours: " + product.colors.join(", ");
      body.append(colors);
    }

    body.append(price);

    const stock = document.createElement("p");
    stock.className = "product-stock";

    const button = document.createElement("button");
    button.className = "add";

    if (product.stock <= 0) {
      stock.textContent = "Out of stock";
      button.textContent = "Out of stock";
      button.disabled = true;
    } else {
      stock.textContent =
        product.stock <= 5
          ? "Only " + product.stock + " left"
          : "In stock";

      button.textContent = "Add to cart";
      button.addEventListener("click", () => add(product.id));
    }

    body.append(stock, button);
    card.append(imageBox, body);
    container.appendChild(card);
  });
}

/* ---------------- SHOPPING CART ---------------- */

function add(id) {
  const product = products.find(p => String(p.id) === String(id));

  if (!product || product.stock <= 0) return;

  const item = cart.find(x => String(x.id) === String(id));

  if (item) {
    if (item.qty >= product.stock) {
      alert("You have reached the available stock quantity.");
      return;
    }

    item.qty++;
  } else {
    cart.push({
      ...product,
      qty: 1
    });
  }

  renderCart();
  toggleCart(true);
}

function changeQuantity(id, amount) {
  const item = cart.find(x => String(x.id) === String(id));
  if (!item) return;

  const product = products.find(p => String(p.id) === String(id));

  const next = item.qty + amount;

  if (next <= 0) {
    cart = cart.filter(x => String(x.id) !== String(id));
  } else if (!product || next > product.stock) {
    alert("Not enough stock available.");
    return;
  } else {
    item.qty = next;
  }

  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(x => String(x.id) !== String(id));
  renderCart();
}

/* ---------------- DISPLAY CART ---------------- */

function renderCart() {
  const cartItems = $("cartItems");

  cartItems.replaceChildren();

  const count = cart.reduce((sum, item) => sum + item.qty, 0);

  $("cartCount").textContent = count;

  if (!cart.length) {
    const empty = document.createElement("p");
    empty.textContent = "Your cart is empty.";
    cartItems.appendChild(empty);
  }

  cart.forEach(item => {
    const line = document.createElement("div");
    line.className = "cart-line";

    const details = document.createElement("div");

    const name = document.createElement("b");
    name.textContent = item.name;

    const quantity = document.createElement("div");
    quantity.textContent = "Qty: " + item.qty;

    const controls = document.createElement("div");
    controls.className = "cart-controls";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.textContent = "−";
    minus.addEventListener("click", () =>
      changeQuantity(item.id, -1)
    );

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.addEventListener("click", () =>
      changeQuantity(item.id, 1)
    );

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () =>
      removeFromCart(item.id)
    );

    controls.append(minus, plus, remove);

    details.append(name, quantity, controls);

    const price = document.createElement("strong");
    price.textContent = naira(item.price * item.qty);

    line.append(details, price);
    cartItems.appendChild(line);
  });

  const total = cart.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  $("cartTotal").textContent = naira(total);
}

/* ---------------- CART PANEL ---------------- */

function toggleCart(force) {
  const cartPanel = $("cart");
  const overlay = $("overlay");

  const open =
    force === true ||
    !cartPanel.classList.contains("open");

  cartPanel.classList.toggle("open", open);
  overlay.classList.toggle("open", open);
}

function updateCartAvailability() {
  cart = cart.filter(item => {
    const product = products.find(
      p => String(p.id) === String(item.id)
    );

    if (!product) return false;

    item.price = product.price;
    item.name = product.name;
    item.stock = product.stock;

    item.qty = Math.min(item.qty, product.stock);

    return item.qty > 0;
  });

  renderCart();
}

/* ---------------- CHECKOUT ---------------- */

function checkout() {
  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  alert(
    "Your KINGSMADE cart is ready. " +
    "Payment processing has not yet been connected."
  );
}

/* ---------------- INITIALISE STORE ---------------- */

renderCart();
loadProducts();
