/* =====================================================
   KINGSMADE STOREFRONT
   Product catalogue + persistent shopping cart
   Current database price field: price_ngn
   ===================================================== */

"use strict";

let products = [];
let cart = [];
let selectedCategory = "";
let currentCategoryName = "";

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

  const query=($("storeSearch")?.value||"").trim().toLowerCase();
  const visibleProducts=products.filter(product=>{
    const matchesText=!query||(product.name+" "+(product.category||"")+" "+(product.description||"")).toLowerCase().includes(query);
    const matchesCategory=!selectedCategory||slugifyCategory(product.category)===selectedCategory;
    return matchesText&&matchesCategory;
  });
  if(!visibleProducts.length){const empty=document.createElement("p");empty.textContent="No products match this selection yet.";container.appendChild(empty);return;}
  visibleProducts.forEach(product => {
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

/* ---------------- EDITABLE HERO SLIDER ---------------- */
let heroSlides = [];
let activeHeroSlide = 0;
let heroRotation = null;

function renderHeroDots(){
  const dots=$("heroDots");
  if(!dots)return;
  dots.replaceChildren();
  heroSlides.forEach((slide,index)=>{
    const button=document.createElement("button");
    button.type="button";
    button.className=index===activeHeroSlide?"active":"";
    button.setAttribute("aria-label","Show hero slide "+(index+1));
    button.setAttribute("aria-current",index===activeHeroSlide?"true":"false");
    button.addEventListener("click",()=>showHeroSlide(index,true));
    dots.appendChild(button);
  });
}
function showHeroSlide(index,resetTimer=false){
  if(!heroSlides.length)return;
  activeHeroSlide=(index+heroSlides.length)%heroSlides.length;
  const slide=heroSlides[activeHeroSlide];
  const hero=$("homepageHero");
  const eyebrow=$("heroEyebrow"),heading=$("heroHeading"),subtitle=$("heroSubtitle");
  const button=$("heroButton"),image=$("heroBackground");
  if(!slide||slide.is_active===false)return;
  hero?.classList.remove("is-hidden");
  if(eyebrow)eyebrow.textContent=slide.eyebrow||"CRAFT FOR KINGS";
  if(heading)heading.textContent=slide.heading||"KINGSMADE";
  if(subtitle)subtitle.textContent=slide.subtitle||"SIMPLE / CLEAN / TIMELESS";
  if(button){
    button.textContent=(slide.button_text||"START SHOPPING").replace(/[↗→›»]/g,"").trim();
    const raw=typeof slide.button_url==="string"?slide.button_url.trim():"#shop";
    try{
      const target=new URL(raw,location.origin);
      button.href=(target.origin===location.origin&&["https:","http:"].includes(target.protocol))||
        (target.protocol==="https:"&&target.origin!==location.origin)?target.href:"#shop";
    }catch{button.href="#shop";}
  }
  const imageURL=safeImageURL(slide.image_url||"");
  if(image){
    if(imageURL){image.src=imageURL;image.hidden=false;}
    else{image.removeAttribute("src");image.hidden=true;}
  }
  renderHeroDots();
  if(resetTimer&&heroRotation){
    clearInterval(heroRotation);
    startHeroRotation();
  }
}
function startHeroRotation(){
  if(heroRotation)clearInterval(heroRotation);
  if(heroSlides.filter(s=>s.is_active!==false).length<2)return;
  heroRotation=setInterval(()=>{
    let next=activeHeroSlide;
    for(let tries=0;tries<heroSlides.length;tries++){
      next=(next+1)%heroSlides.length;
      if(heroSlides[next].is_active!==false)break;
    }
    showHeroSlide(next);
  },5000);
}
async function loadKingsmadeHero(){
  try{
    const response=await fetch("/api/hero-slides",{cache:"no-store"});
    if(!response.ok)throw new Error("Hero slides unavailable");
    const data=await response.json();
    heroSlides=Array.isArray(data.slides)?data.slides.filter(s=>s&&s.is_active!==false):[];
  }catch(error){
    console.warn("KINGSMADE hero slider:",error);
    heroSlides=[];
  }
  if(!heroSlides.length){
    heroSlides=[{eyebrow:"CRAFT FOR KINGS",heading:"KINGSMADE",subtitle:"SIMPLE / CLEAN / TIMELESS",image_url:"",button_text:"START SHOPPING",button_url:"#shop",is_active:true}];
  }
  activeHeroSlide=0;
  showHeroSlide(0);
  startHeroRotation();
}
function initStorefrontControls() {
  const menuButton = document.querySelector(".menu-btn");
  const bagButton = document.querySelector(".bag-btn");
  const closeCartButton = document.querySelector(".cart-head button");
  const checkoutButton = $("checkoutButton");
  const overlay = $("overlay");
  menuButton?.addEventListener("click", () => {
    document.body.classList.toggle("menu-open");
    menuButton.setAttribute("aria-expanded", document.body.classList.contains("menu-open") ? "true" : "false");
  });
  bagButton?.addEventListener("click", () => toggleCart());
  closeCartButton?.addEventListener("click", () => toggleCart(false));
  checkoutButton?.addEventListener("click", checkout);
  overlay?.addEventListener("click", () => toggleCart(false));
  document.querySelectorAll(".mobile-nav a").forEach(link => link.addEventListener("click", () => {
    document.body.classList.remove("menu-open");
    menuButton?.setAttribute("aria-expanded", "false");
  }));
}


/* ---------------- SHAREABLE CATEGORY PAGES ---------------- */
function slugifyCategory(value) {
  return String(value || "").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function initCategoryRouting() {
  const tiles = Array.from(document.querySelectorAll(".category-tile[data-category]"));
  const categoryBySlug = new Map();
  tiles.forEach(tile => {
    const name = tile.dataset.category || "", slug = slugifyCategory(name);
    if (!slug) return;
    categoryBySlug.set(slug, name);
    tile.href = "/category/" + slug;
  });
  const match = new RegExp("^/category/([a-z0-9-]+)/?$", "i").exec(location.pathname);
  if (!match) return;
  const slug = match[1].toLowerCase();
  currentCategoryName = categoryBySlug.get(slug) || "";
  selectedCategory = currentCategoryName ? slug : "__category_not_found__";
  const hero = $("homepageHero"), categorySection = $("categories");
  if (hero) hero.hidden = true;
  if (categorySection) categorySection.hidden = true;
  document.querySelectorAll(".desktop-nav a, .mobile-nav a").forEach(link => {
    const href = link.getAttribute("href") || "";
    if (href === "#categories") link.href = "/#categories";
    if (href === "#about" || href === "#footer") link.href = "/#footer";
  });
  const collection = document.querySelector(".reference-products");
  const heading = collection?.querySelector(".reference-section-heading h2");
  if (heading) heading.textContent = currentCategoryName ? currentCategoryName.toUpperCase() : "CATEGORY NOT FOUND";
  const intro = document.createElement("div");
  intro.className = "category-page-intro";
  const back = document.createElement("a");
  back.href = "/#categories";
  back.textContent = "← ALL CATEGORIES";
  const title = document.createElement("h1");
  title.textContent = currentCategoryName || "Category not found";
  const note = document.createElement("p");
  note.textContent = currentCategoryName
    ? "Explore the KINGSMADE " + currentCategoryName.toLowerCase() + " collection."
    : "This category could not be found. Browse all KINGSMADE categories.";
  intro.append(back, title, note);
  collection?.insertBefore(intro, collection.firstChild);
  const search = $("storeSearch");
  if (search) search.placeholder = currentCategoryName ? "Search " + currentCategoryName.toLowerCase() + "…" : "Search products…";
  if (!currentCategoryName) {
    const grid = $("products");
    if (grid) grid.textContent = "Please return to all categories to continue shopping.";
  }
}


async function loadStoreCategories() {
  try {
    const response = await fetch("/api/categories", { cache: "no-store" });
    if (!response.ok) throw new Error("Category settings unavailable");
    const data = await response.json();
    if (!Array.isArray(data.categories)) throw new Error("Invalid category settings");
    const grid = document.querySelector(".category-grid");
    if (grid) {
      grid.replaceChildren();
      data.categories.filter(category => category && category.is_active !== false).forEach(category => {
        const name = String(category.name || "").trim();
        const slug = String(category.slug || slugifyCategory(name));
        if (!name || !slug) return;
        const tile = document.createElement("a");
        tile.className = "category-tile";
        tile.href = "/category/" + slug;
        tile.dataset.category = name;
        const image = document.createElement("img");
        image.src = safeImageURL(category.image_url || "") || "";
        image.alt = name;
        image.loading = "lazy";
        const label = document.createElement("span");
        label.textContent = name.toUpperCase();
        tile.append(image, label);
        grid.appendChild(tile);
      });
    }
  } catch (error) {
    console.warn("KINGSMADE categories:", error);
  } finally {
    initCategoryRouting();
  }
}

/* ---------------- INITIALISE STORE ---------------- */
initStorefrontControls();
$("storeSearch")?.addEventListener("input",renderProducts);
loadStoreCategories();
renderCart();
loadProducts();
loadKingsmadeHero();