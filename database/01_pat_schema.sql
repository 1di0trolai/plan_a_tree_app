/*
    PAT database schema
    Target: SQL Server 2019+
    Run this file once from SQL Server Management Studio (SSMS).

    Important architecture rule:
    Expo mobile -> HTTPS API -> SQL Server
    The mobile app must never connect directly to this database.
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_ID(N'PAT') IS NULL
BEGIN
    EXEC(N'CREATE DATABASE [PAT]');
END;
GO

USE [PAT];
GO

IF SCHEMA_ID(N'auth') IS NULL EXEC(N'CREATE SCHEMA auth AUTHORIZATION dbo;');
IF SCHEMA_ID(N'app') IS NULL EXEC(N'CREATE SCHEMA app AUTHORIZATION dbo;');
IF SCHEMA_ID(N'plant') IS NULL EXEC(N'CREATE SCHEMA plant AUTHORIZATION dbo;');
IF SCHEMA_ID(N'game') IS NULL EXEC(N'CREATE SCHEMA game AUTHORIZATION dbo;');
GO

/* ============================== AUTH ============================== */

IF OBJECT_ID(N'auth.Users', N'U') IS NULL
BEGIN
    CREATE TABLE auth.Users
    (
        UserId              UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Users_UserId DEFAULT NEWSEQUENTIALID(),
        Email               NVARCHAR(320) NULL,
        NormalizedEmail     NVARCHAR(320) NULL,
        PhoneE164           VARCHAR(20) NULL,
        PasswordHash        NVARCHAR(500) NULL,
        PasswordHashVersion SMALLINT NULL,
        AuthProviderCode    VARCHAR(16) NOT NULL
            CONSTRAINT DF_Users_AuthProviderCode DEFAULT ('LOCAL'),
        IsActive            BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1),
        EmailConfirmedAtUtc DATETIME2(3) NULL,
        LastLoginAtUtc      DATETIME2(3) NULL,
        CreatedAtUtc        DATETIME2(3) NOT NULL CONSTRAINT DF_Users_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc        DATETIME2(3) NOT NULL CONSTRAINT DF_Users_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        DeletedAtUtc        DATETIME2(3) NULL,
        RowVersion          ROWVERSION NOT NULL,

        CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (UserId),
        CONSTRAINT CK_Users_Identity CHECK (NormalizedEmail IS NOT NULL OR PhoneE164 IS NOT NULL),
        CONSTRAINT CK_Users_EmailPair CHECK
        (
            (Email IS NULL AND NormalizedEmail IS NULL)
            OR (Email IS NOT NULL AND NormalizedEmail IS NOT NULL)
        ),
        CONSTRAINT CK_Users_AuthProvider CHECK (AuthProviderCode IN ('LOCAL', 'DEMO', 'EXTERNAL')),
        CONSTRAINT CK_Users_LocalPassword CHECK (AuthProviderCode <> 'LOCAL' OR PasswordHash IS NOT NULL)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'auth.Users') AND name = N'UX_Users_NormalizedEmail_Active')
    CREATE UNIQUE NONCLUSTERED INDEX UX_Users_NormalizedEmail_Active
        ON auth.Users (NormalizedEmail)
        WHERE NormalizedEmail IS NOT NULL AND DeletedAtUtc IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'auth.Users') AND name = N'UX_Users_PhoneE164_Active')
    CREATE UNIQUE NONCLUSTERED INDEX UX_Users_PhoneE164_Active
        ON auth.Users (PhoneE164)
        WHERE PhoneE164 IS NOT NULL AND DeletedAtUtc IS NULL;
GO

IF OBJECT_ID(N'auth.RefreshTokens', N'U') IS NULL
BEGIN
    CREATE TABLE auth.RefreshTokens
    (
        RefreshTokenId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_RefreshTokens_Id DEFAULT NEWSEQUENTIALID(),
        UserId         UNIQUEIDENTIFIER NOT NULL,
        TokenHash      BINARY(32) NOT NULL,
        CreatedAtUtc   DATETIME2(3) NOT NULL CONSTRAINT DF_RefreshTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        ExpiresAtUtc   DATETIME2(3) NOT NULL,
        RevokedAtUtc   DATETIME2(3) NULL,
        ReplacedByHash BINARY(32) NULL,

        CONSTRAINT PK_RefreshTokens PRIMARY KEY CLUSTERED (RefreshTokenId),
        CONSTRAINT FK_RefreshTokens_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT UQ_RefreshTokens_TokenHash UNIQUE (TokenHash),
        CONSTRAINT CK_RefreshTokens_Expiry CHECK (ExpiresAtUtc > CreatedAtUtc)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'auth.RefreshTokens') AND name = N'IX_RefreshTokens_User_Expiry')
    CREATE NONCLUSTERED INDEX IX_RefreshTokens_User_Expiry
        ON auth.RefreshTokens (UserId, ExpiresAtUtc DESC)
        INCLUDE (RevokedAtUtc);
GO

IF OBJECT_ID(N'auth.UserActionTokens', N'U') IS NULL
BEGIN
    CREATE TABLE auth.UserActionTokens
    (
        UserActionTokenId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_UserActionTokens_Id DEFAULT NEWSEQUENTIALID(),
        UserId            UNIQUEIDENTIFIER NOT NULL,
        PurposeCode       VARCHAR(24) NOT NULL,
        TokenHash         BINARY(32) NOT NULL,
        CreatedAtUtc      DATETIME2(3) NOT NULL CONSTRAINT DF_UserActionTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        ExpiresAtUtc      DATETIME2(3) NOT NULL,
        ConsumedAtUtc     DATETIME2(3) NULL,
        RevokedAtUtc      DATETIME2(3) NULL,

        CONSTRAINT PK_UserActionTokens PRIMARY KEY CLUSTERED (UserActionTokenId),
        CONSTRAINT FK_UserActionTokens_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT UQ_UserActionTokens_TokenHash UNIQUE (TokenHash),
        CONSTRAINT CK_UserActionTokens_Purpose CHECK (PurposeCode IN ('VERIFY_EMAIL', 'RESET_PASSWORD')),
        CONSTRAINT CK_UserActionTokens_Expiry CHECK (ExpiresAtUtc > CreatedAtUtc),
        CONSTRAINT CK_UserActionTokens_FinalState CHECK
        (
            (ConsumedAtUtc IS NULL OR RevokedAtUtc IS NULL)
            AND (ConsumedAtUtc IS NULL OR ConsumedAtUtc >= CreatedAtUtc)
            AND (RevokedAtUtc IS NULL OR RevokedAtUtc >= CreatedAtUtc)
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'auth.UserActionTokens') AND name = N'IX_UserActionTokens_User_Purpose_Expiry')
    CREATE NONCLUSTERED INDEX IX_UserActionTokens_User_Purpose_Expiry
        ON auth.UserActionTokens (UserId, PurposeCode, ExpiresAtUtc DESC)
        INCLUDE (ConsumedAtUtc, RevokedAtUtc);
GO

/* =========================== PROFILE / SETTINGS =========================== */

IF OBJECT_ID(N'app.UserProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE app.UserProfiles
    (
        UserId               UNIQUEIDENTIFIER NOT NULL,
        DisplayName          NVARCHAR(80) NOT NULL,
        ProfileTitle         NVARCHAR(120) NOT NULL CONSTRAINT DF_UserProfiles_Title DEFAULT (N'Người yêu cây'),
        AvatarEmoji          NVARCHAR(16) NOT NULL CONSTRAINT DF_UserProfiles_AvatarEmoji DEFAULT (N'🧑‍🌾'),
        AvatarStorageKey     NVARCHAR(512) NULL,
        AvatarPublicUrl      NVARCHAR(2048) NULL,
        CreatedAtUtc         DATETIME2(3) NOT NULL CONSTRAINT DF_UserProfiles_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc         DATETIME2(3) NOT NULL CONSTRAINT DF_UserProfiles_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        RowVersion           ROWVERSION NOT NULL,

        CONSTRAINT PK_UserProfiles PRIMARY KEY CLUSTERED (UserId),
        CONSTRAINT FK_UserProfiles_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT CK_UserProfiles_DisplayName CHECK (LEN(LTRIM(RTRIM(DisplayName))) >= 2)
    );
END;
GO

IF OBJECT_ID(N'app.UserSettings', N'U') IS NULL
BEGIN
    CREATE TABLE app.UserSettings
    (
        UserId                UNIQUEIDENTIFIER NOT NULL,
        NotificationsEnabled BIT NOT NULL CONSTRAINT DF_UserSettings_Notifications DEFAULT (1),
        ReminderLocalTime     TIME(0) NOT NULL CONSTRAINT DF_UserSettings_ReminderTime DEFAULT ('08:00'),
        TimeZoneId            SYSNAME NOT NULL CONSTRAINT DF_UserSettings_TimeZone DEFAULT (N'SE Asia Standard Time'),
        LightArEnabled        BIT NOT NULL CONSTRAINT DF_UserSettings_LightAr DEFAULT (0),
        MusicEnabled          BIT NOT NULL CONSTRAINT DF_UserSettings_Music DEFAULT (1),
        AiToneCode            VARCHAR(16) NOT NULL CONSTRAINT DF_UserSettings_AiTone DEFAULT ('FUNNY'),
        BattleNotifyEnabled   BIT NOT NULL CONSTRAINT DF_UserSettings_BattleNotify DEFAULT (0),
        UpdatedAtUtc          DATETIME2(3) NOT NULL CONSTRAINT DF_UserSettings_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        RowVersion            ROWVERSION NOT NULL,

        CONSTRAINT PK_UserSettings PRIMARY KEY CLUSTERED (UserId),
        CONSTRAINT FK_UserSettings_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT CK_UserSettings_AiTone CHECK (AiToneCode IN ('FUNNY', 'GENTLE', 'EXPERT', 'MINIMAL'))
    );
END;
GO

/* ============================== PLANTS ============================== */

IF OBJECT_ID(N'plant.Plants', N'U') IS NULL
BEGIN
    CREATE TABLE plant.Plants
    (
        PlantId              UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Plants_PlantId DEFAULT NEWSEQUENTIALID(),
        UserId               UNIQUEIDENTIFIER NOT NULL,
        CreateClientRequestId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_Plants_CreateClientRequestId DEFAULT NEWID(),
        PlantName            NVARCHAR(80) NOT NULL,
        SpeciesName          NVARCHAR(120) NOT NULL,
        PlantedOn            DATE NOT NULL,
        StageCode            VARCHAR(24) NOT NULL CONSTRAINT DF_Plants_Stage DEFAULT ('SEEDLING'),
        ProgressPercent      TINYINT NOT NULL CONSTRAINT DF_Plants_Progress DEFAULT (0),
        HealthStatus         NVARCHAR(80) NOT NULL CONSTRAINT DF_Plants_Health DEFAULT (N'Chưa đánh giá'),
        MoodText             NVARCHAR(160) NOT NULL CONSTRAINT DF_Plants_Mood DEFAULT (N'Đang chờ ảnh đầu tiên'),
        CurrentStreak        INT NOT NULL CONSTRAINT DF_Plants_CurrentStreak DEFAULT (0),
        BestStreak           INT NOT NULL CONSTRAINT DF_Plants_BestStreak DEFAULT (0),
        LastCheckInLocalDate DATE NULL,
        HistoryComplete      BIT NOT NULL CONSTRAINT DF_Plants_HistoryComplete DEFAULT (1),
        CreatedAtUtc         DATETIME2(3) NOT NULL CONSTRAINT DF_Plants_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc         DATETIME2(3) NOT NULL CONSTRAINT DF_Plants_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        DeletedAtUtc         DATETIME2(3) NULL,
        RowVersion           ROWVERSION NOT NULL,

        CONSTRAINT PK_Plants PRIMARY KEY CLUSTERED (PlantId),
        CONSTRAINT FK_Plants_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT UQ_Plants_CreateClientRequest UNIQUE (CreateClientRequestId),
        CONSTRAINT UQ_Plants_User_Plant UNIQUE (UserId, PlantId),
        CONSTRAINT CK_Plants_Name CHECK (LEN(LTRIM(RTRIM(PlantName))) >= 2),
        CONSTRAINT CK_Plants_Species CHECK (LEN(LTRIM(RTRIM(SpeciesName))) >= 2),
        CONSTRAINT CK_Plants_Stage CHECK (StageCode IN ('SEEDLING', 'GROWING', 'MATURE')),
        CONSTRAINT CK_Plants_Progress CHECK (ProgressPercent BETWEEN 0 AND 100),
        CONSTRAINT CK_Plants_Streak CHECK (CurrentStreak >= 0 AND BestStreak >= CurrentStreak)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.Plants') AND name = N'IX_Plants_User_Active')
    CREATE NONCLUSTERED INDEX IX_Plants_User_Active
        ON plant.Plants (UserId, CreatedAtUtc)
        INCLUDE (PlantName, SpeciesName, CurrentStreak, BestStreak, LastCheckInLocalDate)
        WHERE DeletedAtUtc IS NULL;
GO

IF OBJECT_ID(N'plant.PlantCheckIns', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantCheckIns
    (
        CheckInId       UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PlantCheckIns_Id DEFAULT NEWSEQUENTIALID(),
        PlantId         UNIQUEIDENTIFIER NOT NULL,
        CheckInLocalDate DATE NOT NULL,
        CreatedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_PlantCheckIns_CreatedAtUtc DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_PlantCheckIns PRIMARY KEY CLUSTERED (CheckInId),
        CONSTRAINT FK_PlantCheckIns_Plants FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId),
        CONSTRAINT UQ_PlantCheckIns_Plant_Day UNIQUE (PlantId, CheckInLocalDate),
        CONSTRAINT UQ_PlantCheckIns_Plant_CheckIn UNIQUE (PlantId, CheckInId)
    );
END;
GO

IF OBJECT_ID(N'plant.PlantPhotos', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantPhotos
    (
        PhotoId          UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PlantPhotos_Id DEFAULT NEWSEQUENTIALID(),
        PlantId          UNIQUEIDENTIFIER NOT NULL,
        CheckInId        UNIQUEIDENTIFIER NOT NULL,
        ClientRequestId  UNIQUEIDENTIFIER NOT NULL,
        StorageObjectKey NVARCHAR(512) NOT NULL,
        PublicUrl        NVARCHAR(2048) NULL,
        CaptureSourceCode VARCHAR(12) NOT NULL,
        MimeType         VARCHAR(100) NULL,
        WidthPixels      INT NULL,
        HeightPixels     INT NULL,
        FileSizeBytes    BIGINT NULL,
        Sha256           BINARY(32) NULL,
        CountsForStreak  BIT NOT NULL CONSTRAINT DF_PlantPhotos_CountsForStreak DEFAULT (0),
        CapturedAtUtc    DATETIME2(3) NOT NULL,
        CreatedAtUtc     DATETIME2(3) NOT NULL CONSTRAINT DF_PlantPhotos_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        DeletedAtUtc     DATETIME2(3) NULL,

        CONSTRAINT PK_PlantPhotos PRIMARY KEY CLUSTERED (PhotoId),
        CONSTRAINT FK_PlantPhotos_Plants FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId),
        CONSTRAINT FK_PlantPhotos_CheckIns FOREIGN KEY (PlantId, CheckInId)
            REFERENCES plant.PlantCheckIns (PlantId, CheckInId),
        CONSTRAINT UQ_PlantPhotos_ClientRequest UNIQUE (ClientRequestId),
        CONSTRAINT UQ_PlantPhotos_StorageObjectKey UNIQUE (StorageObjectKey),
        CONSTRAINT UQ_PlantPhotos_Plant_Photo UNIQUE (PlantId, PhotoId),
        CONSTRAINT CK_PlantPhotos_StorageKey CHECK
        (
            LEN(LTRIM(RTRIM(StorageObjectKey))) > 0
            AND StorageObjectKey NOT LIKE N'file://%'
            AND StorageObjectKey NOT LIKE N'data:%'
        ),
        CONSTRAINT CK_PlantPhotos_Source CHECK (CaptureSourceCode IN ('CAMERA', 'LIBRARY')),
        CONSTRAINT CK_PlantPhotos_Dimensions CHECK
        (
            (WidthPixels IS NULL OR WidthPixels > 0)
            AND (HeightPixels IS NULL OR HeightPixels > 0)
            AND (FileSizeBytes IS NULL OR FileSizeBytes >= 0)
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantPhotos') AND name = N'IX_PlantPhotos_Plant_Time')
    CREATE NONCLUSTERED INDEX IX_PlantPhotos_Plant_Time
        ON plant.PlantPhotos (PlantId, CreatedAtUtc DESC)
        INCLUDE (CheckInId, CapturedAtUtc, StorageObjectKey, PublicUrl, CaptureSourceCode)
        WHERE DeletedAtUtc IS NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantPhotos') AND name = N'UX_PlantPhotos_StreakCredit')
    CREATE UNIQUE NONCLUSTERED INDEX UX_PlantPhotos_StreakCredit
        ON plant.PlantPhotos (CheckInId)
        WHERE CountsForStreak = 1;
GO

IF OBJECT_ID(N'plant.PlantAnalyses', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantAnalyses
    (
        AnalysisId       UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PlantAnalyses_Id DEFAULT NEWSEQUENTIALID(),
        PlantId          UNIQUEIDENTIFIER NOT NULL,
        PhotoId          UNIQUEIDENTIFIER NOT NULL,
        StatusCode       VARCHAR(16) NOT NULL CONSTRAINT DF_PlantAnalyses_Status DEFAULT ('PENDING'),
        LevelCode        VARCHAR(16) NULL,
        Title            NVARCHAR(200) NULL,
        Summary          NVARCHAR(1000) NULL,
        Confidence       DECIMAL(5,4) NULL,
        ModelName        NVARCHAR(100) NULL,
        ModelVersion     NVARCHAR(60) NULL,
        RawResultJson    NVARCHAR(MAX) NULL,
        FailureCode      VARCHAR(80) NULL,
        CreatedAtUtc     DATETIME2(3) NOT NULL CONSTRAINT DF_PlantAnalyses_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CompletedAtUtc   DATETIME2(3) NULL,
        RowVersion       ROWVERSION NOT NULL,

        CONSTRAINT PK_PlantAnalyses PRIMARY KEY CLUSTERED (AnalysisId),
        CONSTRAINT FK_PlantAnalyses_PlantPhoto FOREIGN KEY (PlantId, PhotoId)
            REFERENCES plant.PlantPhotos (PlantId, PhotoId),
        CONSTRAINT UQ_PlantAnalyses_Photo UNIQUE (PhotoId),
        CONSTRAINT CK_PlantAnalyses_Status CHECK (StatusCode IN ('PENDING', 'COMPLETED', 'FAILED')),
        CONSTRAINT CK_PlantAnalyses_Level CHECK (LevelCode IS NULL OR LevelCode IN ('GOOD', 'ATTENTION', 'WARNING')),
        CONSTRAINT CK_PlantAnalyses_Confidence CHECK (Confidence IS NULL OR Confidence BETWEEN 0 AND 1),
        CONSTRAINT CK_PlantAnalyses_Json CHECK (RawResultJson IS NULL OR ISJSON(RawResultJson) = 1),
        CONSTRAINT CK_PlantAnalyses_ResultState CHECK
        (
            (StatusCode = 'PENDING' AND CompletedAtUtc IS NULL AND FailureCode IS NULL)
            OR
            (
                StatusCode = 'COMPLETED'
                AND LevelCode IS NOT NULL
                AND Title IS NOT NULL
                AND Summary IS NOT NULL
                AND CompletedAtUtc IS NOT NULL
                AND FailureCode IS NULL
            )
            OR
            (StatusCode = 'FAILED' AND CompletedAtUtc IS NOT NULL AND FailureCode IS NOT NULL)
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantAnalyses') AND name = N'IX_PlantAnalyses_Plant_Time')
    CREATE NONCLUSTERED INDEX IX_PlantAnalyses_Plant_Time
        ON plant.PlantAnalyses (PlantId, CreatedAtUtc DESC)
        INCLUDE (PhotoId, StatusCode, LevelCode, Title, Confidence);
GO

IF OBJECT_ID(N'plant.PlantAnalysisActions', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantAnalysisActions
    (
        AnalysisActionId BIGINT IDENTITY(1,1) NOT NULL,
        AnalysisId       UNIQUEIDENTIFIER NOT NULL,
        SortOrder         TINYINT NOT NULL,
        ActionText        NVARCHAR(500) NOT NULL,

        CONSTRAINT PK_PlantAnalysisActions PRIMARY KEY CLUSTERED (AnalysisActionId),
        CONSTRAINT FK_PlantAnalysisActions_Analyses FOREIGN KEY (AnalysisId)
            REFERENCES plant.PlantAnalyses (AnalysisId),
        CONSTRAINT UQ_PlantAnalysisActions_Order UNIQUE (AnalysisId, SortOrder),
        CONSTRAINT CK_PlantAnalysisActions_Text CHECK (LEN(LTRIM(RTRIM(ActionText))) > 0)
    );
END;
GO

IF OBJECT_ID(N'plant.PlantChibis', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantChibis
    (
        PlantChibiId         UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PlantChibis_Id DEFAULT NEWSEQUENTIALID(),
        PlantId              UNIQUEIDENTIFIER NOT NULL,
        SourcePhotoId        UNIQUEIDENTIFIER NULL,
        StatusCode           VARCHAR(16) NOT NULL CONSTRAINT DF_PlantChibis_Status DEFAULT ('PENDING'),
        StyleCode            VARCHAR(30) NOT NULL CONSTRAINT DF_PlantChibis_Style DEFAULT ('PAT_CHIBI_V1'),
        FallbackEmoji        NVARCHAR(16) NOT NULL CONSTRAINT DF_PlantChibis_Emoji DEFAULT (N'🪴'),
        ImageStorageObjectKey NVARCHAR(512) NULL,
        ImagePublicUrl       NVARCHAR(2048) NULL,
        IsCurrent            BIT NOT NULL CONSTRAINT DF_PlantChibis_IsCurrent DEFAULT (1),
        CreatedAtUtc         DATETIME2(3) NOT NULL CONSTRAINT DF_PlantChibis_CreatedAtUtc DEFAULT SYSUTCDATETIME(),
        CompletedAtUtc       DATETIME2(3) NULL,
        FailureCode          VARCHAR(80) NULL,
        RowVersion           ROWVERSION NOT NULL,

        CONSTRAINT PK_PlantChibis PRIMARY KEY CLUSTERED (PlantChibiId),
        CONSTRAINT FK_PlantChibis_Plants FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId),
        CONSTRAINT FK_PlantChibis_SourcePhoto FOREIGN KEY (PlantId, SourcePhotoId)
            REFERENCES plant.PlantPhotos (PlantId, PhotoId),
        CONSTRAINT CK_PlantChibis_Status CHECK (StatusCode IN ('PENDING', 'COMPLETED', 'FAILED')),
        CONSTRAINT CK_PlantChibis_ResultState CHECK
        (
            (StatusCode = 'PENDING' AND CompletedAtUtc IS NULL AND FailureCode IS NULL)
            OR
            (
                StatusCode = 'COMPLETED'
                AND ImageStorageObjectKey IS NOT NULL
                AND ImageStorageObjectKey NOT LIKE N'file://%'
                AND ImageStorageObjectKey NOT LIKE N'data:%'
                AND CompletedAtUtc IS NOT NULL
                AND FailureCode IS NULL
            )
            OR
            (StatusCode = 'FAILED' AND CompletedAtUtc IS NOT NULL AND FailureCode IS NOT NULL)
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantChibis') AND name = N'UX_PlantChibis_Current')
    CREATE UNIQUE NONCLUSTERED INDEX UX_PlantChibis_Current
        ON plant.PlantChibis (PlantId)
        WHERE IsCurrent = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantChibis') AND name = N'UX_PlantChibis_ImageStorageKey')
    CREATE UNIQUE NONCLUSTERED INDEX UX_PlantChibis_ImageStorageKey
        ON plant.PlantChibis (ImageStorageObjectKey)
        WHERE ImageStorageObjectKey IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantChibis') AND name = N'IX_PlantChibis_SourcePhoto')
    CREATE NONCLUSTERED INDEX IX_PlantChibis_SourcePhoto
        ON plant.PlantChibis (SourcePhotoId, CreatedAtUtc DESC)
        INCLUDE (PlantChibiId, IsCurrent, StatusCode)
        WHERE SourcePhotoId IS NOT NULL;
GO

/* ============================== PET / ITEMS ============================== */

IF OBJECT_ID(N'game.PetCatalog', N'U') IS NULL
BEGIN
    CREATE TABLE game.PetCatalog
    (
        PetId          INT IDENTITY(1,1) NOT NULL,
        PetCode        VARCHAR(50) NOT NULL,
        DisplayName    NVARCHAR(100) NOT NULL,
        IconEmoji      NVARCHAR(16) NOT NULL,
        RarityCode     VARCHAR(16) NOT NULL,
        ElementCode    VARCHAR(24) NOT NULL,
        RoleCode       VARCHAR(16) NOT NULL,
        BuffText       NVARCHAR(200) NOT NULL,
        DiscoveryHint NVARCHAR(300) NOT NULL,
        IsActive       BIT NOT NULL CONSTRAINT DF_PetCatalog_IsActive DEFAULT (1),
        CreatedAtUtc   DATETIME2(3) NOT NULL CONSTRAINT DF_PetCatalog_CreatedAtUtc DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_PetCatalog PRIMARY KEY CLUSTERED (PetId),
        CONSTRAINT UQ_PetCatalog_Code UNIQUE (PetCode),
        CONSTRAINT CK_PetCatalog_Rarity CHECK (RarityCode IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')),
        CONSTRAINT CK_PetCatalog_Role CHECK (RoleCode IN ('BATTLE', 'SUPPORT'))
    );
END;
GO

IF OBJECT_ID(N'game.PetLevelThresholds', N'U') IS NULL
BEGIN
    CREATE TABLE game.PetLevelThresholds
    (
        LevelNumber       SMALLINT NOT NULL,
        MinTotalExperience BIGINT NOT NULL,
        CONSTRAINT PK_PetLevelThresholds PRIMARY KEY CLUSTERED (LevelNumber),
        CONSTRAINT UQ_PetLevelThresholds_Experience UNIQUE (MinTotalExperience),
        CONSTRAINT CK_PetLevelThresholds_Level CHECK (LevelNumber >= 1),
        CONSTRAINT CK_PetLevelThresholds_Experience CHECK (MinTotalExperience >= 0)
    );
END;
GO

IF OBJECT_ID(N'game.UserPets', N'U') IS NULL
BEGIN
    CREATE TABLE game.UserPets
    (
        UserPetId       UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_UserPets_Id DEFAULT NEWSEQUENTIALID(),
        UserId          UNIQUEIDENTIFIER NOT NULL,
        PetId           INT NOT NULL,
        Quantity        INT NOT NULL CONSTRAINT DF_UserPets_Quantity DEFAULT (1),
        LevelNumber     SMALLINT NOT NULL CONSTRAINT DF_UserPets_Level DEFAULT (1),
        TotalExperience BIGINT NOT NULL CONSTRAINT DF_UserPets_Experience DEFAULT (0),
        IsCompanion     BIT NOT NULL CONSTRAINT DF_UserPets_IsCompanion DEFAULT (0),
        FirstCaughtAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserPets_FirstCaughtAtUtc DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc    DATETIME2(3) NOT NULL CONSTRAINT DF_UserPets_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        RowVersion      ROWVERSION NOT NULL,

        CONSTRAINT PK_UserPets PRIMARY KEY CLUSTERED (UserPetId),
        CONSTRAINT FK_UserPets_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT FK_UserPets_PetCatalog FOREIGN KEY (PetId) REFERENCES game.PetCatalog (PetId),
        CONSTRAINT FK_UserPets_Level FOREIGN KEY (LevelNumber) REFERENCES game.PetLevelThresholds (LevelNumber),
        CONSTRAINT UQ_UserPets_User_Pet UNIQUE (UserId, PetId),
        CONSTRAINT UQ_UserPets_User_UserPet UNIQUE (UserId, UserPetId),
        CONSTRAINT CK_UserPets_Quantity CHECK (Quantity >= 1),
        CONSTRAINT CK_UserPets_Experience CHECK (TotalExperience >= 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'game.UserPets') AND name = N'UX_UserPets_Companion')
    CREATE UNIQUE NONCLUSTERED INDEX UX_UserPets_Companion
        ON game.UserPets (UserId)
        WHERE IsCompanion = 1;
GO

IF OBJECT_ID(N'game.ItemCatalog', N'U') IS NULL
BEGIN
    CREATE TABLE game.ItemCatalog
    (
        ItemId           INT IDENTITY(1,1) NOT NULL,
        ItemCode         VARCHAR(50) NOT NULL,
        DisplayName      NVARCHAR(100) NOT NULL,
        IconEmoji        NVARCHAR(16) NOT NULL,
        RarityCode       VARCHAR(16) NOT NULL,
        CategoryCode     VARCHAR(16) NOT NULL,
        ExperienceGain   INT NOT NULL CONSTRAINT DF_ItemCatalog_ExpGain DEFAULT (0),
        Description      NVARCHAR(500) NOT NULL,
        IsActive         BIT NOT NULL CONSTRAINT DF_ItemCatalog_IsActive DEFAULT (1),
        CreatedAtUtc     DATETIME2(3) NOT NULL CONSTRAINT DF_ItemCatalog_CreatedAtUtc DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_ItemCatalog PRIMARY KEY CLUSTERED (ItemId),
        CONSTRAINT UQ_ItemCatalog_Code UNIQUE (ItemCode),
        CONSTRAINT CK_ItemCatalog_Rarity CHECK (RarityCode IN ('COMMON', 'RARE', 'EVENT')),
        CONSTRAINT CK_ItemCatalog_Category CHECK (CategoryCode IN ('FOOD', 'TOY', 'ACCESSORY')),
        CONSTRAINT CK_ItemCatalog_Experience CHECK
        (
            ExperienceGain >= 0
            AND (CategoryCode <> 'FOOD' OR ExperienceGain > 0)
        )
    );
END;
GO

IF OBJECT_ID(N'game.UserItems', N'U') IS NULL
BEGIN
    CREATE TABLE game.UserItems
    (
        UserId       UNIQUEIDENTIFIER NOT NULL,
        ItemId       INT NOT NULL,
        Quantity     INT NOT NULL CONSTRAINT DF_UserItems_Quantity DEFAULT (0),
        UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_UserItems_UpdatedAtUtc DEFAULT SYSUTCDATETIME(),
        RowVersion   ROWVERSION NOT NULL,

        CONSTRAINT PK_UserItems PRIMARY KEY CLUSTERED (UserId, ItemId),
        CONSTRAINT FK_UserItems_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT FK_UserItems_ItemCatalog FOREIGN KEY (ItemId) REFERENCES game.ItemCatalog (ItemId),
        CONSTRAINT CK_UserItems_Quantity CHECK (Quantity >= 0)
    );
END;
GO

IF OBJECT_ID(N'game.PetFeedEvents', N'U') IS NULL
BEGIN
    CREATE TABLE game.PetFeedEvents
    (
        PetFeedEventId      UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_PetFeedEvents_Id DEFAULT NEWSEQUENTIALID(),
        UserId              UNIQUEIDENTIFIER NOT NULL,
        UserPetId           UNIQUEIDENTIFIER NOT NULL,
        ItemId              INT NOT NULL,
        ClientRequestId     UNIQUEIDENTIFIER NOT NULL,
        QuantityUsed        INT NOT NULL CONSTRAINT DF_PetFeedEvents_Quantity DEFAULT (1),
        ExperienceGained    INT NOT NULL,
        ExperienceBefore    BIGINT NOT NULL,
        ExperienceAfter     BIGINT NOT NULL,
        LevelBefore         SMALLINT NOT NULL,
        LevelAfter          SMALLINT NOT NULL,
        ItemQuantityAfter   INT NOT NULL,
        CreatedAtUtc        DATETIME2(3) NOT NULL CONSTRAINT DF_PetFeedEvents_CreatedAtUtc DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_PetFeedEvents PRIMARY KEY CLUSTERED (PetFeedEventId),
        CONSTRAINT FK_PetFeedEvents_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT FK_PetFeedEvents_UserPets FOREIGN KEY (UserId, UserPetId)
            REFERENCES game.UserPets (UserId, UserPetId),
        CONSTRAINT FK_PetFeedEvents_UserItems FOREIGN KEY (UserId, ItemId)
            REFERENCES game.UserItems (UserId, ItemId),
        CONSTRAINT UQ_PetFeedEvents_ClientRequest UNIQUE (ClientRequestId),
        CONSTRAINT CK_PetFeedEvents_Values CHECK
        (
            QuantityUsed > 0
            AND ExperienceGained > 0
            AND ExperienceAfter >= ExperienceBefore
            AND LevelAfter >= LevelBefore
            AND ItemQuantityAfter >= 0
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'game.PetFeedEvents') AND name = N'IX_PetFeedEvents_UserPet_Time')
    CREATE NONCLUSTERED INDEX IX_PetFeedEvents_UserPet_Time
        ON game.PetFeedEvents (UserPetId, CreatedAtUtc DESC)
        INCLUDE (ItemId, ExperienceGained, LevelAfter);
GO

IF OBJECT_ID(N'game.ArHunts', N'U') IS NULL
BEGIN
    CREATE TABLE game.ArHunts
    (
        ArHuntId            UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_ArHunts_Id DEFAULT NEWSEQUENTIALID(),
        UserId              UNIQUEIDENTIFIER NOT NULL,
        PlantId             UNIQUEIDENTIFIER NOT NULL,
        ClientRequestId     UNIQUEIDENTIFIER NOT NULL,
        HuntLocalDate       DATE NOT NULL,
        StatusCode          VARCHAR(16) NOT NULL,
        CapturedPetId       INT NULL,
        WasNewPet           BIT NULL,
        StartedAtUtc        DATETIME2(3) NOT NULL CONSTRAINT DF_ArHunts_StartedAtUtc DEFAULT SYSUTCDATETIME(),
        CompletedAtUtc      DATETIME2(3) NOT NULL CONSTRAINT DF_ArHunts_CompletedAtUtc DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_ArHunts PRIMARY KEY CLUSTERED (ArHuntId),
        CONSTRAINT FK_ArHunts_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT FK_ArHunts_Plants FOREIGN KEY (UserId, PlantId)
            REFERENCES plant.Plants (UserId, PlantId),
        CONSTRAINT FK_ArHunts_Pets FOREIGN KEY (CapturedPetId) REFERENCES game.PetCatalog (PetId),
        CONSTRAINT UQ_ArHunts_User_Day UNIQUE (UserId, HuntLocalDate),
        CONSTRAINT UQ_ArHunts_ClientRequest UNIQUE (ClientRequestId),
        CONSTRAINT CK_ArHunts_Status CHECK (StatusCode IN ('CAPTURED', 'NO_RESULT')),
        CONSTRAINT CK_ArHunts_Result CHECK
        (
            (StatusCode = 'CAPTURED' AND CapturedPetId IS NOT NULL AND WasNewPet IS NOT NULL)
            OR (StatusCode = 'NO_RESULT' AND CapturedPetId IS NULL AND WasNewPet IS NULL)
        ),
        CONSTRAINT CK_ArHunts_Time CHECK (CompletedAtUtc >= StartedAtUtc)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'game.ArHunts') AND name = N'IX_ArHunts_Plant_Time')
    CREATE NONCLUSTERED INDEX IX_ArHunts_Plant_Time
        ON game.ArHunts (PlantId, StartedAtUtc DESC)
        INCLUDE (UserId, StatusCode, CapturedPetId);
GO

/* ============================== TABLE TYPE ============================== */

IF TYPE_ID(N'plant.AnalysisActionInput') IS NULL
    EXEC(N'CREATE TYPE plant.AnalysisActionInput AS TABLE
    (
        SortOrder  TINYINT NOT NULL PRIMARY KEY,
        ActionText NVARCHAR(500) NOT NULL
    );');
GO

/* ============================== PROCEDURES ============================== */

CREATE OR ALTER PROCEDURE auth.usp_RegisterLocalUser
    @Email               NVARCHAR(320),
    @PasswordHash        NVARCHAR(500),
    @PasswordHashVersion SMALLINT,
    @DisplayName         NVARCHAR(80),
    @TimeZoneId          SYSNAME = N'SE Asia Standard Time',
    @UserId              UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NormalizedEmail NVARCHAR(320) = UPPER(LTRIM(RTRIM(@Email)));
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    IF LEN(@NormalizedEmail) < 3 OR CHARINDEX(N'@', @NormalizedEmail) <= 1
        THROW 50901, 'INVALID_EMAIL', 1;
    IF LEN(LTRIM(RTRIM(@PasswordHash))) = 0
        THROW 50902, 'INVALID_PASSWORD_HASH', 1;
    IF LEN(LTRIM(RTRIM(@DisplayName))) < 2
        THROW 50903, 'INVALID_DISPLAY_NAME', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.time_zone_info WHERE name = @TimeZoneId)
        THROW 50904, 'INVALID_TIME_ZONE', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION RegisterLocalUserSave;

        IF EXISTS
        (
            SELECT 1
            FROM auth.Users WITH (UPDLOCK, HOLDLOCK)
            WHERE NormalizedEmail = @NormalizedEmail AND DeletedAtUtc IS NULL
        )
            THROW 50905, 'EMAIL_ALREADY_EXISTS', 1;

        DECLARE @NewUser TABLE (UserId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.Users
        (
            Email, NormalizedEmail, PasswordHash, PasswordHashVersion,
            AuthProviderCode, IsActive
        )
            OUTPUT inserted.UserId INTO @NewUser
        VALUES
        (
            LTRIM(RTRIM(@Email)), @NormalizedEmail, @PasswordHash,
            @PasswordHashVersion, 'LOCAL', 1
        );
        SELECT @UserId = UserId FROM @NewUser;

        INSERT app.UserProfiles (UserId, DisplayName)
        VALUES (@UserId, LTRIM(RTRIM(@DisplayName)));

        INSERT app.UserSettings (UserId, TimeZoneId)
        VALUES (@UserId, @TimeZoneId);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'USER_REGISTERED' AS ResultCode, @UserId AS UserId;
    END TRY
    BEGIN CATCH
        DECLARE @ErrorNumber INT = ERROR_NUMBER();
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION RegisterLocalUserSave;

        IF @ErrorNumber IN (2601, 2627)
            THROW 50905, 'EMAIL_ALREADY_EXISTS', 1;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_GetLoginCredential
    @Identity NVARCHAR(320)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NormalizedIdentity NVARCHAR(320) = UPPER(LTRIM(RTRIM(@Identity)));

    SELECT TOP (1)
        UserId,
        Email,
        PhoneE164,
        PasswordHash,
        PasswordHashVersion,
        EmailConfirmedAtUtc,
        LastLoginAtUtc,
        RowVersion
    FROM auth.Users
    WHERE IsActive = 1
      AND DeletedAtUtc IS NULL
      AND AuthProviderCode = 'LOCAL'
      AND
      (
          NormalizedEmail = @NormalizedIdentity
          OR PhoneE164 = CONVERT(VARCHAR(20), LTRIM(RTRIM(@Identity)))
      );
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_IssueRefreshToken
    @UserId      UNIQUEIDENTIFIER,
    @TokenHash   BINARY(32),
    @ExpiresAtUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    IF @ExpiresAtUtc <= @NowUtc OR @ExpiresAtUtc > DATEADD(DAY, 90, @NowUtc)
        THROW 50908, 'INVALID_REFRESH_TOKEN_EXPIRY', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION IssueRefreshTokenSave;

        IF NOT EXISTS
        (
            SELECT 1 FROM auth.Users WITH (UPDLOCK, HOLDLOCK)
            WHERE UserId = @UserId AND IsActive = 1 AND DeletedAtUtc IS NULL
        )
            THROW 50924, 'USER_NOT_FOUND', 1;

        DECLARE @NewToken TABLE (RefreshTokenId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.RefreshTokens (UserId, TokenHash, ExpiresAtUtc)
            OUTPUT inserted.RefreshTokenId INTO @NewToken
        VALUES (@UserId, @TokenHash, @ExpiresAtUtc);

        UPDATE auth.Users
        SET LastLoginAtUtc = @NowUtc,
            UpdatedAtUtc = @NowUtc
        WHERE UserId = @UserId;

        DECLARE @RefreshTokenId UNIQUEIDENTIFIER = (SELECT RefreshTokenId FROM @NewToken);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'REFRESH_TOKEN_ISSUED' AS ResultCode, @RefreshTokenId AS RefreshTokenId,
               @UserId AS UserId, @ExpiresAtUtc AS ExpiresAtUtc;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION IssueRefreshTokenSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_RotateRefreshToken
    @CurrentTokenHash BINARY(32),
    @NewTokenHash     BINARY(32),
    @NewExpiresAtUtc  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @StartTranCount INT = @@TRANCOUNT;
    DECLARE @UserId UNIQUEIDENTIFIER;
    DECLARE @CurrentRefreshTokenId UNIQUEIDENTIFIER;

    IF @NewExpiresAtUtc <= @NowUtc OR @NewExpiresAtUtc > DATEADD(DAY, 90, @NowUtc)
        THROW 50908, 'INVALID_REFRESH_TOKEN_EXPIRY', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION RotateRefreshTokenSave;

        SELECT
            @CurrentRefreshTokenId = token.RefreshTokenId,
            @UserId = token.UserId
        FROM auth.RefreshTokens AS token WITH (UPDLOCK, HOLDLOCK)
        JOIN auth.Users AS userAccount ON userAccount.UserId = token.UserId
        WHERE token.TokenHash = @CurrentTokenHash
          AND token.ExpiresAtUtc > @NowUtc
          AND token.RevokedAtUtc IS NULL
          AND userAccount.IsActive = 1
          AND userAccount.DeletedAtUtc IS NULL;

        IF @CurrentRefreshTokenId IS NULL
            THROW 50909, 'REFRESH_TOKEN_INVALID_OR_EXPIRED', 1;

        UPDATE auth.RefreshTokens
        SET RevokedAtUtc = @NowUtc,
            ReplacedByHash = @NewTokenHash
        WHERE RefreshTokenId = @CurrentRefreshTokenId;

        DECLARE @NewToken TABLE (RefreshTokenId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.RefreshTokens (UserId, TokenHash, ExpiresAtUtc)
            OUTPUT inserted.RefreshTokenId INTO @NewToken
        VALUES (@UserId, @NewTokenHash, @NewExpiresAtUtc);

        DECLARE @NewRefreshTokenId UNIQUEIDENTIFIER = (SELECT RefreshTokenId FROM @NewToken);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'REFRESH_TOKEN_ROTATED' AS ResultCode,
               @NewRefreshTokenId AS RefreshTokenId,
               @UserId AS UserId,
               @NewExpiresAtUtc AS ExpiresAtUtc;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION RotateRefreshTokenSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_RevokeRefreshToken
    @UserId    UNIQUEIDENTIFIER,
    @TokenHash BINARY(32)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE auth.RefreshTokens
    SET RevokedAtUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND TokenHash = @TokenHash
      AND RevokedAtUtc IS NULL;

    SELECT 'REFRESH_TOKEN_REVOKED' AS ResultCode;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_CreatePasswordResetToken
    @Identity     NVARCHAR(320),
    @TokenHash    BINARY(32),
    @ExpiresAtUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @UserId UNIQUEIDENTIFIER;
    DECLARE @Email NVARCHAR(320);
    DECLARE @StartTranCount INT = @@TRANCOUNT;
    DECLARE @NormalizedIdentity NVARCHAR(320) = UPPER(LTRIM(RTRIM(@Identity)));

    IF @ExpiresAtUtc <= @NowUtc OR @ExpiresAtUtc > DATEADD(DAY, 1, @NowUtc)
        THROW 50906, 'INVALID_TOKEN_EXPIRY', 1;

    SELECT TOP (1)
        @UserId = UserId,
        @Email = Email
    FROM auth.Users
    WHERE IsActive = 1
      AND DeletedAtUtc IS NULL
      AND AuthProviderCode = 'LOCAL'
      AND
      (
          NormalizedEmail = @NormalizedIdentity
          OR PhoneE164 = CONVERT(VARCHAR(20), LTRIM(RTRIM(@Identity)))
      );

    /* The API must always return the same public message, including this case. */
    IF @UserId IS NULL
    BEGIN
        SELECT 'RESET_REQUEST_ACCEPTED' AS ResultCode, CAST(0 AS BIT) AS ShouldSend,
               CAST(NULL AS UNIQUEIDENTIFIER) AS UserActionTokenId,
               CAST(NULL AS NVARCHAR(320)) AS RecoveryEmail;
        RETURN;
    END;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION CreatePasswordResetSave;

        UPDATE auth.UserActionTokens
        SET RevokedAtUtc = @NowUtc
        WHERE UserId = @UserId
          AND PurposeCode = 'RESET_PASSWORD'
          AND ConsumedAtUtc IS NULL
          AND RevokedAtUtc IS NULL;

        DECLARE @NewToken TABLE (UserActionTokenId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.UserActionTokens (UserId, PurposeCode, TokenHash, ExpiresAtUtc)
            OUTPUT inserted.UserActionTokenId INTO @NewToken
        VALUES (@UserId, 'RESET_PASSWORD', @TokenHash, @ExpiresAtUtc);

        DECLARE @UserActionTokenId UNIQUEIDENTIFIER = (SELECT UserActionTokenId FROM @NewToken);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'RESET_REQUEST_ACCEPTED' AS ResultCode, CAST(1 AS BIT) AS ShouldSend,
               @UserActionTokenId AS UserActionTokenId, @Email AS RecoveryEmail;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION CreatePasswordResetSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_ResetPassword
    @TokenHash              BINARY(32),
    @NewPasswordHash        NVARCHAR(500),
    @PasswordHashVersion    SMALLINT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF LEN(LTRIM(RTRIM(@NewPasswordHash))) = 0
        THROW 50902, 'INVALID_PASSWORD_HASH', 1;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @UserId UNIQUEIDENTIFIER;
    DECLARE @UserActionTokenId UNIQUEIDENTIFIER;
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION ResetPasswordSave;

        SELECT
            @UserActionTokenId = token.UserActionTokenId,
            @UserId = token.UserId
        FROM auth.UserActionTokens AS token WITH (UPDLOCK, HOLDLOCK)
        JOIN auth.Users AS userAccount ON userAccount.UserId = token.UserId
        WHERE token.TokenHash = @TokenHash
          AND token.PurposeCode = 'RESET_PASSWORD'
          AND token.ConsumedAtUtc IS NULL
          AND token.RevokedAtUtc IS NULL
          AND token.ExpiresAtUtc > @NowUtc
          AND userAccount.IsActive = 1
          AND userAccount.DeletedAtUtc IS NULL;

        IF @UserActionTokenId IS NULL
            THROW 50907, 'RESET_TOKEN_INVALID_OR_EXPIRED', 1;

        UPDATE auth.Users
        SET PasswordHash = @NewPasswordHash,
            PasswordHashVersion = @PasswordHashVersion,
            UpdatedAtUtc = @NowUtc
        WHERE UserId = @UserId;

        UPDATE auth.UserActionTokens
        SET ConsumedAtUtc = @NowUtc
        WHERE UserActionTokenId = @UserActionTokenId;

        UPDATE auth.UserActionTokens
        SET RevokedAtUtc = @NowUtc
        WHERE UserId = @UserId
          AND PurposeCode = 'RESET_PASSWORD'
          AND UserActionTokenId <> @UserActionTokenId
          AND ConsumedAtUtc IS NULL
          AND RevokedAtUtc IS NULL;

        UPDATE auth.RefreshTokens
        SET RevokedAtUtc = @NowUtc
        WHERE UserId = @UserId AND RevokedAtUtc IS NULL;

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'PASSWORD_RESET' AS ResultCode, @UserId AS UserId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION ResetPasswordSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE app.usp_UpdateUserProfile
    @UserId            UNIQUEIDENTIFIER,
    @DisplayName       NVARCHAR(80),
    @ProfileTitle      NVARCHAR(120),
    @AvatarEmoji       NVARCHAR(16),
    @AvatarStorageKey  NVARCHAR(512) = NULL,
    @AvatarPublicUrl   NVARCHAR(2048) = NULL,
    @ExpectedRowVersion BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LEN(LTRIM(RTRIM(@DisplayName))) < 2
        THROW 50910, 'INVALID_DISPLAY_NAME', 1;
    IF @AvatarStorageKey LIKE N'file://%' OR @AvatarStorageKey LIKE N'data:%'
        THROW 50911, 'LOCAL_IMAGE_URI_NOT_ALLOWED', 1;

    UPDATE app.UserProfiles
    SET DisplayName = LTRIM(RTRIM(@DisplayName)),
        ProfileTitle = @ProfileTitle,
        AvatarEmoji = @AvatarEmoji,
        AvatarStorageKey = @AvatarStorageKey,
        AvatarPublicUrl = @AvatarPublicUrl,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND (@ExpectedRowVersion IS NULL OR RowVersion = @ExpectedRowVersion);

    IF @@ROWCOUNT = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM app.UserProfiles WHERE UserId = @UserId)
            THROW 50912, 'PROFILE_CONCURRENCY_CONFLICT', 1;
        THROW 50913, 'PROFILE_NOT_FOUND', 1;
    END;

    SELECT 'PROFILE_UPDATED' AS ResultCode, UserId, RowVersion
    FROM app.UserProfiles WHERE UserId = @UserId;
END;
GO

CREATE OR ALTER PROCEDURE app.usp_UpdateUserSettings
    @UserId                UNIQUEIDENTIFIER,
    @NotificationsEnabled BIT,
    @ReminderLocalTime     TIME(0),
    @TimeZoneId            SYSNAME,
    @LightArEnabled        BIT,
    @MusicEnabled          BIT,
    @AiToneCode            VARCHAR(16),
    @BattleNotifyEnabled   BIT,
    @ExpectedRowVersion    BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @AiToneCode NOT IN ('FUNNY', 'GENTLE', 'EXPERT', 'MINIMAL')
        THROW 50914, 'INVALID_AI_TONE', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.time_zone_info WHERE name = @TimeZoneId)
        THROW 50904, 'INVALID_TIME_ZONE', 1;

    UPDATE app.UserSettings
    SET NotificationsEnabled = @NotificationsEnabled,
        ReminderLocalTime = @ReminderLocalTime,
        TimeZoneId = @TimeZoneId,
        LightArEnabled = @LightArEnabled,
        MusicEnabled = @MusicEnabled,
        AiToneCode = @AiToneCode,
        BattleNotifyEnabled = @BattleNotifyEnabled,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND (@ExpectedRowVersion IS NULL OR RowVersion = @ExpectedRowVersion);

    IF @@ROWCOUNT = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM app.UserSettings WHERE UserId = @UserId)
            THROW 50915, 'SETTINGS_CONCURRENCY_CONFLICT', 1;
        THROW 50916, 'SETTINGS_NOT_FOUND', 1;
    END;

    SELECT 'SETTINGS_UPDATED' AS ResultCode, UserId, RowVersion
    FROM app.UserSettings WHERE UserId = @UserId;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_CreatePlant
    @UserId              UNIQUEIDENTIFIER,
    @ClientRequestId     UNIQUEIDENTIFIER,
    @PlantName           NVARCHAR(80),
    @SpeciesName         NVARCHAR(120),
    @PlantedOn           DATE,
    @FallbackEmoji       NVARCHAR(16) = N'🪴'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF LEN(LTRIM(RTRIM(@PlantName))) < 2
        THROW 50920, 'INVALID_PLANT_NAME', 1;
    IF LEN(LTRIM(RTRIM(@SpeciesName))) < 2
        THROW 50921, 'INVALID_SPECIES_NAME', 1;

    DECLARE @TimeZoneId SYSNAME =
        COALESCE((SELECT TimeZoneId FROM app.UserSettings WHERE UserId = @UserId), N'SE Asia Standard Time');
    DECLARE @Today DATE = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE @TimeZoneId);
    DECLARE @StartTranCount INT = @@TRANCOUNT;
    DECLARE @PlantId UNIQUEIDENTIFIER;
    DECLARE @PlantChibiId UNIQUEIDENTIFIER;
    DECLARE @ReplayUserId UNIQUEIDENTIFIER;
    DECLARE @ReplayPlantName NVARCHAR(80);
    DECLARE @ReplaySpeciesName NVARCHAR(120);
    DECLARE @ReplayPlantedOn DATE;

    IF @PlantedOn > @Today
        THROW 50922, 'PLANTED_DATE_IN_FUTURE', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION CreatePlantSave;

        SELECT
            @PlantId = PlantId,
            @ReplayUserId = UserId,
            @ReplayPlantName = PlantName,
            @ReplaySpeciesName = SpeciesName,
            @ReplayPlantedOn = PlantedOn
        FROM plant.Plants WITH (UPDLOCK, HOLDLOCK)
        WHERE CreateClientRequestId = @ClientRequestId;

        IF @PlantId IS NOT NULL
        BEGIN
            IF @ReplayUserId <> @UserId
               OR @ReplayPlantName <> LTRIM(RTRIM(@PlantName))
               OR @ReplaySpeciesName <> LTRIM(RTRIM(@SpeciesName))
               OR @ReplayPlantedOn <> @PlantedOn
                THROW 50923, 'CLIENT_REQUEST_ID_CONFLICT', 1;

            SELECT @PlantChibiId = PlantChibiId
            FROM plant.PlantChibis
            WHERE PlantId = @PlantId AND IsCurrent = 1;

            IF @StartTranCount = 0 COMMIT TRANSACTION;
            SELECT 'PLANT_CREATE_REPLAY' AS ResultCode, @PlantId AS PlantId,
                   @PlantChibiId AS PlantChibiId;
            RETURN;
        END;

        IF NOT EXISTS
        (
            SELECT 1 FROM auth.Users WITH (UPDLOCK, HOLDLOCK)
            WHERE UserId = @UserId AND IsActive = 1 AND DeletedAtUtc IS NULL
        )
            THROW 50924, 'USER_NOT_FOUND', 1;

        DECLARE @NewPlant TABLE (PlantId UNIQUEIDENTIFIER NOT NULL);
        INSERT plant.Plants
        (
            UserId, CreateClientRequestId, PlantName, SpeciesName, PlantedOn
        )
            OUTPUT inserted.PlantId INTO @NewPlant
        VALUES
        (
            @UserId, @ClientRequestId, LTRIM(RTRIM(@PlantName)),
            LTRIM(RTRIM(@SpeciesName)), @PlantedOn
        );
        SELECT @PlantId = PlantId FROM @NewPlant;

        DECLARE @NewChibi TABLE (PlantChibiId UNIQUEIDENTIFIER NOT NULL);
        INSERT plant.PlantChibis (PlantId, StatusCode, FallbackEmoji, IsCurrent)
            OUTPUT inserted.PlantChibiId INTO @NewChibi
        VALUES (@PlantId, 'PENDING', @FallbackEmoji, 1);
        SELECT @PlantChibiId = PlantChibiId FROM @NewChibi;

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'PLANT_CREATED' AS ResultCode, @PlantId AS PlantId,
               @PlantChibiId AS PlantChibiId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION CreatePlantSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_UpdatePlant
    @UserId             UNIQUEIDENTIFIER,
    @PlantId            UNIQUEIDENTIFIER,
    @PlantName          NVARCHAR(80),
    @SpeciesName        NVARCHAR(120),
    @PlantedOn          DATE,
    @ExpectedRowVersion BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LEN(LTRIM(RTRIM(@PlantName))) < 2
        THROW 50920, 'INVALID_PLANT_NAME', 1;
    IF LEN(LTRIM(RTRIM(@SpeciesName))) < 2
        THROW 50921, 'INVALID_SPECIES_NAME', 1;

    DECLARE @TimeZoneId SYSNAME =
        COALESCE((SELECT TimeZoneId FROM app.UserSettings WHERE UserId = @UserId), N'SE Asia Standard Time');
    DECLARE @Today DATE = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE @TimeZoneId);

    IF @PlantedOn > @Today
        THROW 50922, 'PLANTED_DATE_IN_FUTURE', 1;

    UPDATE plant.Plants
    SET PlantName = LTRIM(RTRIM(@PlantName)),
        SpeciesName = LTRIM(RTRIM(@SpeciesName)),
        PlantedOn = @PlantedOn,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE PlantId = @PlantId
      AND UserId = @UserId
      AND DeletedAtUtc IS NULL
      AND (@ExpectedRowVersion IS NULL OR RowVersion = @ExpectedRowVersion);

    IF @@ROWCOUNT = 0
    BEGIN
        IF EXISTS
        (
            SELECT 1 FROM plant.Plants
            WHERE PlantId = @PlantId AND UserId = @UserId AND DeletedAtUtc IS NULL
        )
            THROW 50925, 'PLANT_CONCURRENCY_CONFLICT', 1;
        THROW 50926, 'PLANT_NOT_FOUND', 1;
    END;

    SELECT 'PLANT_UPDATED' AS ResultCode, PlantId, RowVersion
    FROM plant.Plants WHERE PlantId = @PlantId;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_SoftDeletePlant
    @UserId             UNIQUEIDENTIFIER,
    @PlantId            UNIQUEIDENTIFIER,
    @ExpectedRowVersion BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE plant.Plants
    SET DeletedAtUtc = SYSUTCDATETIME(),
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE PlantId = @PlantId
      AND UserId = @UserId
      AND DeletedAtUtc IS NULL
      AND (@ExpectedRowVersion IS NULL OR RowVersion = @ExpectedRowVersion);

    IF @@ROWCOUNT = 0
    BEGIN
        IF EXISTS
        (
            SELECT 1 FROM plant.Plants
            WHERE PlantId = @PlantId AND UserId = @UserId AND DeletedAtUtc IS NULL
        )
            THROW 50925, 'PLANT_CONCURRENCY_CONFLICT', 1;
        THROW 50926, 'PLANT_NOT_FOUND', 1;
    END;

    SELECT 'PLANT_DELETED' AS ResultCode, @PlantId AS PlantId;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_CreatePlantCheckIn
    @UserId            UNIQUEIDENTIFIER,
    @PlantId           UNIQUEIDENTIFIER,
    @ClientRequestId   UNIQUEIDENTIFIER,
    @StorageObjectKey  NVARCHAR(512),
    @PublicUrl         NVARCHAR(2048) = NULL,
    @CaptureSourceCode VARCHAR(12),
    @CapturedAtUtc     DATETIME2(3) = NULL,
    @MimeType          VARCHAR(100) = NULL,
    @WidthPixels       INT = NULL,
    @HeightPixels      INT = NULL,
    @FileSizeBytes     BIGINT = NULL,
    @Sha256            BINARY(32) = NULL,
    @FallbackEmoji     NVARCHAR(16) = N'🪴'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @CaptureSourceCode NOT IN ('CAMERA', 'LIBRARY')
        THROW 51001, 'INVALID_CAPTURE_SOURCE', 1;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @TimeZoneId SYSNAME;
    DECLARE @LocalDate DATE;
    DECLARE @CheckInId UNIQUEIDENTIFIER;
    DECLARE @PhotoId UNIQUEIDENTIFIER;
    DECLARE @AnalysisId UNIQUEIDENTIFIER;
    DECLARE @PlantChibiId UNIQUEIDENTIFIER;
    DECLARE @IsFirstToday BIT = 0;
    DECLARE @CurrentStreak INT;
    DECLARE @BestStreak INT;
    DECLARE @LastCheckInDate DATE;
    DECLARE @Progress TINYINT;
    DECLARE @StartTranCount INT = @@TRANCOUNT;
    DECLARE @ReplayStorageObjectKey NVARCHAR(512);
    DECLARE @ReplayCaptureSourceCode VARCHAR(12);

    SET @CapturedAtUtc = COALESCE(@CapturedAtUtc, @NowUtc);

    SELECT @TimeZoneId = TimeZoneId
    FROM app.UserSettings
    WHERE UserId = @UserId;

    SET @TimeZoneId = COALESCE(@TimeZoneId, N'SE Asia Standard Time');
    SET @LocalDate = CONVERT(DATE, @NowUtc AT TIME ZONE 'UTC' AT TIME ZONE @TimeZoneId);

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION CreatePlantCheckInSave;

        SELECT
            @CurrentStreak = p.CurrentStreak,
            @BestStreak = p.BestStreak,
            @LastCheckInDate = p.LastCheckInLocalDate,
            @Progress = p.ProgressPercent
        FROM plant.Plants AS p WITH (UPDLOCK, HOLDLOCK)
        WHERE p.PlantId = @PlantId
          AND p.UserId = @UserId
          AND p.DeletedAtUtc IS NULL;

        IF @CurrentStreak IS NULL
            THROW 51002, 'PLANT_NOT_FOUND', 1;

        SELECT TOP (1)
            @PhotoId = ph.PhotoId,
            @CheckInId = ph.CheckInId,
            @AnalysisId = a.AnalysisId,
            @PlantChibiId = c.PlantChibiId,
            @IsFirstToday = ph.CountsForStreak,
            @ReplayStorageObjectKey = ph.StorageObjectKey,
            @ReplayCaptureSourceCode = ph.CaptureSourceCode
        FROM plant.PlantPhotos AS ph
        LEFT JOIN plant.PlantAnalyses AS a ON a.PhotoId = ph.PhotoId
        OUTER APPLY
        (
            SELECT TOP (1) candidate.PlantChibiId
            FROM plant.PlantChibis AS candidate
            WHERE candidate.SourcePhotoId = ph.PhotoId
            ORDER BY candidate.IsCurrent DESC, candidate.CreatedAtUtc DESC
        ) AS c
        WHERE ph.ClientRequestId = @ClientRequestId;

        IF @PhotoId IS NOT NULL
        BEGIN
            IF NOT EXISTS
            (
                SELECT 1
                FROM plant.PlantPhotos AS replayPhoto
                JOIN plant.Plants AS replayPlant ON replayPlant.PlantId = replayPhoto.PlantId
                WHERE replayPhoto.PhotoId = @PhotoId
                  AND replayPhoto.PlantId = @PlantId
                  AND replayPlant.UserId = @UserId
            )
                THROW 51003, 'CLIENT_REQUEST_ID_CONFLICT', 1;

            IF @ReplayStorageObjectKey <> @StorageObjectKey
               OR @ReplayCaptureSourceCode <> @CaptureSourceCode
                THROW 51003, 'CLIENT_REQUEST_ID_CONFLICT', 1;

            IF @StartTranCount = 0 COMMIT TRANSACTION;
            SELECT
                'CHECKIN_REPLAY' AS ResultCode,
                @IsFirstToday AS IsFirstToday,
                @CheckInId AS CheckInId,
                @PhotoId AS PhotoId,
                @AnalysisId AS AnalysisId,
                @PlantChibiId AS PlantChibiId,
                p.CurrentStreak,
                p.BestStreak,
                p.RowVersion
            FROM plant.Plants AS p
            WHERE p.PlantId = @PlantId;
            RETURN;
        END;

        SELECT @CheckInId = ci.CheckInId
        FROM plant.PlantCheckIns AS ci WITH (UPDLOCK, HOLDLOCK)
        WHERE ci.PlantId = @PlantId
          AND ci.CheckInLocalDate = @LocalDate;

        IF @CheckInId IS NULL
        BEGIN
            DECLARE @NewCheckIn TABLE (CheckInId UNIQUEIDENTIFIER NOT NULL);
            INSERT plant.PlantCheckIns (PlantId, CheckInLocalDate)
                OUTPUT inserted.CheckInId INTO @NewCheckIn
            VALUES (@PlantId, @LocalDate);
            SELECT @CheckInId = CheckInId FROM @NewCheckIn;
            SET @IsFirstToday = 1;

            SET @CurrentStreak = CASE
                WHEN @LastCheckInDate = DATEADD(DAY, -1, @LocalDate) THEN @CurrentStreak + 1
                ELSE 1
            END;
            SET @BestStreak = CASE WHEN @CurrentStreak > @BestStreak THEN @CurrentStreak ELSE @BestStreak END;
            SET @Progress = CASE WHEN @Progress < 100 THEN @Progress + 1 ELSE 100 END;

            UPDATE plant.Plants
            SET CurrentStreak = @CurrentStreak,
                BestStreak = @BestStreak,
                LastCheckInLocalDate = @LocalDate,
                ProgressPercent = @Progress,
                StageCode = CASE WHEN @Progress >= 90 THEN 'MATURE' WHEN @Progress >= 65 THEN 'GROWING' ELSE 'SEEDLING' END,
                UpdatedAtUtc = @NowUtc
            WHERE PlantId = @PlantId;
        END;

        DECLARE @NewPhoto TABLE (PhotoId UNIQUEIDENTIFIER NOT NULL);
        INSERT plant.PlantPhotos
        (
            PlantId, CheckInId, ClientRequestId, StorageObjectKey, PublicUrl,
            CaptureSourceCode, MimeType, WidthPixels, HeightPixels, FileSizeBytes,
            Sha256, CountsForStreak, CapturedAtUtc
        )
            OUTPUT inserted.PhotoId INTO @NewPhoto
        VALUES
        (
            @PlantId, @CheckInId, @ClientRequestId, @StorageObjectKey, @PublicUrl,
            @CaptureSourceCode, @MimeType, @WidthPixels, @HeightPixels, @FileSizeBytes,
            @Sha256, @IsFirstToday, @CapturedAtUtc
        );
        SELECT @PhotoId = PhotoId FROM @NewPhoto;

        DECLARE @NewAnalysis TABLE (AnalysisId UNIQUEIDENTIFIER NOT NULL);
        INSERT plant.PlantAnalyses (PlantId, PhotoId, StatusCode)
            OUTPUT inserted.AnalysisId INTO @NewAnalysis
        VALUES (@PlantId, @PhotoId, 'PENDING');
        SELECT @AnalysisId = AnalysisId FROM @NewAnalysis;

        UPDATE plant.PlantChibis
        SET IsCurrent = 0
        WHERE PlantId = @PlantId AND IsCurrent = 1;

        DECLARE @NewChibi TABLE (PlantChibiId UNIQUEIDENTIFIER NOT NULL);
        INSERT plant.PlantChibis (PlantId, SourcePhotoId, StatusCode, FallbackEmoji, IsCurrent)
            OUTPUT inserted.PlantChibiId INTO @NewChibi
        VALUES (@PlantId, @PhotoId, 'PENDING', @FallbackEmoji, 1);
        SELECT @PlantChibiId = PlantChibiId FROM @NewChibi;

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT
            'CHECKIN_OK' AS ResultCode,
            @IsFirstToday AS IsFirstToday,
            @CheckInId AS CheckInId,
            @PhotoId AS PhotoId,
            @AnalysisId AS AnalysisId,
            @PlantChibiId AS PlantChibiId,
            p.CurrentStreak,
            p.BestStreak,
            p.RowVersion
        FROM plant.Plants AS p
        WHERE p.PlantId = @PlantId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION CreatePlantCheckInSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_CompletePlantAnalysis
    @UserId       UNIQUEIDENTIFIER,
    @AnalysisId   UNIQUEIDENTIFIER,
    @LevelCode    VARCHAR(16),
    @Title        NVARCHAR(200),
    @Summary      NVARCHAR(1000),
    @Confidence   DECIMAL(5,4) = NULL,
    @ModelName    NVARCHAR(100) = NULL,
    @ModelVersion NVARCHAR(60) = NULL,
    @RawResultJson NVARCHAR(MAX) = NULL,
    @Actions      plant.AnalysisActionInput READONLY
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @LevelCode NOT IN ('GOOD', 'ATTENTION', 'WARNING')
        THROW 51010, 'INVALID_ANALYSIS_LEVEL', 1;
    IF @RawResultJson IS NOT NULL AND ISJSON(@RawResultJson) <> 1
        THROW 51011, 'INVALID_ANALYSIS_JSON', 1;

    DECLARE @PlantId UNIQUEIDENTIFIER;
    DECLARE @PhotoId UNIQUEIDENTIFIER;
    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION CompletePlantAnalysisSave;

        SELECT
            @PlantId = a.PlantId,
            @PhotoId = a.PhotoId
        FROM plant.PlantAnalyses AS a WITH (UPDLOCK, HOLDLOCK)
        JOIN plant.Plants AS p ON p.PlantId = a.PlantId
        WHERE a.AnalysisId = @AnalysisId
          AND p.UserId = @UserId
          AND p.DeletedAtUtc IS NULL;

        IF @PlantId IS NULL
            THROW 51012, 'ANALYSIS_NOT_FOUND', 1;

        UPDATE plant.PlantAnalyses
        SET StatusCode = 'COMPLETED',
            LevelCode = @LevelCode,
            Title = @Title,
            Summary = @Summary,
            Confidence = @Confidence,
            ModelName = @ModelName,
            ModelVersion = @ModelVersion,
            RawResultJson = @RawResultJson,
            FailureCode = NULL,
            CompletedAtUtc = @NowUtc
        WHERE AnalysisId = @AnalysisId;

        DELETE plant.PlantAnalysisActions WHERE AnalysisId = @AnalysisId;
        INSERT plant.PlantAnalysisActions (AnalysisId, SortOrder, ActionText)
        SELECT @AnalysisId, SortOrder, ActionText
        FROM @Actions;

        UPDATE plant.Plants
        SET HealthStatus = CASE WHEN @LevelCode = 'GOOD' THEN N'Khỏe mạnh' ELSE N'Cần theo dõi' END,
            MoodText = @Title,
            UpdatedAtUtc = @NowUtc
        WHERE PlantId = @PlantId
          AND @PhotoId =
          (
              SELECT TOP (1) latestPhoto.PhotoId
              FROM plant.PlantPhotos AS latestPhoto
              WHERE latestPhoto.PlantId = @PlantId
                AND latestPhoto.DeletedAtUtc IS NULL
              ORDER BY latestPhoto.CreatedAtUtc DESC, latestPhoto.PhotoId DESC
          );

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'ANALYSIS_COMPLETED' AS ResultCode, @AnalysisId AS AnalysisId, @PlantId AS PlantId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION CompletePlantAnalysisSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_CompletePlantChibi
    @UserId                UNIQUEIDENTIFIER,
    @PlantChibiId          UNIQUEIDENTIFIER,
    @ImageStorageObjectKey NVARCHAR(512),
    @ImagePublicUrl        NVARCHAR(2048) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    UPDATE c
    SET StatusCode = 'COMPLETED',
        ImageStorageObjectKey = @ImageStorageObjectKey,
        ImagePublicUrl = @ImagePublicUrl,
        FailureCode = NULL,
        CompletedAtUtc = SYSUTCDATETIME()
    FROM plant.PlantChibis AS c
    JOIN plant.Plants AS p ON p.PlantId = c.PlantId
    WHERE c.PlantChibiId = @PlantChibiId
      AND p.UserId = @UserId
      AND p.DeletedAtUtc IS NULL;

    IF @@ROWCOUNT = 0
        THROW 51013, 'CHIBI_NOT_FOUND', 1;

    SELECT 'CHIBI_COMPLETED' AS ResultCode, @PlantChibiId AS PlantChibiId;
END;
GO

CREATE OR ALTER PROCEDURE game.usp_FeedPet
    @UserId          UNIQUEIDENTIFIER,
    @UserPetId       UNIQUEIDENTIFIER,
    @ItemId          INT,
    @ClientRequestId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @ExperienceGain INT;
    DECLARE @ExperienceBefore BIGINT;
    DECLARE @ExperienceAfter BIGINT;
    DECLARE @LevelBefore SMALLINT;
    DECLARE @LevelAfter SMALLINT;
    DECLARE @ItemQuantityAfter INT;
    DECLARE @EventId UNIQUEIDENTIFIER;
    DECLARE @ReplayUserId UNIQUEIDENTIFIER;
    DECLARE @ReplayUserPetId UNIQUEIDENTIFIER;
    DECLARE @ReplayItemId INT;
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION FeedPetSave;

        SELECT TOP (1)
            @EventId = e.PetFeedEventId,
            @ExperienceGain = e.ExperienceGained,
            @ExperienceBefore = e.ExperienceBefore,
            @ExperienceAfter = e.ExperienceAfter,
            @LevelBefore = e.LevelBefore,
            @LevelAfter = e.LevelAfter,
            @ItemQuantityAfter = e.ItemQuantityAfter,
            @ReplayUserId = e.UserId,
            @ReplayUserPetId = e.UserPetId,
            @ReplayItemId = e.ItemId
        FROM game.PetFeedEvents AS e WITH (UPDLOCK, HOLDLOCK)
        WHERE e.ClientRequestId = @ClientRequestId;

        IF @EventId IS NOT NULL
        BEGIN
            IF @ReplayUserId <> @UserId
               OR @ReplayUserPetId <> @UserPetId
               OR @ReplayItemId <> @ItemId
                THROW 51024, 'CLIENT_REQUEST_ID_CONFLICT', 1;

            IF @StartTranCount = 0 COMMIT TRANSACTION;
            SELECT 'FEED_REPLAY' AS ResultCode, @EventId AS PetFeedEventId,
                   @ExperienceGain AS ExperienceGained, @ExperienceBefore AS ExperienceBefore,
                   @ExperienceAfter AS ExperienceAfter, @LevelBefore AS LevelBefore,
                   @LevelAfter AS LevelAfter, @ItemQuantityAfter AS ItemQuantityAfter;
            RETURN;
        END;

        SELECT
            @ExperienceBefore = up.TotalExperience,
            @LevelBefore = up.LevelNumber
        FROM game.UserPets AS up WITH (UPDLOCK, HOLDLOCK)
        WHERE up.UserPetId = @UserPetId
          AND up.UserId = @UserId;

        IF @ExperienceBefore IS NULL
            THROW 51020, 'PET_NOT_FOUND', 1;

        SELECT @ExperienceGain = ic.ExperienceGain
        FROM game.ItemCatalog AS ic
        WHERE ic.ItemId = @ItemId
          AND ic.CategoryCode = 'FOOD'
          AND ic.IsActive = 1;

        IF @ExperienceGain IS NULL OR @ExperienceGain <= 0
            THROW 51021, 'ITEM_NOT_FOOD', 1;

        UPDATE game.UserItems WITH (UPDLOCK)
        SET Quantity = Quantity - 1,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE UserId = @UserId
          AND ItemId = @ItemId
          AND Quantity > 0;

        IF @@ROWCOUNT = 0
            THROW 51022, 'ITEM_OUT_OF_STOCK', 1;

        SELECT @ItemQuantityAfter = Quantity
        FROM game.UserItems
        WHERE UserId = @UserId AND ItemId = @ItemId;

        SET @ExperienceAfter = @ExperienceBefore + @ExperienceGain;
        SELECT @LevelAfter = MAX(LevelNumber)
        FROM game.PetLevelThresholds
        WHERE MinTotalExperience <= @ExperienceAfter;
        SET @LevelAfter = COALESCE(@LevelAfter, @LevelBefore);

        UPDATE game.UserPets
        SET TotalExperience = @ExperienceAfter,
            LevelNumber = @LevelAfter,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE UserPetId = @UserPetId;

        DECLARE @NewEvent TABLE (PetFeedEventId UNIQUEIDENTIFIER NOT NULL);
        INSERT game.PetFeedEvents
        (
            UserId, UserPetId, ItemId, ClientRequestId, QuantityUsed,
            ExperienceGained, ExperienceBefore, ExperienceAfter,
            LevelBefore, LevelAfter, ItemQuantityAfter
        )
            OUTPUT inserted.PetFeedEventId INTO @NewEvent
        VALUES
        (
            @UserId, @UserPetId, @ItemId, @ClientRequestId, 1,
            @ExperienceGain, @ExperienceBefore, @ExperienceAfter,
            @LevelBefore, @LevelAfter, @ItemQuantityAfter
        );
        SELECT @EventId = PetFeedEventId FROM @NewEvent;

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'FEED_OK' AS ResultCode, @EventId AS PetFeedEventId,
               @ExperienceGain AS ExperienceGained, @ExperienceBefore AS ExperienceBefore,
               @ExperienceAfter AS ExperienceAfter, @LevelBefore AS LevelBefore,
               @LevelAfter AS LevelAfter, @ItemQuantityAfter AS ItemQuantityAfter;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION FeedPetSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE game.usp_SelectCompanion
    @UserId    UNIQUEIDENTIFIER,
    @UserPetId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @StartTranCount INT = @@TRANCOUNT;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION SelectCompanionSave;

        IF NOT EXISTS
        (
            SELECT 1 FROM game.UserPets WITH (UPDLOCK, HOLDLOCK)
            WHERE UserPetId = @UserPetId AND UserId = @UserId
        )
            THROW 51023, 'PET_NOT_FOUND', 1;

        UPDATE game.UserPets
        SET IsCompanion = 0,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE UserId = @UserId AND IsCompanion = 1 AND UserPetId <> @UserPetId;

        UPDATE game.UserPets
        SET IsCompanion = 1,
            UpdatedAtUtc = SYSUTCDATETIME()
        WHERE UserPetId = @UserPetId;

        IF @StartTranCount = 0 COMMIT TRANSACTION;
        SELECT 'COMPANION_SELECTED' AS ResultCode, @UserPetId AS UserPetId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION SelectCompanionSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE game.usp_RecordArHunt
    @UserId          UNIQUEIDENTIFIER,
    @PlantId         UNIQUEIDENTIFIER,
    @ClientRequestId UNIQUEIDENTIFIER,
    @CapturedPetId   INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @TimeZoneId SYSNAME;
    DECLARE @HuntLocalDate DATE;
    DECLARE @HuntId UNIQUEIDENTIFIER;
    DECLARE @WasNewPet BIT = NULL;
    DECLARE @StatusCode VARCHAR(16);
    DECLARE @ReplayUserId UNIQUEIDENTIFIER;
    DECLARE @ReplayPlantId UNIQUEIDENTIFIER;
    DECLARE @ReplayCapturedPetId INT;
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    SELECT @TimeZoneId = TimeZoneId FROM app.UserSettings WHERE UserId = @UserId;
    SET @TimeZoneId = COALESCE(@TimeZoneId, N'SE Asia Standard Time');
    SET @HuntLocalDate = CONVERT(DATE, @NowUtc AT TIME ZONE 'UTC' AT TIME ZONE @TimeZoneId);

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION RecordArHuntSave;

        IF NOT EXISTS
        (
            SELECT 1
            FROM plant.Plants WITH (UPDLOCK, HOLDLOCK)
            WHERE PlantId = @PlantId AND UserId = @UserId AND DeletedAtUtc IS NULL
        )
            THROW 51030, 'PLANT_NOT_FOUND', 1;

        SELECT
            @HuntId = ArHuntId,
            @ReplayUserId = UserId,
            @ReplayPlantId = PlantId,
            @ReplayCapturedPetId = CapturedPetId
        FROM game.ArHunts WITH (UPDLOCK, HOLDLOCK)
        WHERE ClientRequestId = @ClientRequestId;

        IF @HuntId IS NOT NULL
        BEGIN
            IF @ReplayUserId <> @UserId
               OR @ReplayPlantId <> @PlantId
               OR ISNULL(@ReplayCapturedPetId, -1) <> ISNULL(@CapturedPetId, -1)
                THROW 51033, 'CLIENT_REQUEST_ID_CONFLICT', 1;

            IF @StartTranCount = 0 COMMIT TRANSACTION;
            SELECT 'AR_HUNT_REPLAY' AS ResultCode, ArHuntId, HuntLocalDate, StatusCode,
                   CapturedPetId, WasNewPet
            FROM game.ArHunts WHERE ArHuntId = @HuntId;
            RETURN;
        END;

        IF EXISTS
        (
            SELECT 1 FROM game.ArHunts WITH (UPDLOCK, HOLDLOCK)
            WHERE UserId = @UserId AND HuntLocalDate = @HuntLocalDate
        )
            THROW 51031, 'AR_DAILY_LIMIT', 1;

        IF @CapturedPetId IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM game.PetCatalog WHERE PetId = @CapturedPetId AND IsActive = 1)
            THROW 51032, 'PET_CATALOG_NOT_FOUND', 1;

        IF @CapturedPetId IS NOT NULL
        BEGIN
            IF EXISTS
            (
                SELECT 1 FROM game.UserPets WITH (UPDLOCK, HOLDLOCK)
                WHERE UserId = @UserId AND PetId = @CapturedPetId
            )
                SET @WasNewPet = 0;
            ELSE
                SET @WasNewPet = 1;
            SET @StatusCode = 'CAPTURED';
        END
        ELSE
        BEGIN
            SET @StatusCode = 'NO_RESULT';
        END;

        DECLARE @NewHunt TABLE (ArHuntId UNIQUEIDENTIFIER NOT NULL);
        INSERT game.ArHunts
        (
            UserId, PlantId, ClientRequestId, HuntLocalDate, StatusCode,
            CapturedPetId, WasNewPet, StartedAtUtc, CompletedAtUtc
        )
            OUTPUT inserted.ArHuntId INTO @NewHunt
        VALUES
        (
            @UserId, @PlantId, @ClientRequestId, @HuntLocalDate, @StatusCode,
            @CapturedPetId, @WasNewPet, @NowUtc, @NowUtc
        );
        SELECT @HuntId = ArHuntId FROM @NewHunt;

        IF @CapturedPetId IS NOT NULL
        BEGIN
            IF @WasNewPet = 0
            BEGIN
                UPDATE game.UserPets
                SET Quantity = Quantity + 1,
                    UpdatedAtUtc = @NowUtc
                WHERE UserId = @UserId AND PetId = @CapturedPetId;
            END
            ELSE
            BEGIN
                INSERT game.UserPets (UserId, PetId, Quantity, LevelNumber, TotalExperience, IsCompanion)
                VALUES (@UserId, @CapturedPetId, 1, 1, 0, 0);
            END;
        END;

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'AR_HUNT_OK' AS ResultCode, @HuntId AS ArHuntId,
               @HuntLocalDate AS HuntLocalDate, @StatusCode AS StatusCode,
               @CapturedPetId AS CapturedPetId, @WasNewPet AS WasNewPet;
    END TRY
    BEGIN CATCH
        DECLARE @ErrorNumber INT = ERROR_NUMBER();
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION RecordArHuntSave;
        IF @ErrorNumber IN (2601, 2627)
        BEGIN
            IF EXISTS (SELECT 1 FROM game.ArHunts WHERE ClientRequestId = @ClientRequestId)
                THROW 51033, 'CLIENT_REQUEST_ID_CONFLICT', 1;
            IF EXISTS (SELECT 1 FROM game.ArHunts WHERE UserId = @UserId AND HuntLocalDate = @HuntLocalDate)
                THROW 51031, 'AR_DAILY_LIMIT', 1;
        END;
        THROW;
    END CATCH;
END;
GO

/* ============================== READ VIEWS ============================== */

CREATE OR ALTER VIEW app.vw_UserProfileSettings
AS
    SELECT
        u.UserId,
        u.Email,
        u.PhoneE164,
        p.DisplayName,
        p.ProfileTitle,
        p.AvatarEmoji,
        p.AvatarStorageKey,
        p.AvatarPublicUrl,
        s.NotificationsEnabled,
        s.ReminderLocalTime,
        s.TimeZoneId,
        s.LightArEnabled,
        s.MusicEnabled,
        s.AiToneCode,
        s.BattleNotifyEnabled
    FROM auth.Users AS u
    JOIN app.UserProfiles AS p ON p.UserId = u.UserId
    JOIN app.UserSettings AS s ON s.UserId = u.UserId
    WHERE u.IsActive = 1 AND u.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW plant.vw_PlantDashboard
AS
    SELECT
        p.PlantId,
        p.UserId,
        p.PlantName,
        p.SpeciesName,
        p.PlantedOn,
        p.StageCode,
        p.ProgressPercent,
        p.HealthStatus,
        p.MoodText,
        p.CurrentStreak,
        p.BestStreak,
        p.LastCheckInLocalDate,
        p.HistoryComplete,
        c.PlantChibiId,
        c.StatusCode AS ChibiStatusCode,
        c.FallbackEmoji,
        c.ImageStorageObjectKey AS ChibiStorageObjectKey,
        c.ImagePublicUrl AS ChibiPublicUrl,
        latest.PhotoId AS LatestPhotoId,
        latest.StorageObjectKey AS LatestPhotoStorageObjectKey,
        latest.PublicUrl AS LatestPhotoPublicUrl,
        latest.AnalysisId AS LatestAnalysisId,
        latest.AnalysisStatusCode,
        latest.LevelCode AS LatestAnalysisLevelCode,
        latest.Title AS LatestAnalysisTitle,
        latest.Summary AS LatestAnalysisSummary,
        p.RowVersion
    FROM plant.Plants AS p
    OUTER APPLY
    (
        SELECT TOP (1) pc.*
        FROM plant.PlantChibis AS pc
        WHERE pc.PlantId = p.PlantId AND pc.IsCurrent = 1
    ) AS c
    OUTER APPLY
    (
        SELECT TOP (1)
            ph.PhotoId,
            ph.StorageObjectKey,
            ph.PublicUrl,
            a.AnalysisId,
            a.StatusCode AS AnalysisStatusCode,
            a.LevelCode,
            a.Title,
            a.Summary
        FROM plant.PlantPhotos AS ph
        LEFT JOIN plant.PlantAnalyses AS a ON a.PhotoId = ph.PhotoId
        WHERE ph.PlantId = p.PlantId AND ph.DeletedAtUtc IS NULL
        ORDER BY ph.CreatedAtUtc DESC, ph.PhotoId DESC
    ) AS latest
    WHERE p.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW game.vw_UserPetCollection
AS
    SELECT
        up.UserPetId,
        up.UserId,
        pc.PetId,
        pc.PetCode,
        pc.DisplayName,
        pc.IconEmoji,
        pc.RarityCode,
        pc.ElementCode,
        pc.RoleCode,
        pc.BuffText,
        pc.DiscoveryHint,
        up.Quantity,
        up.LevelNumber,
        up.TotalExperience,
        up.TotalExperience - currentLevel.MinTotalExperience AS ExperienceInCurrentLevel,
        nextLevel.MinTotalExperience - currentLevel.MinTotalExperience AS ExperienceRequiredForLevel,
        nextLevel.MinTotalExperience AS NextLevelExperience,
        up.IsCompanion,
        up.RowVersion
    FROM game.UserPets AS up
    JOIN game.PetCatalog AS pc ON pc.PetId = up.PetId
    JOIN game.PetLevelThresholds AS currentLevel ON currentLevel.LevelNumber = up.LevelNumber
    LEFT JOIN game.PetLevelThresholds AS nextLevel ON nextLevel.LevelNumber = up.LevelNumber + 1;
GO

CREATE OR ALTER VIEW game.vw_UserItemInventory
AS
    SELECT
        ui.UserId,
        ic.ItemId,
        ic.ItemCode,
        ic.DisplayName,
        ic.IconEmoji,
        ic.RarityCode,
        ic.CategoryCode,
        ic.ExperienceGain,
        ic.Description,
        ui.Quantity,
        ui.RowVersion
    FROM game.UserItems AS ui
    JOIN game.ItemCatalog AS ic ON ic.ItemId = ui.ItemId
    WHERE ic.IsActive = 1;
GO

CREATE OR ALTER VIEW game.vw_PetCatalog
AS
    SELECT
        PetId,
        PetCode,
        DisplayName,
        IconEmoji,
        RarityCode,
        ElementCode,
        RoleCode,
        BuffText,
        DiscoveryHint
    FROM game.PetCatalog
    WHERE IsActive = 1;
GO

CREATE OR ALTER VIEW game.vw_ItemCatalog
AS
    SELECT
        ItemId,
        ItemCode,
        DisplayName,
        IconEmoji,
        RarityCode,
        CategoryCode,
        ExperienceGain,
        Description
    FROM game.ItemCatalog
    WHERE IsActive = 1;
GO

CREATE OR ALTER VIEW plant.vw_PlantCheckInHistory
AS
    SELECT
        p.UserId,
        p.PlantId,
        p.PlantName,
        ci.CheckInId,
        ci.CheckInLocalDate,
        ph.PhotoId,
        ph.CountsForStreak,
        ph.StorageObjectKey,
        ph.PublicUrl,
        ph.CaptureSourceCode,
        ph.MimeType,
        ph.WidthPixels,
        ph.HeightPixels,
        ph.FileSizeBytes,
        ph.CapturedAtUtc,
        a.AnalysisId,
        a.StatusCode AS AnalysisStatusCode,
        a.LevelCode,
        a.Title,
        a.Summary,
        a.Confidence,
        a.CreatedAtUtc AS AnalysisCreatedAtUtc,
        a.CompletedAtUtc AS AnalysisCompletedAtUtc
    FROM plant.Plants AS p
    JOIN plant.PlantCheckIns AS ci ON ci.PlantId = p.PlantId
    JOIN plant.PlantPhotos AS ph ON ph.CheckInId = ci.CheckInId AND ph.PlantId = p.PlantId
    LEFT JOIN plant.PlantAnalyses AS a ON a.PhotoId = ph.PhotoId
    WHERE p.DeletedAtUtc IS NULL AND ph.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW plant.vw_PlantAnalysisActionHistory
AS
    SELECT
        p.UserId,
        analysis.PlantId,
        analysis.PhotoId,
        analysis.AnalysisId,
        action.SortOrder,
        action.ActionText
    FROM plant.PlantAnalysisActions AS action
    JOIN plant.PlantAnalyses AS analysis ON analysis.AnalysisId = action.AnalysisId
    JOIN plant.Plants AS p ON p.PlantId = analysis.PlantId
    WHERE p.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW game.vw_ArHuntHistory
AS
    SELECT
        hunt.UserId,
        hunt.ArHuntId,
        hunt.PlantId,
        plant.PlantName,
        hunt.HuntLocalDate,
        hunt.StatusCode,
        hunt.CapturedPetId,
        pet.PetCode AS CapturedPetCode,
        pet.DisplayName AS CapturedPetName,
        pet.IconEmoji AS CapturedPetIconEmoji,
        hunt.WasNewPet,
        hunt.StartedAtUtc,
        hunt.CompletedAtUtc
    FROM game.ArHunts AS hunt
    JOIN plant.Plants AS plant ON plant.PlantId = hunt.PlantId AND plant.UserId = hunt.UserId
    LEFT JOIN game.PetCatalog AS pet ON pet.PetId = hunt.CapturedPetId;
GO

/* ============================== API ROLE ============================== */

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
