/* ==========================================
   KINGSMADE LUXURY STOREFRONT
   Public storefront — D1 product API
   ========================================== */

const CONFIG = {
  instagram: "", // Add official Instagram URL
  facebook: "",  // Add official Facebook URL
  x: ""          // Add official X URL
};

const state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("km_cart") || "[]"),
  category: "All",
  search: "",
  sort: "newest",
  currency: "NGN"
};

const $ = id => document.getElementById(id);

const naira = amount => new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0
}).format(Number(amount) || 0);

function parseOptions(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(",").map(x => x.trim()).filter(Boolean);
  }
}

function getImage(product) {
  return product.image_url || "";
}

function categoryOf(product) {
  const category = String(product.category || "").toLowerCase();

  if (/shoe|sneaker|footwear|sandal/.test(category)) return "Footwear";
  if (/watch|bracelet|necklace|ring|cap|belt|bag|accessor/.test(category)) return "Accessories";
  if (/fabric|textile|material/.test(category)) return "Materials";
  if (/women|female|ladies/.test(category)) return "Women";
  if (/children|child|kids/.test(category)) return "Children";
  if (/men|male/.test(category)) return "Men";

  return "Clothing";
}

function saveCart() {
  localStorage.setItem("km_cart", JSON.stringify(state.cart));
  renderCart();
}

async function loadProducts() {
  const container = $("products");

  try {
    const response = await fetch("/api/products", {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) throw new Error("Product service unavailable");

    const data = await response.json();

    if (!Array.isArray(data.products)) {
      throw new Error("Invalid product response");
    }

    state.products = data.products
      .filter(p => Number(p.is_active) === 1)
      .map(p => ({
        ...p,
        id: String(p.id),
        price_ngn: Number(p.price_ngn) || 0
      }));

    renderProducts();

  } catch (error) {
    console.error("KINGSMADE product loading:", error);

    container.innerHTML = `
      <div class="loading">
        THE COLLECTION IS TEMPORARILY UNAVAILABLE.
        <br><br>
        PLEASE TRY AGAIN.
        <br><br>
        <button onclick="loadProducts()">RETRY</button>
      </div>
    `;
  }
}

function filteredProducts() {
  let products = [...state.products];

  if (state.category !== "All") {
    products = products.filter(p => {
      const main = categoryOf(p);
      const actual = String(p.category || "").toLowerCase();
      const filter = state.category.toLowerCase();

      return main.toLowerCase() === filter ||
        actual.includes(filter);
    });
  }

  if (state.search) {
    const term = state.search.toLowerCase();

    products = products.filter(p =>
      [p.name, p.description, p.category]
        .some(value => String(value || "").toLowerCase().includes(term))
    );
  }

  if (state.sort === "low") {
    products.sort((a, b) => a.price_ngn - b.price_ngn);
  } else if (state.sort === "high") {
    products.sort((a, b) => b.price_ngn - a.price_ngn);
  } else if (state.sort === "az") {
    products.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    products.sort((a, b) => Number(b.id) - Number(a.id));
  }

  return products;
}

function renderProducts() {
  const container = $("products");
  const products = filteredProducts();

  $("resultCount").textContent =
    `${products.length} PIECE${products.length === 1 ? "" : "S"}`;

  $("emptyState").hidden = products.length !== 0;

  if (!products.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = products.map(p => {
    const image = getImage(p);

    return `
      <article class="product-card">
        <div class="product-image"
             onclick="openProduct('${escapeAttr(p.id)}')">

          ${image
            ? `<img src="${escapeAttr(image)}"
                    alt="${escapeAttr(p.name)}"
                    loading="lazy"
                    onerror="this.style.display='none'">`
            : `<div class="product-placeholder">KM</div>`
          }

        </div>

        <div class="product-info">
          <span class="product-category">
            ${escapeHTML(p.category || "KINGSMADE")}
          </span>

          <h3>${escapeHTML(p.name)}</h3>

          <div class="product-price">${naira(p.price_ngn)}</div>

          <div class="product-actions">
            <button onclick="openProduct('${escapeAttr(p.id)}')">
              DETAILS
            </button>

            <button onclick="addToCart('${escapeAttr(p.id)}')">
              ADD TO BAG
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function escapeAttr(value) {
  return escapeHTML(value);
}

function addToCart(id, size = "", color = "") {
  const product = state.products.find(p => p.id === String(id));

  if (!product) return;

  const key = `${id}-${size}-${color}`;

  const existing = state.cart.find(item => item.key === key);

  if (existing) {
    existing.quantity++;
  } else {
    state.cart.push({
      key,
      id: product.id,
      name: product.name,
      price: product.price_ngn,
      image: product.image_url || "",
      size,
      color,
      quantity: 1
    });
  }

  saveCart();
  openCart();
}

function changeQuantity(key, amount) {
  const item = state.cart.find(x => x.key === key);
  if (!item) return;

  item.quantity += amount;

  if (item.quantity <= 0) {
    state.cart = state.cart.filter(x => x.key !== key);
  }

  saveCart();
}

function removeFromCart(key) {
  state.cart = state.cart.filter(x => x.key !== key);
  saveCart();
}

function renderCart() {
  const count = state.cart.reduce(
    (total, item) => total + item.quantity, 0
  );

  const subtotal = state.cart.reduce(
    (total, item) => total + item.price * item.quantity, 0
  );

  $("cartCount").textContent = count;
  $("cartSubtotal").textContent = naira(subtotal);

  if (!state.cart.length) {
    $("cartItems").innerHTML = "<p>Your bag is empty.</p>";
    return;
  }

  $("cartItems").innerHTML = state.cart.map(item => `
    <div class="cart-item">

      ${item.image
        ? `<img src="${escapeAttr(item.image)}" alt="">`
        : `<div class="cart-item-placeholder"></div>`
      }

      <div class="cart-item-details">
        <h3>${escapeHTML(item.name)}</h3>
        <p>${naira(item.price)}</p>
        <p>
          ${item.size ? "Size: " + escapeHTML(item.size) : ""}
          ${item.color ? " Colour: " + escapeHTML(item.color) : ""}
        </p>

        <div class="quantity-control">
          <button onclick="changeQuantity('${escapeAttr(item.key)}',-1)">−</button>
          <span>${item.quantity}</span>
          <button onclick="changeQuantity('${escapeAttr(item.key)}',1)">+</button>
          <button class="remove-item"
            onclick="removeFromCart('${escapeAttr(item.key)}')">
            REMOVE
          </button>
        </div>
      </div>

      <strong>${naira(item.price * item.quantity)}</strong>
    </div>
  `).join("");
}

function openCart() {
  $("cartDrawer").classList.add("open");
  $("cartOverlay").classList.add("open");
}

function closeCart() {
  $("cartDrawer").classList.remove("open");
  $("cartOverlay").classList.remove("open");
}

function openProduct(id) {
  const product = state.products.find(p => p.id === String(id));
  if (!product) return;

  const sizes = parseOptions(product.sizes_json);
  const colors = parseOptions(product.colors_json);

  const image = product.image_url
    ? `<img src="${escapeAttr(product.image_url)}" alt="${escapeAttr(product.name)}">`
    : `<div class="product-placeholder">KM</div>`;

  $("modalContent").innerHTML = `
    <div class="modal-product-layout">

      <div>${image}</div>

      <div>
        <span class="product-category">
          ${escapeHTML(product.category || "KINGSMADE")}
        </span>

        <h2>${escapeHTML(product.name)}</h2>

        <strong>${naira(product.price_ngn)}</strong>

        <p>${escapeHTML(product.description || "Discover this KINGSMADE piece.")}</p>

        ${sizes.length ? `
          <label for="productSize">SELECT SIZE</label>
          <select id="productSize">
            <option value="">Choose size</option>
            ${sizes.map(s => `<option value="${escapeAttr(s)}">${escapeHTML(s)}</option>`).join("")}
          </select>
        ` : ""}

        ${colors.length ? `
          <label for="productColor">SELECT COLOUR</label>
          <select id="productColor">
            <option value="">Choose colour</option>
            ${colors.map(c => `<option value="${escapeAttr(c)}">${escapeHTML(c)}</option>`).join("")}
          </select>
        ` : ""}

        <button id="modalAdd">ADD TO BAG</button>
      </div>

    </div>
  `;

  $("productModal").classList.add("open");

  $("modalAdd").onclick = () => {
    const size = $("productSize")?.value || "";
    const color = $("productColor")?.value || "";

    if (sizes.length && !size) {
      alert("Please select a size.");
      return;
    }

    if (colors.length && !color) {
      alert("Please select a colour.");
      return;
    }

    closeProduct();
    addToCart(product.id, size, color);
  };
}

function closeProduct() {
  $("productModal").classList.remove("open");
}

function setCategory(category) {
  state.category = category;

  document.querySelectorAll(".filter").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.filter === category
    );
  });

  renderProducts();
}

function initializeSocialLinks(customLinks) {
  const container=document.querySelector(".social-links");
  if(Array.isArray(customLinks)&&customLinks.length&&container){
    container.replaceChildren();
    customLinks.forEach(link=>{
      if(!link.url)return;
      const a=document.createElement("a");
      a.href=link.url;a.target="_blank";a.rel="noopener noreferrer";
      a.textContent=link.label||link.platform||"Social";
      container.appendChild(a);
    });
    return;
  }
  const links = [
    ["instagramLink", CONFIG.instagram],
    ["facebookLink", CONFIG.facebook],
    ["xLink", CONFIG.x]
  ];
  links.forEach(([id, url]) => {
    const element = $(id);
    if (!element) return;
    if (url) element.href = url;
    else element.style.display = "none";
  });
}

function renderManagedHero(slides){
  const hero=document.querySelector(".hero");
  if(!hero||!Array.isArray(slides)||!slides.length)return;
  const active=slides.filter(x=>x&&x.image_url||x&&x.video_url);
  if(!active.length)return;
  let current=0,timer=null;
  const show=index=>{
    current=(index+active.length)%active.length;
    const slide=active[current];
    const image=hero.querySelector(".hero-image");
    const oldVideo=hero.querySelector(".managed-hero-video");
    if(oldVideo)oldVideo.remove();
    if(slide.video_url){
      const video=document.createElement("video");
      video.className="managed-hero-video";
      video.src=slide.video_url;video.autoplay=true;video.muted=true;
      video.loop=true;video.playsInline=true;video.setAttribute("aria-hidden","true");
      video.style.cssText="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.68";
      hero.insertBefore(video,hero.querySelector(".hero-overlay"));
      if(image)image.style.display="none";
      video.play().catch(()=>{});
    }else{
      if(image){image.style.display="block";image.style.backgroundImage="url("+JSON.stringify(slide.image_url)+")";}
    }
    const copy=hero.querySelector(".hero-copy");
    if(copy){
      const set=(selector,value)=>{const el=copy.querySelector(selector);if(el)el.textContent=value||"";};
      set(".hero-overline",slide.subtitle||"");
      set("h1",slide.title||"KINGSMADE");
      set(".hero-slogan",slide.body_text||"");
      const button=copy.querySelector(".hero-button");
      if(button){button.textContent=slide.button_text||"DISCOVER THE COLLECTION";button.href=slide.button_url||"#collection";}
      let desc=copy.querySelector(".hero-description");
      if(!desc){desc=document.createElement("p");desc.className="hero-description";copy.insertBefore(desc,button);}
      desc.textContent=slide.body_text||"";
    }
  };
  show(0);
  if(active.length>1){
    const nav=document.createElement("div");
    nav.className="managed-hero-dots";
    nav.style.cssText="position:absolute;z-index:5;bottom:28px;left:50%;transform:translateX(-50%);display:flex;gap:9px";
    active.forEach((_,i)=>{
      const dot=document.createElement("button");
      dot.type="button";dot.setAttribute("aria-label","Show hero slide "+(i+1));
      dot.style.cssText="width:9px;height:9px;border-radius:50%;border:1px solid #fff;background:"+(i===0?"#c8ad78":"transparent")+";padding:0";
      dot.addEventListener("click",()=>{show(i);[...nav.children].forEach((d,j)=>d.style.background=j===i?"#c8ad78":"transparent");});
      nav.appendChild(dot);
    });
    hero.appendChild(nav);
    timer=setInterval(()=>{show(current+1);[...nav.children].forEach((d,j)=>d.style.background=j===current?"#c8ad78":"transparent");},7000);
  }
}

async function initializeCmsStorefront(){
  try{
    const response=await fetch("/api/storefront",{headers:{"Accept":"application/json"}});
    if(!response.ok)return;
    const data=await response.json();
    renderManagedHero(data.heroes||[]);
    initializeSocialLinks(data.socials||[]);
    if(Array.isArray(data.categories)&&data.categories.length){
      const filters=document.querySelector(".filters");
      if(filters){
        filters.replaceChildren();
        data.categories.forEach(category=>{
          const button=document.createElement("button");
          button.type="button";button.className="filter";
          button.dataset.filter=category.slug;button.textContent=category.name;
          button.addEventListener("click",()=>setCategory(category.slug));
          filters.appendChild(button);
        });
      }
    }
  }catch(error){
    console.warn("KINGSMADE managed content unavailable; using storefront defaults.",error);
    initializeSocialLinks();
  }
}

/* EVENT LISTENERS */

$("cartOpen").addEventListener("click", openCart);
$("cartClose").addEventListener("click", closeCart);
$("cartOverlay").addEventListener("click", closeCart);

$("modalClose").addEventListener("click", closeProduct);

$("productModal").addEventListener("click", event => {
  if (event.target === $("productModal")) closeProduct();
});

$("filterToggle").addEventListener("click", () => {
  $("filterPanel").classList.toggle("filters-hidden");
});

$("mobileMenu").addEventListener("click", () => {
  $("mobileNav").classList.toggle("open");
});

$("mobileNav").querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    $("mobileNav").classList.remove("open");
  });
});

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    setCategory(button.dataset.filter);
  });
});

document.querySelectorAll("[data-category-link]").forEach(link => {
  link.addEventListener("click", () => {
    setCategory(link.dataset.categoryLink);
  });
});

$("productSearch").addEventListener("input", event => {
  state.search = event.target.value.trim();
  renderProducts();
});

$("searchToggle").addEventListener("click", () => {
  $("productSearch").focus();
  $("collection").scrollIntoView({ behavior: "smooth" });
});

$("sortProducts").addEventListener("change", event => {
  state.sort = event.target.value;
  renderProducts();
});

$("currencySelect").addEventListener("change", event => {
  if (event.target.value !== "NGN") {
    alert("Currency conversion will be enabled after connecting a live exchange-rate service. Prices currently display in Nigerian Naira.");
    event.target.value = "NGN";
  }
});

$("checkoutButton").addEventListener("click", () => {
  if (!state.cart.length) {
    alert("Your shopping bag is empty.");
    return;
  }

  alert(
    "KINGSMADE checkout is not yet connected to Paystack. Your bag is saved. No payment has been taken."
  );
});

/* INITIALIZE */

initializeCmsStorefront();
renderCart();
loadProducts();
