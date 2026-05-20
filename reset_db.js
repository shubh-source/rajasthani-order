require('dotenv').config();

if (process.env.ALLOW_DB_RESET !== 'true') {
    console.error("⚠️ WARNING: DB reset is disabled in production.");
    console.error("Set ALLOW_DB_RESET=true in your .env file to proceed.");
    process.exit(1);
}

const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
});

pool.connect((err) => {
    if (err) {
        console.error("Database connection error:", err.message);
        process.exit(1);
    }
    console.log("Connected to the PostgreSQL database.");
});

(async () => {
    try {
        await pool.query("TRUNCATE TABLE orders");
        console.log("✅ All orders history has been completely erased.");

        await pool.query("UPDATE tables_status SET status = 'free'");
        console.log("✅ All tables are now free.");
    } catch(err) {
        console.error("Error executing reset:", err.message);
    } finally {
        pool.end();
        console.log("Database connection closed.");
    }
})();
