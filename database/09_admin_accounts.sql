/*
 * Tạo bảng tài khoản, phiên và nhật ký quản trị web riêng, không cấp quyền quản trị cho tài khoản người chơi.
 * Chỉ bổ sung cấu trúc và giữ nguyên dữ liệu, thông tin đăng nhập hiện có.
 */
SET XACT_ABORT ON;
GO
IF SCHEMA_ID(N'admin') IS NULL EXEC(N'CREATE SCHEMA admin');
GO
IF OBJECT_ID(N'admin.Accounts',N'U') IS NULL
BEGIN
  CREATE TABLE admin.Accounts (
    AdminId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AdminAccounts PRIMARY KEY DEFAULT NEWID(),
    Username NVARCHAR(80) NOT NULL,
    NormalizedUsername NVARCHAR(80) NOT NULL,
    PasswordHash VARCHAR(500) NOT NULL,
    IsActive BIT NOT NULL CONSTRAINT DF_AdminAccounts_Active DEFAULT 1,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AdminAccounts_Created DEFAULT SYSUTCDATETIME(),
    UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AdminAccounts_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_AdminAccounts_Name UNIQUE(NormalizedUsername)
  );
END;
GO
IF OBJECT_ID(N'admin.Sessions',N'U') IS NULL
BEGIN
  CREATE TABLE admin.Sessions (
    SessionId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AdminSessions PRIMARY KEY DEFAULT NEWID(),
    AdminId UNIQUEIDENTIFIER NOT NULL,
    TokenHash BINARY(32) NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AdminSessions_Created DEFAULT SYSUTCDATETIME(),
    ExpiresAtUtc DATETIME2(3) NOT NULL,
    RevokedAtUtc DATETIME2(3) NULL,
    CONSTRAINT FK_AdminSessions_Account FOREIGN KEY(AdminId) REFERENCES admin.Accounts(AdminId),
    CONSTRAINT UQ_AdminSessions_Token UNIQUE(TokenHash)
  );
  CREATE INDEX IX_AdminSessions_Account ON admin.Sessions(AdminId,ExpiresAtUtc);
END;
GO
IF OBJECT_ID(N'admin.Audit',N'U') IS NULL
BEGIN
  CREATE TABLE admin.Audit (
    AuditId BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_AdminAudit PRIMARY KEY,
    AdminId UNIQUEIDENTIFIER NOT NULL,
    ActionCode VARCHAR(40) NOT NULL,
    CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_AdminAudit_Created DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_AdminAudit_Account FOREIGN KEY(AdminId) REFERENCES admin.Accounts(AdminId)
  );
END;
GO
