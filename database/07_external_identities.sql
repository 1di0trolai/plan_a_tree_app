/*
 * Bổ sung bảng liên kết tài khoản Google/Facebook sau 01_pat_schema.sql trong PAT.
 * Chỉ thêm cấu trúc, giữ nguyên người dùng, mật khẩu, phiên đăng nhập và dữ liệu ứng dụng.
 */
USE [PAT];
GO
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

IF OBJECT_ID(N'auth.Users', N'U') IS NULL
    THROW 50970, 'Run 01_pat_schema.sql before 07_external_identities.sql.', 1;
GO

IF OBJECT_ID(N'auth.ExternalIdentities', N'U') IS NULL
BEGIN
    CREATE TABLE auth.ExternalIdentities
    (
        ExternalIdentityId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ExternalIdentities_Id DEFAULT NEWSEQUENTIALID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        ProviderCode VARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ProviderSubject NVARCHAR(255) COLLATE Latin1_General_100_BIN2 NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL
            CONSTRAINT DF_ExternalIdentities_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ExternalIdentities PRIMARY KEY CLUSTERED (ExternalIdentityId),
        CONSTRAINT FK_ExternalIdentities_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT CK_ExternalIdentities_Provider CHECK (ProviderCode IN ('google','facebook')),
        CONSTRAINT CK_ExternalIdentities_Subject CHECK (LEN(ProviderSubject) BETWEEN 1 AND 255),
        CONSTRAINT UQ_ExternalIdentities_ProviderSubject UNIQUE (ProviderCode,ProviderSubject),
        CONSTRAINT UQ_ExternalIdentities_UserProvider UNIQUE (UserId,ProviderCode)
    );
END;
GO
