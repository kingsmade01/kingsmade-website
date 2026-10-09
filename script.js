const products=[
 {id:1,name:"KINGSMADE Essential Tee",price:18000},
 {id:2,name:"KINGSMADE Signature Cap",price:12000},
 {id:3,name:"KINGSMADE Shorts",price:16000},
 {id:4,name:"KINGSMADE Tracksuit",price:45000}
];
let cart=[];
const naira=n=>new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:0}).format(n);
function renderProducts(){
 document.getElementById('products').innerHTML=products.map(p=>`
 <article class="card">
  <div class="product-img">KM</div>
  <div class="card-body"><h3>${p.name}</h3><div class="price">${naira(p.price)}</div>
  <button class="add" onclick="add(${p.id})">Add to cart</button></div>
 </article>`).join('');
}
function add(id){const p=products.find(x=>x.id===id);const item=cart.find(x=>x.id===id);item?item.qty++:cart.push({...p,qty:1});renderCart();toggleCart(true)}
function renderCart(){
 document.getElementById('cartCount').textContent=cart.reduce((s,x)=>s+x.qty,0);
 document.getElementById('cartItems').innerHTML=cart.length?cart.map(x=>`
 <div class="cart-line"><div><b>${x.name}</b><br>Qty: ${x.qty}</div><strong>${naira(x.price*x.qty)}</strong></div>`).join(''):'<p>Your cart is empty.</p>';
 document.getElementById('cartTotal').textContent=naira(cart.reduce((s,x)=>s+x.price*x.qty,0));
}
function toggleCart(force){const c=document.getElementById('cart'),o=document.getElementById('overlay');const open=force===true||!c.classList.contains('open');c.classList.toggle('open',open);o.classList.toggle('open',open)}
function checkout(){alert('Checkout is ready for the next step. We will connect a Nigerian payment gateway and order notifications after deployment.')}
renderProducts();renderCart();
