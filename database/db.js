/**
 * Tạo kết nối SQL Server từ cấu hình trên máy chủ bằng Windows Authentication; dùng chung cho các công cụ và kho dữ liệu của API.
 */

const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../.env"),
    quiet: true,
});

const sql = require("mssql/msnodesqlv8");

async function connectDB({ database: databaseOverride } = {}) {
    const server = process.env.DB_SERVER?.trim();
    const database = databaseOverride?.trim() || process.env.DB_NAME?.trim();
    if (!server || !database) {
        throw new Error("Thiếu DB_SERVER hoặc DB_NAME trong .env");
    }

    const pool = new sql.ConnectionPool({
        server,
        database,
        driver: "ODBC Driver 18 for SQL Server",
        connectionTimeout: 10000,
        requestTimeout: 15000,
        options: {
            trustedConnection: true,
            // Local development only; production must use a trusted certificate.
            trustServerCertificate: true,
        },
    });
    try {
        return await pool.connect();
    } catch (error) {
        await pool.close().catch(() => {});
        throw error;
    }
}

module.exports = { connectDB };
