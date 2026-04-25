const fs = require('fs');

const v3Html = fs.readFileSync('c:/projects/rajasthani/qr/customer/rajasthani_customer_v3.html', 'utf8');

let html = v3Html;

// 1. Add Socket.io and Login CSS
html = html.replace('</head>', `
    <script src="/socket.io/socket.io.js"></script>
    <style>
        .view { display: none !important; }
        .view.active { display: block !important; }
        #login-view.active { display: flex !important; }
        
        /* Login Form Styles */
        #login-view {
            padding: 40px 20px; text-align: center; height: 100vh; background: var(--white);
            flex-direction: column; justify-content: center;
        }
        .login-box { max-width: 400px; margin: 0 auto; width: 100%; }
        .input-group { margin-bottom: 20px; text-align: left; }
        .input-group label { display: block; font-size: 13px; color: var(--text2); margin-bottom: 8px; font-weight: 600; }
        .input-group input { width: 100%; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 16px; font-family: 'DM Sans', sans-serif;}
        .btn-main { width: 100%; padding: 15px; background: var(--accent); color: white; border: none; border-radius: var(--radius-sm); font-size: 16px; font-weight: 700; cursor: pointer; }
    </style>
</head>`);

// 2. Wrap body content in views
html = html.replace('<body>', `<body>
<div id="login-view" class="view active">
    <div class="login-box">
        <div class="logo-mark" style="margin: 0 auto 20px; width: 60px; height: 60px; font-size: 28px;">R</div>
        <h1 style="font-family: 'Playfair Display', serif; margin-bottom: 5px;">Rajasthani Sweets</h1>
        <p style="color: var(--text3); font-size: 13px; margin-bottom: 30px;">Welcome! Please enter your details.</p>
        
        <div class="input-group">
            <label>Mobile Number</label>
            <input type="tel" id="user-phone" placeholder="10-digit mobile number">
        </div>
        <div class="input-group">
            <label>Your Name</label>
            <input type="text" id="user-name" placeholder="E.g. Shubh Katiyar">
        </div>
        <button class="btn-main" onclick="handleLogin()">Start Ordering</button>
    </div>
</div>

<div id="menu-view" class="view">
`);

// 3. Close wrapper and add authentication/socket JS
html = html.replace('</body>', `</div>
<script>
    let currentUser = null;
    try {
        currentUser = JSON.parse(localStorage.getItem('currentUser'));
    } catch(e) {}
    
    const socket = io();

    if(currentUser) {
        document.getElementById('login-view').classList.remove('active');
        document.getElementById('menu-view').classList.add('active');
    }

    async function handleLogin() {
        const phone = document.getElementById('user-phone').value;
        const name = document.getElementById('user-name').value;
        if(phone.length < 10 || !name) return alert('Enter valid details');
        
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({phone, name})
        });
        currentUser = await res.json();
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        document.getElementById('login-view').classList.remove('active');
        document.getElementById('menu-view').classList.add('active');
    }
</script>
</body>`);

// 4. Update the placeOrder logic to use backend API
const newPlaceOrder = `
async function placeOrder(tot, cb) {
  if(!currentUser) {
     alert('Please login first!');
     return;
  }
  
  document.getElementById('cart-modal').classList.remove('open');
  
  try {
      const itemsStr = JSON.stringify(Object.values(cart).filter(e => e.qty > 0));
      const res = await fetch('/api/orders', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
              user_id: currentUser.id,
              table_no: TABLE,
              items: itemsStr,
              total_amount: tot,
              payment_method: payMethod,
              payment_status: payMethod === 'cash' ? 'pending' : 'paid'
          })
      });
      const data = await res.json();
      var oid = data.orderId || ('RSC-' + (++oidCtr));
      
      document.getElementById('menu-body').innerHTML =
        '<div class="success-wrap">' +
        '<div class="s-icon">🎉</div>' +
        '<div class="s-title">Order Placed!</div>' +
        '<p class="s-sub">Your food is being prepared.<br>We\\'ll serve it right at Table ' + TABLE + '.</p>' +
        '<div class="s-oid">Order #' + oid + ' &nbsp;·&nbsp; Table ' + TABLE + '</div>' +
        (cb > 0 ?
          '<div class="cb-won"><div class="cbw-lbl">🎁 Cashback Credited</div><div class="cbw-amt">₹' + cb + '</div><div class="cbw-sub">Added to wallet — use on your next visit!</div></div>' :
          '<div style="background:#f7f5f2;border:1px solid #e8e4df;border-radius:8px;padding:10px 14px;font-size:12px;color:#6b6560;margin:10px 0;">Pay via UPI or Card next time to earn cashback!</div>') +
        '<div class="eta-box">⏱ Estimated time: 20–30 minutes</div>' +
        '<button class="place-btn" onclick="location.reload()">Order More Items</button>' +
        '</div>';
      
      document.getElementById('active-filters').style.display = 'none';
      document.querySelector('.search-row').style.display = 'none';
      document.querySelector('.cb-strip').style.display = 'none';
      document.getElementById('cart-bar').className = 'cart-bar';
      cart = {};
  } catch(e) {
      alert('Error placing order: ' + e.message);
  }
}
`;

html = html.replace(/function placeOrder\(tot, cb\) \{[\s\S]*?cart = \{\};\n\}/, newPlaceOrder);

fs.writeFileSync('c:/projects/rajasthani/qr/customer/public/customer.html', html, 'utf8');
console.log('Successfully cloned v3.html into public/customer.html and injected SaaS connections!');
