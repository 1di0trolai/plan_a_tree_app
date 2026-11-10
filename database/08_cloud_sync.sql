/*
 * Bổ sung bản chụp tiến trình, ảnh riêng và hòm thư nhà phát hành trong database AUTH_DB_NAME sau schema nền tảng.
 * Không đặt lại hoặc di chuyển phá hủy dữ liệu ứng dụng và tài khoản hiện có.
 */
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO
IF OBJECT_ID(N'auth.Users', N'U') IS NULL
    THROW 50980, 'Run the PAT base schema in this database before 08_cloud_sync.sql.', 1;
GO
IF SCHEMA_ID(N'cloud') IS NULL EXEC(N'CREATE SCHEMA cloud');
GO
IF OBJECT_ID(N'cloud.Snapshots', N'U') IS NULL
BEGIN
    CREATE TABLE cloud.Snapshots (
        UserId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_CloudSnapshots PRIMARY KEY,
        Revision INT NOT NULL,
        StateJson NVARCHAR(MAX) NOT NULL,
        UpdatedAtUtc DATETIME2(3) NOT NULL,
        CONSTRAINT FK_CloudSnapshots_Users FOREIGN KEY (UserId) REFERENCES auth.Users(UserId),
        CONSTRAINT CK_CloudSnapshots_Revision CHECK (Revision > 0),
        CONSTRAINT CK_CloudSnapshots_Json CHECK (ISJSON(StateJson) = 1)
    );
END;
GO
IF OBJECT_ID(N'cloud.SnapshotHistory', N'U') IS NULL
BEGIN
    CREATE TABLE cloud.SnapshotHistory (
        UserId UNIQUEIDENTIFIER NOT NULL,
        Revision INT NOT NULL,
        StateJson NVARCHAR(MAX) NOT NULL,
        UpdatedAtUtc DATETIME2(3) NOT NULL,
        CONSTRAINT PK_CloudSnapshotHistory PRIMARY KEY (UserId,Revision),
        CONSTRAINT FK_CloudSnapshotHistory_Users FOREIGN KEY (UserId) REFERENCES auth.Users(UserId),
        CONSTRAINT CK_CloudSnapshotHistory_Json CHECK (ISJSON(StateJson) = 1)
    );
END;
GO
IF OBJECT_ID(N'cloud.Requests', N'U') IS NULL
BEGIN
    CREATE TABLE cloud.Requests (
        UserId UNIQUEIDENTIFIER NOT NULL,
        RequestId VARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
        Operation VARCHAR(16) NOT NULL,
        RequestDigest CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ResponseJson NVARCHAR(MAX) NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_CloudRequests_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_CloudRequests PRIMARY KEY (UserId,RequestId),
        CONSTRAINT FK_CloudRequests_Users FOREIGN KEY (UserId) REFERENCES auth.Users(UserId),
        CONSTRAINT CK_CloudRequests_Json CHECK (ISJSON(ResponseJson) = 1)
    );
END;
GO
IF OBJECT_ID(N'cloud.Assets', N'U') IS NULL
BEGIN
    CREATE TABLE cloud.Assets (
        AssetId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_CloudAssets PRIMARY KEY,
        UserId UNIQUEIDENTIFIER NOT NULL,
        ContentType VARCHAR(32) NOT NULL,
        Sha256 CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        ByteLength INT NOT NULL,
        Content VARBINARY(MAX) NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_CloudAssets_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_CloudAssets_Users FOREIGN KEY (UserId) REFERENCES auth.Users(UserId),
        CONSTRAINT UQ_CloudAssets_OwnerHash UNIQUE (UserId,Sha256),
        CONSTRAINT CK_CloudAssets_Type CHECK (ContentType IN ('image/png','image/jpeg')),
        CONSTRAINT CK_CloudAssets_Size CHECK (ByteLength BETWEEN 1 AND 6291456 AND DATALENGTH(Content) = ByteLength)
    );
END;
GO
IF OBJECT_ID(N'cloud.Publications', N'U') IS NULL
BEGIN
    CREATE TABLE cloud.Publications (
        PublicationId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_CloudPublications PRIMARY KEY,
        AdminId UNIQUEIDENTIFIER NOT NULL,
        RequestId VARCHAR(128) COLLATE Latin1_General_100_BIN2 NOT NULL,
        RequestDigest CHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
        Title NVARCHAR(160) NOT NULL,
        Body NVARCHAR(4000) NOT NULL,
        AttachmentsJson NVARCHAR(MAX) NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL,
        RecipientCount INT NOT NULL,
        CONSTRAINT UQ_CloudPublications_Request UNIQUE (AdminId,RequestId),
        CONSTRAINT CK_CloudPublications_Json CHECK (ISJSON(AttachmentsJson) = 1)
        /* Separate admin schema is installed by 09; no dependency on migration order. */
    );
END;
GO
IF OBJECT_ID(N'cloud.Mailbox', N'U') IS NULL
BEGIN
    CREATE TABLE cloud.Mailbox (
        MailId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_CloudMailbox PRIMARY KEY,
        PublicationId UNIQUEIDENTIFIER NOT NULL,
        UserId UNIQUEIDENTIFIER NOT NULL,
        ReadAtUtc DATETIME2(3) NULL,
        ClaimedAtUtc DATETIME2(3) NULL,
        DeletedAtUtc DATETIME2(3) NULL,
        CONSTRAINT FK_CloudMailbox_Users FOREIGN KEY (UserId) REFERENCES auth.Users(UserId),
        CONSTRAINT FK_CloudMailbox_Publications FOREIGN KEY (PublicationId) REFERENCES cloud.Publications(PublicationId),
        CONSTRAINT UQ_CloudMailbox_UserPublication UNIQUE (UserId,PublicationId)
    );
    CREATE INDEX IX_CloudMailbox_Owner ON cloud.Mailbox(UserId) INCLUDE (PublicationId,ReadAtUtc,ClaimedAtUtc,DeletedAtUtc);
END;
GO
