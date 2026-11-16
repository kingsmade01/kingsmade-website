/* =====================================================
   KINGSMADE STOREFRONT
   Product catalogue + persistent shopping cart
   Current database price field: price_ngn
   ===================================================== */

"use strict";

let products = [];
let cart = [];

const CART_STORAGE_KEY = "kingsmade_cart_v1";

const $ = id => document.getElementById(id);

const naira = value =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0
  }).format(Number(value) || 0);

function parseList(value) {
  if (Array.isArray(value)) return value;

  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeImageURL(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value, location.origin);

    if (
      url.origin === location.origin ||
      url.protocol === "https:"
    ) {
      return url.href;
    }
  } catch {}

  return "";
}

/* ---------------- CART STORAGE ---------------- */

function saveCart() {
  try {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify(
        cart.map(item => ({
          id: item.id,
          qty: item.qty
        }))
      )
    );
  } catch (error) {
    console.warn("Could not save KINGSMADE cart:", error);
  }
}

function restoreCart() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(CART_STORAGE_KEY) || "[]"
    );

    if (!Array.isArray(saved)) return [];

    return saved
      .filter(item =>
        item &&
        item.id !== undefined &&
        Number.isInteger(Number(item.qty)) &&
        Number(item.qty) > 0
      )
      .map(item => ({
        id: item.id,
        qty: Number(item.qty)
      }));
  } catch {
    return [];
  }
}

/* ---------------- LOAD PRODUCTS ---------------- */

async function loadProducts() {
  const container = $("products");

  if (!container) return;

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
      .filter(product => Number(product.is_active) === 1)
      .map(product => ({
        id: product.id,
        name: String(product.name || "KINGSMADE Product"),
        description: String(product.description || ""),
        category: String(product.category || ""),
        price: Math.max(0, Number(product.price_ngn) || 0),
        image: product.image_url || "",
        stock: Math.max(
          0,
          Math.floor(Number(product.stock_quantity) || 0)
        ),
        sizes: parseList(product.sizes_json),
        colors: parseList(product.colors_json)
      }));

    restoreCartFromStorage();
    renderProducts();
    renderCart();

  } catch (error) {
    console.error("KINGSMADE product loading:", error);

    container.replaceChildren();

    const message = document.createElement("p");
    message.textContent =
      "Our collection is temporarily unavailable. Please refresh the page.";

    container.appendChild(message);
  }
}

/* ---------------- RESTORE CART ---------------- */

function restoreCartFromStorage() {
  const saved = restoreCart();

  cart = saved
    .map(savedItem => {
      const product = products.find(
        item => String(item.id) === String(savedItem.id)
      );

      if (!product || product.stock <= 0) return null;

      return {
        ...product,
        qty: Math.min(savedItem.qty, product.stock)
      };
    })
    .filter(Boolean);

  saveCart();
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
    body.appendChild(name);

    if (product.category) {
      const category = document.createElement("p");
      category.className = "product-category";
      category.textContent = product.category;
      body.appendChild(category);
    }

    if (product.description) {
      const description = document.createElement("p");
      description.className = "product-description";
      description.textContent = product.description;
      body.appendChild(description);
    }

    if (product.sizes.length) {
      const sizes = document.createElement("p");
      sizes.className = "product-options";
      sizes.textContent = "Sizes: " + product.sizes.join(", ");
      body.appendChild(sizes);
    }

    if (product.colors.length) {
      const colors = document.createElement("p");
      colors.className = "product-options";
      colors.textContent = "Colours: " + product.colors.join(", ");
      body.appendChild(colors);
    }

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = naira(product.price);
    body.appendChild(price);

    const stock = document.createElement("p");
    stock.className = "product-stock";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "add";

    if (product.stock <= 0) {
      stock.textContent = "Out of stock";
      button.textContent = "Out of stock";
      button.disabled = true;
    } else {
      stock.textContent = product.stock <= 5
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

/* ---------------- ADD TO CART ---------------- */

function add(id) {
  const product = products.find(
    item => String(item.id) === String(id)
  );

  if (!product || product.stock <= 0) return;

  const item = cart.find(
    entry => String(entry.id) === String(id)
  );

  if (item) {
    if (item.qty >= product.stock) {
      alert("You have reached the available stock quantity.");
      return;
    }

    item.qty += 1;
  } else {
    cart.push({
      ...product,
      qty: 1
    });
  }

  saveCart();
  renderCart();
  toggleCart(true);
}

/* ---------------- CHANGE QUANTITY ---------------- */

function changeQuantity(id, amount) {
  const item = cart.find(
    entry => String(entry.id) === String(id)
  );

  if (!item) return;

  const product = products.find(
    entry => String(entry.id) === String(id)
  );

  const nextQuantity = item.qty + amount;

  if (nextQuantity <= 0) {
    removeFromCart(id);
    return;
  }

  if (!product || nextQuantity > product.stock) {
    alert("Not enough stock available.");
    return;
  }

  item.qty = nextQuantity;

  saveCart();
  renderCart();
}

/* ---------------- REMOVE ITEM ---------------- */

function removeFromCart(id) {
  cart = cart.filter(
    item => String(item.id) !== String(id)
  );

  saveCart();
  renderCart();
}

/* ---------------- DISPLAY CART ---------------- */

function renderCart() {
  const cartItems = $("cartItems");
  if (!cartItems) return;

  cartItems.replaceChildren();

  const count = cart.reduce(
    (sum, item) => sum + item.qty,
    0
  );

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
    minus.setAttribute("aria-label", "Decrease quantity");
    minus.addEventListener("click", () =>
      changeQuantity(item.id, -1)
    );

    const plus = document.createElement("button");
    plus.type = "button";
    plus.textContent = "+";
    plus.setAttribute("aria-label", "Increase quantity");
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

  if (!cartPanel || !overlay) return;

  const open = typeof force === "boolean"
    ? force
    : !cartPanel.classList.contains("open");

  cartPanel.classList.toggle("open", open);
  overlay.classList.toggle("open", open);
}

/* ---------------- CHECKOUT ---------------- */

function checkout() {
  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  alert(
    "KINGSMADE checkout is not connected yet. " +
    "Your cart has been saved. Payment is not available yet."
  );
}

/* ---------------- INITIALISE STORE ---------------- */

renderCart();
loadProducts();