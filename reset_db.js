const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./restaurant.db', (err) => {
    if (err) {
        console.error("Database connection error:", err.message);
        return;
    }
    console.log("Connected to the SQLite database.");
});

db.serialize(() => {
    // 1. Delete all orders history
    db.run("DELETE FROM orders", (err) => {
        if(err) console.error("Error deleting orders:", err.message);
        else console.log("✅ All orders history has been completely erased.");
    });

    // 2. Free all tables
    db.run("UPDATE tables_status SET status = 'free'", (err) => {
        if(err) console.error("Error freeing tables:", err.message);
        else console.log("✅ All tables are now free.");
    });
});

db.close((err) => {
    if (err) {
        console.error(err.message);
    }
    console.log("Database connection closed.");
});
