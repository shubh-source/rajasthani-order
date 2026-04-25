const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const RAZORPAY_KEY_ID = 'rzp_test_SZlNsaYYbenJQA';
const RAZORPAY_KEY_SECRET = 'r8l9u3RlbXAvciop0eexonVi';

const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});

// Initialize Database
const db = new sqlite3.Database('./restaurant.db', (err) => {
    if (err) console.error(err.message);
    else console.log('Connected to the SQLite database.');
});

// Create tables
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT UNIQUE,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        phone TEXT,
        user_name TEXT,
        table_no TEXT,
        items TEXT,
        total_amount REAL,
        payment_method TEXT,
        payment_status TEXT,
        order_status TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS tables_status (
        table_no TEXT PRIMARY KEY,
        status TEXT
    )`);
});

// Helper for sending SQLite queries that return a promise
const runQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
};

const allQuery = (sql, params = []) => {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// --- API ROUTES ---

// 1. Auth: Login/Signup
app.post('/api/auth/login', async (req, res) => {
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone is required' });

    try {
        let rows = await allQuery('SELECT * FROM users WHERE phone = ?', [phone]);
        if (rows.length > 0) {
            // User exists, just log them in
            return res.json({ success: true, user: rows[0], msg: 'Logged in successfully' });
        } else {
            // New user, need name
            if (!name) return res.status(400).json({ error: 'Name is required for signup' });
            await runQuery('INSERT INTO users (phone, name) VALUES (?, ?)', [phone, name]);
            const newUser = await allQuery('SELECT * FROM users WHERE phone = ?', [phone]);
            return res.json({ success: true, user: newUser[0], msg: 'Signed up successfully' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 2. Orders: Place Order
app.post('/api/orders', async (req, res) => {
    const { id, phone, user_name, table_no, items, total_amount, payment_method, payment_status } = req.body;

    // Order structure validation could go here
    const itemsJson = JSON.stringify(items);

    try {
        await runQuery(
            `INSERT INTO orders (id, phone, user_name, table_no, items, total_amount, payment_method, payment_status, order_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
            [id, phone, user_name, table_no, itemsJson, total_amount, payment_method, payment_status || 'pending']
        );

        // Update table status to occupied
        await runQuery(`INSERT OR REPLACE INTO tables_status (table_no, status) VALUES (?, 'occupied')`, [table_no]);

        // Fetch the inserted order
        const newOrder = await allQuery('SELECT * FROM orders WHERE id = ?', [id]);

        // Notify all clients (Kitchen, Admin)
        io.emit('order_update', { action: 'placed', order: newOrder[0] });
        io.emit('table_update', { table_no, status: 'occupied' });

        res.json({ success: true, order: newOrder[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 3. Orders: Get History (Customer)
app.get('/api/orders/user/:phone', async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM orders WHERE phone = ? ORDER BY timestamp DESC', [req.params.phone]);
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 4. Orders: Get All (Admin / Kitchen)
app.get('/api/orders', async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM orders ORDER BY timestamp DESC');
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 5. Orders: Update Status (Kitchen: new -> preparing -> ready | Admin: ready -> served)
app.patch('/api/orders/:id/status', async (req, res) => {
    const { status } = req.body;
    const { id } = req.params;

    try {
        await runQuery('UPDATE orders SET order_status = ? WHERE id = ?', [status, id]);

        const updated = await allQuery('SELECT * FROM orders WHERE id = ?', [id]);
        io.emit('order_update', { action: 'status_change', order: updated[0] });

        // If served, check if it's paid to potentially free up the table
        if (status === 'served') {
            const order = updated[0];
            if (order.payment_status === 'paid') {
                freeTableIfNoActiveOrders(order.table_no);
            }
        }

        res.json({ success: true, order: updated[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 6. Orders: Update Payment (Admin marks Pay Later as Paid)
app.patch('/api/orders/:id/payment', async (req, res) => {
    const { payment_status } = req.body;
    const { id } = req.params;

    try {
        await runQuery('UPDATE orders SET payment_status = ? WHERE id = ?', [payment_status, id]);

        const updated = await allQuery('SELECT * FROM orders WHERE id = ?', [id]);
        io.emit('order_update', { action: 'payment_change', order: updated[0] });

        // If paid and already served, free table
        if (payment_status === 'paid') {
            const order = updated[0];
            if (order.order_status === 'served') {
                freeTableIfNoActiveOrders(order.table_no);
            }
        }

        res.json({ success: true, order: updated[0] });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- RAZORPAY INTEGRATION ---

// Create Order
app.post('/api/pay/create', async (req, res) => {
    try {
        const { amount } = req.body;
        const options = {
            amount: amount * 100, // paise to rupees
            currency: 'INR',
            receipt: 'rx_' + Date.now()
        };
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Verify Payment
app.post('/api/pay/verify', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, local_order_id } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

    if (expectedSignature === razorpay_signature) {
        // Payment is legit!
        await runQuery('UPDATE orders SET payment_status = ? WHERE id = ?', ['paid', local_order_id]);

        const updated = await allQuery('SELECT * FROM orders WHERE id = ?', [local_order_id]);
        if (updated.length > 0) {
            io.emit('order_update', { type: 'payment', order: updated[0] });
            res.json({ success: true, order: updated[0] });
        } else {
            res.json({ success: true, msg: 'Order sync delayed' });
        }
    } else {
        res.status(400).json({ success: false, msg: 'Invalid digital signature' });
    }
});

const CREDENTIALS = {
    admin: { user: "admin", pass: "raj@123" },
    kitchen: { user: "chef", pass: "food@456" },
    super: { user: "super", pass: "boss@789" }
};

app.post('/api/login', (req, res) => {
    const { role, user, pass } = req.body;
    if (CREDENTIALS[role] && CREDENTIALS[role].user === user && CREDENTIALS[role].pass === pass) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// --- SUPER ADMIN REPORTING -- 
app.get('/api/super-stats', async (req, res) => {
    try {
        const total = await allQuery(`SELECT COUNT(*) as count, SUM(total_amount) as gmv FROM orders WHERE payment_status = 'paid'`);
        const today = await allQuery(`SELECT COUNT(*) as count FROM orders WHERE payment_status = 'paid' AND date(timestamp) = date('now')`);
        
        const cAll = total[0].count || 0;
        const gmvAll = total[0].gmv || 0;
        const cToday = today[0].count || 0;
        
        res.json({
            total_orders: cAll,
            total_gmv: gmvAll,
            total_revenue: cAll * 2, // 2 Rs per valid entry
            today_orders: cToday,
            today_revenue: cToday * 2
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

async function freeTableIfNoActiveOrders(table_no) {
    // A table is active if there are any orders for this table that are NOT (served AND paid)
    const active = await allQuery(`
        SELECT COUNT(*) as count FROM orders 
        WHERE table_no = ? AND (order_status != 'served' OR payment_status != 'paid')
    `, [table_no]);

    if (active[0].count === 0) {
        await runQuery(`UPDATE tables_status SET status = 'free' WHERE table_no = ?`, [table_no]);
        io.emit('table_update', { table_no, status: 'free' });
    }
}

// 7. Tables: Get All
app.get('/api/tables', async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM tables_status');
        res.json(rows);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 8. Users: Get All
app.get('/api/users', async (req, res) => {
    try {
        const rows = await allQuery('SELECT * FROM users ORDER BY created_at DESC');

        // Let's also attach total spend and orders per user. We can do complex join, or fetch simple.
        // For simplicity right now, just aggregate on DB:
        const userStats = await allQuery(`
            SELECT u.*, COUNT(o.id) as total_orders, IFNULL(SUM(o.total_amount), 0) as total_spent
            FROM users u
            LEFT JOIN orders o ON u.phone = o.phone
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `);
        res.json(userStats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 9. Admin: Reset Orders
app.delete('/api/orders/reset', async (req, res) => {
    try {
        await runQuery("DELETE FROM orders");
        await runQuery("UPDATE tables_status SET status = 'free'");
        io.emit('order_update', { action: 'reset' });
        io.emit('table_update', { action: 'reset' });
        res.json({ success: true, msg: 'All orders erased.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Socket.io standard connection log
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
