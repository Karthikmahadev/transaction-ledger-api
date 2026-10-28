
import { pool } from "./pool";

async function checkConnection() {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, version() AS version"
    );

    console.log("PostgreSQL connection successful!");
    console.log("Database:", result.rows[0].database);
    console.log("Version:", result.rows[0].version);
  } catch (error) {
    console.error("PostgreSQL connection failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void checkConnection();
