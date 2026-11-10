/**
 * Kiểm tra kết nối tới đúng database PAT và sự tồn tại của các bảng nền tảng; đóng kết nối sau khi kiểm tra.
 */

const { connectDB } = require("./db");

async function test() {
    const pool = await connectDB();

    try {
        const result = await pool.request().query(`
            SELECT DB_NAME() AS databaseName;
            SELECT name FROM (VALUES
                (N'auth.Users'), (N'auth.RefreshTokens'), (N'auth.UserActionTokens'),
                (N'app.UserProfiles'), (N'app.UserSettings'),
                (N'plant.Plants'), (N'plant.PlantCheckIns'), (N'plant.PlantPhotos'),
                (N'plant.PlantAnalyses'), (N'plant.PlantAnalysisActions'), (N'plant.PlantChibis'),
                (N'game.PetCatalog'), (N'game.PetLevelThresholds'), (N'game.UserPets'),
                (N'game.ItemCatalog'), (N'game.UserItems'), (N'game.PetFeedEvents'), (N'game.ArHunts')
            ) AS expected(name)
            WHERE OBJECT_ID(name, N'U') IS NULL;
        `);
        const databaseName = result.recordsets[0][0].databaseName;
        const missing = result.recordsets[1].map((row) => row.name);
        if (missing.length) {
            throw new Error(`Kết nối được ${databaseName} nhưng thiếu bảng PAT: ${missing.join(', ')}. Kiểm tra DB_NAME và chạy bộ SQL trong README.`);
        }
        console.log(`DB_CHECK_OK: ${databaseName} — kết nối và 18 bảng PAT hợp lệ.`);
    } finally {
        await pool.close();
    }
}

test().catch((error) => {
    console.error(`DB_CHECK_FAILED: ${error.message}`);
    process.exitCode = 1;
});
