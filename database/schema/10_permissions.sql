/*
 * Tạo vai trò pat_api_executor và cấp quyền gọi thủ tục, đọc view, sử dụng kiểu bảng; không tự cấp vai trò cho tài khoản SQL.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF DATABASE_PRINCIPAL_ID(N'pat_api_executor') IS NULL
    CREATE ROLE pat_api_executor AUTHORIZATION dbo;
GO

GRANT EXECUTE ON SCHEMA::auth TO pat_api_executor;
GRANT EXECUTE ON SCHEMA::app TO pat_api_executor;
GRANT EXECUTE ON SCHEMA::plant TO pat_api_executor;
GRANT EXECUTE ON SCHEMA::game TO pat_api_executor;
GRANT SELECT ON OBJECT::app.vw_UserProfileSettings TO pat_api_executor;
GRANT SELECT ON OBJECT::plant.vw_PlantDashboard TO pat_api_executor;
GRANT SELECT ON OBJECT::game.vw_UserPetCollection TO pat_api_executor;
GRANT SELECT ON OBJECT::game.vw_UserItemInventory TO pat_api_executor;
GRANT SELECT ON OBJECT::game.vw_PetCatalog TO pat_api_executor;
GRANT SELECT ON OBJECT::game.vw_ItemCatalog TO pat_api_executor;
GRANT SELECT ON OBJECT::plant.vw_PlantCheckInHistory TO pat_api_executor;
GRANT SELECT ON OBJECT::plant.vw_PlantAnalysisActionHistory TO pat_api_executor;
GRANT SELECT ON OBJECT::game.vw_ArHuntHistory TO pat_api_executor;
GRANT EXECUTE ON TYPE::plant.AnalysisActionInput TO pat_api_executor;
GRANT REFERENCES ON TYPE::plant.AnalysisActionInput TO pat_api_executor;
GO

