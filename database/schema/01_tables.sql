/*
 * Tạo 18 bảng và các cột nền tảng; ràng buộc được áp dụng ở thư mục constraints/ ngay sau bước này.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF OBJECT_ID(N'auth.Users', N'U') IS NULL
BEGIN
    CREATE TABLE auth.Users
    (
        UserId              UNIQUEIDENTIFIER NOT NULL,
        Email               NVARCHAR(320) NULL,
        NormalizedEmail     NVARCHAR(320) NULL,
        PhoneE164           VARCHAR(20) NULL,
        PasswordHash        NVARCHAR(500) NULL,
        PasswordHashVersion SMALLINT NULL,
        AuthProviderCode    VARCHAR(16) NOT NULL,
        IsActive            BIT NOT NULL,
        EmailConfirmedAtUtc DATETIME2(3) NULL,
        LastLoginAtUtc      DATETIME2(3) NULL,
        CreatedAtUtc        DATETIME2(3) NOT NULL,
        UpdatedAtUtc        DATETIME2(3) NOT NULL,
        DeletedAtUtc        DATETIME2(3) NULL,
        RowVersion          ROWVERSION NOT NULL
    );
END;
GO

IF OBJECT_ID(N'auth.RefreshTokens', N'U') IS NULL
BEGIN
    CREATE TABLE auth.RefreshTokens
    (
        RefreshTokenId UNIQUEIDENTIFIER NOT NULL,
        UserId         UNIQUEIDENTIFIER NOT NULL,
        TokenHash      BINARY(32) NOT NULL,
        CreatedAtUtc   DATETIME2(3) NOT NULL,
        ExpiresAtUtc   DATETIME2(3) NOT NULL,
        RevokedAtUtc   DATETIME2(3) NULL,
        ReplacedByHash BINARY(32) NULL
    );
END;
GO

IF OBJECT_ID(N'auth.UserActionTokens', N'U') IS NULL
BEGIN
    CREATE TABLE auth.UserActionTokens
    (
        UserActionTokenId UNIQUEIDENTIFIER NOT NULL,
        UserId            UNIQUEIDENTIFIER NOT NULL,
        PurposeCode       VARCHAR(24) NOT NULL,
        TokenHash         BINARY(32) NOT NULL,
        CreatedAtUtc      DATETIME2(3) NOT NULL,
        ExpiresAtUtc      DATETIME2(3) NOT NULL,
        ConsumedAtUtc     DATETIME2(3) NULL,
        RevokedAtUtc      DATETIME2(3) NULL
    );
END;
GO

IF OBJECT_ID(N'app.UserProfiles', N'U') IS NULL
BEGIN
    CREATE TABLE app.UserProfiles
    (
        UserId               UNIQUEIDENTIFIER NOT NULL,
        DisplayName          NVARCHAR(80) NOT NULL,
        ProfileTitle         NVARCHAR(120) NOT NULL,
        AvatarEmoji          NVARCHAR(16) NOT NULL,
        AvatarStorageKey     NVARCHAR(512) NULL,
        AvatarPublicUrl      NVARCHAR(2048) NULL,
        CreatedAtUtc         DATETIME2(3) NOT NULL,
        UpdatedAtUtc         DATETIME2(3) NOT NULL,
        RowVersion           ROWVERSION NOT NULL
    );
END;
GO

IF OBJECT_ID(N'app.UserSettings', N'U') IS NULL
BEGIN
    CREATE TABLE app.UserSettings
    (
        UserId                UNIQUEIDENTIFIER NOT NULL,
        NotificationsEnabled BIT NOT NULL,
        ReminderLocalTime     TIME(0) NOT NULL,
        TimeZoneId            SYSNAME NOT NULL,
        LightArEnabled        BIT NOT NULL,
        MusicEnabled          BIT NOT NULL,
        AiToneCode            VARCHAR(16) NOT NULL,
        BattleNotifyEnabled   BIT NOT NULL,
        UpdatedAtUtc          DATETIME2(3) NOT NULL,
        RowVersion            ROWVERSION NOT NULL
    );
END;
GO

IF OBJECT_ID(N'plant.Plants', N'U') IS NULL
BEGIN
    CREATE TABLE plant.Plants
    (
        PlantId              UNIQUEIDENTIFIER NOT NULL,
        UserId               UNIQUEIDENTIFIER NOT NULL,
        CreateClientRequestId UNIQUEIDENTIFIER NOT NULL,
        PlantName            NVARCHAR(80) NOT NULL,
        SpeciesName          NVARCHAR(120) NOT NULL,
        PlantedOn            DATE NOT NULL,
        StageCode            VARCHAR(24) NOT NULL,
        ProgressPercent      TINYINT NOT NULL,
        HealthStatus         NVARCHAR(80) NOT NULL,
        MoodText             NVARCHAR(160) NOT NULL,
        CurrentStreak        INT NOT NULL,
        BestStreak           INT NOT NULL,
        LastCheckInLocalDate DATE NULL,
        HistoryComplete      BIT NOT NULL,
        CreatedAtUtc         DATETIME2(3) NOT NULL,
        UpdatedAtUtc         DATETIME2(3) NOT NULL,
        DeletedAtUtc         DATETIME2(3) NULL,
        RowVersion           ROWVERSION NOT NULL
    );
END;
GO

IF OBJECT_ID(N'plant.PlantCheckIns', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantCheckIns
    (
        CheckInId       UNIQUEIDENTIFIER NOT NULL,
        PlantId         UNIQUEIDENTIFIER NOT NULL,
        CheckInLocalDate DATE NOT NULL,
        CreatedAtUtc    DATETIME2(3) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'plant.PlantPhotos', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantPhotos
    (
        PhotoId          UNIQUEIDENTIFIER NOT NULL,
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
        CountsForStreak  BIT NOT NULL,
        CapturedAtUtc    DATETIME2(3) NOT NULL,
        CreatedAtUtc     DATETIME2(3) NOT NULL,
        DeletedAtUtc     DATETIME2(3) NULL
    );
END;
GO

IF OBJECT_ID(N'plant.PlantAnalyses', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantAnalyses
    (
        AnalysisId       UNIQUEIDENTIFIER NOT NULL,
        PlantId          UNIQUEIDENTIFIER NOT NULL,
        PhotoId          UNIQUEIDENTIFIER NOT NULL,
        StatusCode       VARCHAR(16) NOT NULL,
        LevelCode        VARCHAR(16) NULL,
        Title            NVARCHAR(200) NULL,
        Summary          NVARCHAR(1000) NULL,
        Confidence       DECIMAL(5,4) NULL,
        ModelName        NVARCHAR(100) NULL,
        ModelVersion     NVARCHAR(60) NULL,
        RawResultJson    NVARCHAR(MAX) NULL,
        FailureCode      VARCHAR(80) NULL,
        CreatedAtUtc     DATETIME2(3) NOT NULL,
        CompletedAtUtc   DATETIME2(3) NULL,
        RowVersion       ROWVERSION NOT NULL
    );
END;
GO

IF OBJECT_ID(N'plant.PlantAnalysisActions', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantAnalysisActions
    (
        AnalysisActionId BIGINT IDENTITY(1,1) NOT NULL,
        AnalysisId       UNIQUEIDENTIFIER NOT NULL,
        SortOrder         TINYINT NOT NULL,
        ActionText        NVARCHAR(500) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'plant.PlantChibis', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantChibis
    (
        PlantChibiId         UNIQUEIDENTIFIER NOT NULL,
        PlantId              UNIQUEIDENTIFIER NOT NULL,
        SourcePhotoId        UNIQUEIDENTIFIER NULL,
        StatusCode           VARCHAR(16) NOT NULL,
        StyleCode            VARCHAR(30) NOT NULL,
        FallbackEmoji        NVARCHAR(16) NOT NULL,
        ImageStorageObjectKey NVARCHAR(512) NULL,
        ImagePublicUrl       NVARCHAR(2048) NULL,
        IsCurrent            BIT NOT NULL,
        CreatedAtUtc         DATETIME2(3) NOT NULL,
        CompletedAtUtc       DATETIME2(3) NULL,
        FailureCode          VARCHAR(80) NULL,
        RowVersion           ROWVERSION NOT NULL
    );
END;
GO

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
        IsActive       BIT NOT NULL,
        CreatedAtUtc   DATETIME2(3) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'game.PetLevelThresholds', N'U') IS NULL
BEGIN
    CREATE TABLE game.PetLevelThresholds
    (
        LevelNumber       SMALLINT NOT NULL,
        MinTotalExperience BIGINT NOT NULL
    );
END;
GO

IF OBJECT_ID(N'game.UserPets', N'U') IS NULL
BEGIN
    CREATE TABLE game.UserPets
    (
        UserPetId       UNIQUEIDENTIFIER NOT NULL,
        UserId          UNIQUEIDENTIFIER NOT NULL,
        PetId           INT NOT NULL,
        Quantity        INT NOT NULL,
        LevelNumber     SMALLINT NOT NULL,
        TotalExperience BIGINT NOT NULL,
        IsCompanion     BIT NOT NULL,
        FirstCaughtAtUtc DATETIME2(3) NOT NULL,
        UpdatedAtUtc    DATETIME2(3) NOT NULL,
        RowVersion      ROWVERSION NOT NULL
    );
END;
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
        ExperienceGain   INT NOT NULL,
        Description      NVARCHAR(500) NOT NULL,
        IsActive         BIT NOT NULL,
        CreatedAtUtc     DATETIME2(3) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'game.UserItems', N'U') IS NULL
BEGIN
    CREATE TABLE game.UserItems
    (
        UserId       UNIQUEIDENTIFIER NOT NULL,
        ItemId       INT NOT NULL,
        Quantity     INT NOT NULL,
        UpdatedAtUtc DATETIME2(3) NOT NULL,
        RowVersion   ROWVERSION NOT NULL
    );
END;
GO

IF OBJECT_ID(N'game.PetFeedEvents', N'U') IS NULL
BEGIN
    CREATE TABLE game.PetFeedEvents
    (
        PetFeedEventId      UNIQUEIDENTIFIER NOT NULL,
        UserId              UNIQUEIDENTIFIER NOT NULL,
        UserPetId           UNIQUEIDENTIFIER NOT NULL,
        ItemId              INT NOT NULL,
        ClientRequestId     UNIQUEIDENTIFIER NOT NULL,
        QuantityUsed        INT NOT NULL,
        ExperienceGained    INT NOT NULL,
        ExperienceBefore    BIGINT NOT NULL,
        ExperienceAfter     BIGINT NOT NULL,
        LevelBefore         SMALLINT NOT NULL,
        LevelAfter          SMALLINT NOT NULL,
        ItemQuantityAfter   INT NOT NULL,
        CreatedAtUtc        DATETIME2(3) NOT NULL
    );
END;
GO

IF OBJECT_ID(N'game.ArHunts', N'U') IS NULL
BEGIN
    CREATE TABLE game.ArHunts
    (
        ArHuntId            UNIQUEIDENTIFIER NOT NULL,
        UserId              UNIQUEIDENTIFIER NOT NULL,
        PlantId             UNIQUEIDENTIFIER NOT NULL,
        ClientRequestId     UNIQUEIDENTIFIER NOT NULL,
        HuntLocalDate       DATE NOT NULL,
        StatusCode          VARCHAR(16) NOT NULL,
        CapturedPetId       INT NULL,
        WasNewPet           BIT NULL,
        StartedAtUtc        DATETIME2(3) NOT NULL,
        CompletedAtUtc      DATETIME2(3) NOT NULL
    );
END;
GO

