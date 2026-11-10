/*
 * Tạo kiểu bảng plant.AnalysisActionInput dùng để truyền danh sách công việc vào thủ tục phân tích.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF TYPE_ID(N'plant.AnalysisActionInput') IS NULL
    EXEC(N'CREATE TYPE plant.AnalysisActionInput AS TABLE
    (
        SortOrder  TINYINT NOT NULL PRIMARY KEY,
        ActionText NVARCHAR(500) NOT NULL
    );');
GO

