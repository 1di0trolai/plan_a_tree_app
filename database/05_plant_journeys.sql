/*
 * Mở rộng bảng và thủ tục hành trình cây, giai đoạn phát triển, lượt chăm vườn và thẻ thưởng trên SQL Server 2019+.
 * Chạy sau 01 và 02, có thể chạy lại và giữ cây, ảnh, thú nuôi cũ; không chứa khóa SQL hay dữ liệu ảnh.
 * Đây là hợp đồng lưu hành trình theo bảng; đồng bộ app hiện dùng bản chụp ở 08_cloud_sync.sql, không ghi trực tiếp các bảng này.
 * API phải lấy UserId từ phiên xác thực, kiểm tra khóa tệp riêng và kết quả Gemini; AI không thực thi SQL hoặc cấp quà.
 * Thêm cây cũ không thành lượt chăm sóc; đổi từ quả sang cây con cần xác nhận và ảnh mới, cùng loài không đồng nghĩa cùng cá thể.
 */
USE [PAT];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'plant.Plants', N'U') IS NULL
    THROW 51200, 'RUN_01_AND_02_FIRST', 1;
GO

IF COL_LENGTH(N'plant.PlantPhotos', N'PhotoPurposeCode') IS NULL
    ALTER TABLE plant.PlantPhotos ADD PhotoPurposeCode VARCHAR(16) NOT NULL
        CONSTRAINT DF_PlantPhotos_Purpose DEFAULT ('CHECKIN') WITH VALUES;
GO
IF COL_LENGTH(N'plant.PlantPhotos', N'JourneyPhaseCode') IS NULL
    ALTER TABLE plant.PlantPhotos ADD JourneyPhaseCode VARCHAR(16) NULL;
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'plant.PlantPhotos') AND name = N'CheckInId' AND is_nullable = 0)
    ALTER TABLE plant.PlantPhotos ALTER COLUMN CheckInId UNIQUEIDENTIFIER NULL;
GO
IF OBJECT_ID(N'plant.CK_PlantPhotos_Purpose', N'C') IS NULL
    ALTER TABLE plant.PlantPhotos WITH CHECK ADD CONSTRAINT CK_PlantPhotos_Purpose CHECK
    (
        (PhotoPurposeCode = 'CHECKIN' AND CheckInId IS NOT NULL)
        OR (PhotoPurposeCode IN ('ENROLLMENT', 'REFERENCE', 'INSPECTION') AND CheckInId IS NULL AND CountsForStreak = 0)
    );
IF OBJECT_ID(N'plant.CK_PlantPhotos_JourneyPhase', N'C') IS NULL
    ALTER TABLE plant.PlantPhotos WITH CHECK ADD CONSTRAINT CK_PlantPhotos_JourneyPhase CHECK
    (JourneyPhaseCode IS NULL OR JourneyPhaseCode IN ('planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting'));
GO

IF COL_LENGTH(N'plant.PlantAnalyses', N'ProviderCode') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD ProviderCode VARCHAR(12) NOT NULL
        CONSTRAINT DF_PlantAnalyses_Provider DEFAULT ('LEGACY') WITH VALUES;
GO
IF OBJECT_ID(N'plant.CK_PlantAnalyses_Provider', N'C') IS NULL
    ALTER TABLE plant.PlantAnalyses WITH CHECK ADD CONSTRAINT CK_PlantAnalyses_Provider
        CHECK (ProviderCode IN ('GEMINI', 'DEMO', 'LEGACY'));
GO

IF OBJECT_ID(N'plant.PlantJourneys', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantJourneys
    (
        PlantId UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_PlantJourneys PRIMARY KEY,
        CropCode VARCHAR(16) NOT NULL,
        PhaseCode VARCHAR(16) NOT NULL,
        GrowingMethodCode VARCHAR(16) NOT NULL,
        LocationNotes NVARCHAR(500) NULL,
        LightNotes NVARCHAR(500) NULL,
        StarterGuideJson NVARCHAR(MAX) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_PlantJourneys_Active DEFAULT (1),
        StartedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PlantJourneys_Started DEFAULT SYSUTCDATETIME(),
        UpdatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PlantJourneys_Updated DEFAULT SYSUTCDATETIME(),
        RowVersion ROWVERSION NOT NULL,
        CONSTRAINT FK_PlantJourneys_Plant FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId),
        CONSTRAINT CK_PlantJourneys_Crop CHECK (CropCode IN ('mango', 'tomato', 'chili', 'other')),
        CONSTRAINT CK_PlantJourneys_Phase CHECK (PhaseCode IN ('planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting')),
        CONSTRAINT CK_PlantJourneys_Method CHECK (GrowingMethodCode IN ('seed', 'seedling')),
        CONSTRAINT CK_PlantJourneys_Guide CHECK (StarterGuideJson IS NULL OR ISJSON(StarterGuideJson) = 1)
    );
END;
IF OBJECT_ID(N'plant.PlantReferencePhotos', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantReferencePhotos
    (
        PlantId UNIQUEIDENTIFIER NOT NULL,
        PhotoId UNIQUEIDENTIFIER NOT NULL,
        PhaseCode VARCHAR(16) NOT NULL,
        ConfirmedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PlantReferencePhotos_Confirmed DEFAULT SYSUTCDATETIME(),
        IsActive BIT NOT NULL CONSTRAINT DF_PlantReferencePhotos_Active DEFAULT (1),
        CONSTRAINT PK_PlantReferencePhotos PRIMARY KEY (PlantId, PhotoId),
        CONSTRAINT FK_PlantReferencePhotos_Journey FOREIGN KEY (PlantId) REFERENCES plant.PlantJourneys (PlantId),
        CONSTRAINT FK_PlantReferencePhotos_Photo FOREIGN KEY (PlantId, PhotoId) REFERENCES plant.PlantPhotos (PlantId, PhotoId),
        CONSTRAINT CK_PlantReferencePhotos_Phase CHECK (PhaseCode IN ('planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting'))
    );
END;
IF OBJECT_ID(N'plant.PlantCareEvents', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantCareEvents
    (
        CareEventId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_PlantCareEvents_Id DEFAULT NEWSEQUENTIALID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        PlantId UNIQUEIDENTIFIER NOT NULL,
        ClientRequestId UNIQUEIDENTIFIER NOT NULL,
        EventCode VARCHAR(20) NOT NULL,
        Note NVARCHAR(1500) NULL,
        OccurredAtUtc DATETIME2(3) NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PlantCareEvents_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PlantCareEvents PRIMARY KEY (CareEventId),
        CONSTRAINT UQ_PlantCareEvents_Request UNIQUE (ClientRequestId),
        CONSTRAINT FK_PlantCareEvents_Owner FOREIGN KEY (UserId, PlantId) REFERENCES plant.Plants (UserId, PlantId),
        CONSTRAINT CK_PlantCareEvents_Code CHECK (EventCode IN ('water', 'fertilize', 'repot', 'prune', 'sow', 'observe', 'phase_confirmed', 'note', 'other'))
    );
    CREATE INDEX IX_PlantCareEvents_Context ON plant.PlantCareEvents (PlantId, OccurredAtUtc DESC);
END;
IF OBJECT_ID(N'plant.PlantChatMessages', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantChatMessages
    (
        MessageId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_PlantChatMessages_Id DEFAULT NEWSEQUENTIALID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        PlantId UNIQUEIDENTIFIER NOT NULL,
        ClientRequestId UNIQUEIDENTIFIER NOT NULL,
        RoleCode VARCHAR(12) NOT NULL,
        ProviderCode VARCHAR(12) NULL,
        Content NVARCHAR(MAX) NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PlantChatMessages_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PlantChatMessages PRIMARY KEY (MessageId),
        CONSTRAINT UQ_PlantChatMessages_Request UNIQUE (ClientRequestId),
        CONSTRAINT FK_PlantChatMessages_Owner FOREIGN KEY (UserId, PlantId) REFERENCES plant.Plants (UserId, PlantId),
        CONSTRAINT CK_PlantChatMessages_Source CHECK
        ((RoleCode = 'USER' AND ProviderCode IS NULL) OR (RoleCode = 'ASSISTANT' AND ProviderCode IS NOT NULL AND ProviderCode IN ('GEMINI', 'DEMO', 'LEGACY'))),
        CONSTRAINT CK_PlantChatMessages_Content CHECK (LEN(LTRIM(RTRIM(Content))) > 0 AND DATALENGTH(Content) <= 64000)
    );
    CREATE INDEX IX_PlantChatMessages_Context ON plant.PlantChatMessages (PlantId, CreatedAtUtc DESC);
END;
IF OBJECT_ID(N'plant.PlantRecognitions', N'U') IS NULL
BEGIN
    CREATE TABLE plant.PlantRecognitions
    (
        RecognitionId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_PlantRecognitions_Id DEFAULT NEWSEQUENTIALID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        ImageStorageObjectKey NVARCHAR(512) NOT NULL,
        DecisionCode VARCHAR(16) NOT NULL,
        CandidateIdsJson NVARCHAR(MAX) NOT NULL,
        ChosenPlantId UNIQUEIDENTIFIER NULL,
        ConfirmedByUser BIT NOT NULL CONSTRAINT DF_PlantRecognitions_Confirmed DEFAULT (0),
        ProviderCode VARCHAR(12) NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_PlantRecognitions_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_PlantRecognitions PRIMARY KEY (RecognitionId),
        CONSTRAINT FK_PlantRecognitions_User FOREIGN KEY (UserId) REFERENCES auth.Users (UserId),
        CONSTRAINT FK_PlantRecognitions_ChosenOwner FOREIGN KEY (UserId, ChosenPlantId) REFERENCES plant.Plants (UserId, PlantId),
        CONSTRAINT CK_PlantRecognitions_Decision CHECK (DecisionCode IN ('candidate', 'ambiguous', 'unknown', 'retake')),
        CONSTRAINT CK_PlantRecognitions_Json CHECK (ISJSON(CandidateIdsJson) = 1),
        CONSTRAINT CK_PlantRecognitions_Confirmation CHECK
        ((ConfirmedByUser = 0 AND ChosenPlantId IS NULL) OR (ConfirmedByUser = 1 AND ChosenPlantId IS NOT NULL)),
        CONSTRAINT CK_PlantRecognitions_Provider CHECK (ProviderCode IN ('GEMINI', 'DEMO'))
    );
END;
GO

/* Expand only this known rarity constraint, not existing pet identities/progress. */
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id = OBJECT_ID(N'game.PetCatalog') AND name = N'CK_PetCatalog_Rarity' AND definition LIKE '%UNCOMMON%')
BEGIN
    ALTER TABLE game.PetCatalog DROP CONSTRAINT CK_PetCatalog_Rarity;
    ALTER TABLE game.PetCatalog WITH CHECK ADD CONSTRAINT CK_PetCatalog_Rarity
        CHECK (RarityCode IN ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'));
END;
/* Preserve the existing six identities and inventory; the pack uses five of them.
   Match mobile CARD_POOL: ladybug becomes Uncommon, hunter-bee remains Rare. */
UPDATE game.PetCatalog SET RarityCode = 'UNCOMMON' WHERE PetCode = 'ladybug' AND RarityCode = 'RARE';
GO

IF OBJECT_ID(N'game.GardenDailyRounds', N'U') IS NULL
BEGIN
    CREATE TABLE game.GardenDailyRounds
    (
        RoundId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_GardenDailyRounds_Id DEFAULT NEWSEQUENTIALID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        LocalDate DATE NOT NULL,
        TimeZoneId SYSNAME NOT NULL,
        CreatedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_GardenDailyRounds_Created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_GardenDailyRounds PRIMARY KEY (RoundId),
        CONSTRAINT UQ_GardenDailyRounds_UserDay UNIQUE (UserId, LocalDate),
        CONSTRAINT UQ_GardenDailyRounds_UserRound UNIQUE (UserId, RoundId),
        CONSTRAINT FK_GardenDailyRounds_User FOREIGN KEY (UserId) REFERENCES auth.Users (UserId)
    );
END;
IF OBJECT_ID(N'game.GardenDailyTargets', N'U') IS NULL
BEGIN
    CREATE TABLE game.GardenDailyTargets
    (
        UserId UNIQUEIDENTIFIER NOT NULL,
        RoundId UNIQUEIDENTIFIER NOT NULL,
        PlantId UNIQUEIDENTIFIER NOT NULL,
        InspectionPhotoId UNIQUEIDENTIFIER NULL,
        ProviderCode VARCHAR(12) NULL,
        CompletedAtUtc DATETIME2(3) NULL,
        CONSTRAINT PK_GardenDailyTargets PRIMARY KEY (RoundId, PlantId),
        CONSTRAINT FK_GardenDailyTargets_Round FOREIGN KEY (UserId, RoundId) REFERENCES game.GardenDailyRounds (UserId, RoundId),
        CONSTRAINT FK_GardenDailyTargets_Owner FOREIGN KEY (UserId, PlantId) REFERENCES plant.Plants (UserId, PlantId),
        CONSTRAINT FK_GardenDailyTargets_Photo FOREIGN KEY (PlantId, InspectionPhotoId) REFERENCES plant.PlantPhotos (PlantId, PhotoId),
        CONSTRAINT CK_GardenDailyTargets_Complete CHECK
        ((InspectionPhotoId IS NULL AND CompletedAtUtc IS NULL AND ProviderCode IS NULL)
         OR (InspectionPhotoId IS NOT NULL AND CompletedAtUtc IS NOT NULL AND ProviderCode IS NOT NULL AND ProviderCode IN ('GEMINI', 'DEMO')))
    );
END;
IF OBJECT_ID(N'game.GardenPackReceipts', N'U') IS NULL
BEGIN
    CREATE TABLE game.GardenPackReceipts
    (
        ReceiptId UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_GardenPackReceipts_Id DEFAULT NEWSEQUENTIALID(),
        UserId UNIQUEIDENTIFIER NOT NULL,
        RoundId UNIQUEIDENTIFIER NOT NULL,
        LocalDate DATE NOT NULL,
        ClientRequestId UNIQUEIDENTIFIER NOT NULL,
        PetId INT NOT NULL,
        RarityCode VARCHAR(12) NOT NULL,
        WasNewPet BIT NOT NULL,
        IsDemo BIT NOT NULL,
        RandomRoll SMALLINT NOT NULL,
        OddsVersion VARCHAR(24) NOT NULL CONSTRAINT DF_GardenPackReceipts_Odds DEFAULT ('garden-v1'),
        GrantedAtUtc DATETIME2(3) NOT NULL CONSTRAINT DF_GardenPackReceipts_Granted DEFAULT SYSUTCDATETIME(),
        RevealedAtUtc DATETIME2(3) NULL,
        CONSTRAINT PK_GardenPackReceipts PRIMARY KEY (ReceiptId),
        CONSTRAINT UQ_GardenPackReceipts_UserDay UNIQUE (UserId, LocalDate),
        CONSTRAINT UQ_GardenPackReceipts_Round UNIQUE (RoundId),
        CONSTRAINT UQ_GardenPackReceipts_Request UNIQUE (ClientRequestId),
        CONSTRAINT FK_GardenPackReceipts_Round FOREIGN KEY (UserId, RoundId) REFERENCES game.GardenDailyRounds (UserId, RoundId),
        CONSTRAINT FK_GardenPackReceipts_Pet FOREIGN KEY (PetId) REFERENCES game.PetCatalog (PetId),
        CONSTRAINT CK_GardenPackReceipts_Rarity CHECK (RarityCode IN ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY')),
        CONSTRAINT CK_GardenPackReceipts_Roll CHECK (RandomRoll BETWEEN 0 AND 9999),
        CONSTRAINT CK_GardenPackReceipts_Reveal CHECK (RevealedAtUtc IS NULL OR RevealedAtUtc >= GrantedAtUtc)
    );
END;
GO

/* Initialize a confirmed journey after usp_CreatePlant; the future API wraps
   both calls plus enrollment in one transaction. Replays never reset the phase. */
CREATE OR ALTER PROCEDURE plant.usp_StartPlantJourney
    @UserId UNIQUEIDENTIFIER, @PlantId UNIQUEIDENTIFIER, @CropCode VARCHAR(16),
    @PhaseCode VARCHAR(16), @GrowingMethodCode VARCHAR(16), @ConfirmedByUser BIT,
    @LocationNotes NVARCHAR(500) = NULL, @LightNotes NVARCHAR(500) = NULL, @StarterGuideJson NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @ConfirmedByUser <> 1 OR @ConfirmedByUser IS NULL THROW 51205, 'USER_CONFIRMATION_REQUIRED', 1;
    IF @CropCode IS NULL OR @CropCode NOT IN ('mango', 'tomato', 'chili', 'other') THROW 51216, 'INVALID_CROP', 1;
    IF @PhaseCode IS NULL OR @PhaseCode NOT IN ('planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting') THROW 51206, 'INVALID_PHASE', 1;
    IF @GrowingMethodCode IS NULL OR @GrowingMethodCode NOT IN ('seed', 'seedling') THROW 51217, 'INVALID_GROWING_METHOD', 1;
    IF @StarterGuideJson IS NOT NULL AND ISJSON(@StarterGuideJson) <> 1 THROW 51218, 'INVALID_STARTER_GUIDE', 1;
    DECLARE @Depth INT = @@TRANCOUNT;
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION StartJourneySave;
        IF NOT EXISTS (SELECT 1 FROM plant.Plants WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND PlantId = @PlantId AND DeletedAtUtc IS NULL)
            THROW 51203, 'JOURNEY_NOT_FOUND', 1;
        IF EXISTS (SELECT 1 FROM plant.PlantJourneys WHERE PlantId = @PlantId AND (CropCode <> @CropCode OR GrowingMethodCode <> @GrowingMethodCode))
            THROW 51219, 'JOURNEY_ALREADY_CONFIGURED', 1;
        IF NOT EXISTS (SELECT 1 FROM plant.PlantJourneys WHERE PlantId = @PlantId)
            INSERT plant.PlantJourneys (PlantId, CropCode, PhaseCode, GrowingMethodCode, LocationNotes, LightNotes, StarterGuideJson)
            VALUES (@PlantId, @CropCode, @PhaseCode, @GrowingMethodCode, @LocationNotes, @LightNotes, @StarterGuideJson);
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'JOURNEY_STARTED' AS ResultCode, PlantId, CropCode, PhaseCode, GrowingMethodCode FROM plant.PlantJourneys WHERE PlantId = @PlantId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION StartJourneySave;
        THROW;
    END CATCH;
END;
GO

/* New photo ingestion, including initial enrollment. No check-in/streak side effect.
   The future API creates Plants + PlantJourneys in its own transaction beforehand. */
CREATE OR ALTER PROCEDURE plant.usp_AddJourneyPhoto
    @UserId UNIQUEIDENTIFIER, @PlantId UNIQUEIDENTIFIER, @ClientRequestId UNIQUEIDENTIFIER,
    @StorageObjectKey NVARCHAR(512), @PurposeCode VARCHAR(16), @CaptureSourceCode VARCHAR(12),
    @MimeType VARCHAR(100), @PhotoId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @PurposeCode NOT IN ('ENROLLMENT', 'REFERENCE', 'INSPECTION') THROW 51201, 'INVALID_PHOTO_PURPOSE', 1;
    IF @MimeType NOT IN ('image/jpeg', 'image/png') THROW 51202, 'INVALID_PHOTO_MIME', 1;
    DECLARE @Depth INT = @@TRANCOUNT, @Phase VARCHAR(16);
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION JourneyPhotoSave;
        SELECT @Phase = j.PhaseCode FROM plant.Plants p WITH (UPDLOCK, HOLDLOCK)
        JOIN plant.PlantJourneys j ON j.PlantId = p.PlantId
        WHERE p.PlantId = @PlantId AND p.UserId = @UserId AND p.DeletedAtUtc IS NULL AND j.IsActive = 1;
        IF @Phase IS NULL THROW 51203, 'JOURNEY_NOT_FOUND', 1;
        SET @PhotoId = NULL;
        SELECT @PhotoId = PhotoId FROM plant.PlantPhotos WITH (UPDLOCK, HOLDLOCK) WHERE ClientRequestId = @ClientRequestId;
        IF @PhotoId IS NOT NULL AND NOT EXISTS
          (SELECT 1 FROM plant.PlantPhotos WHERE PhotoId = @PhotoId AND PlantId = @PlantId AND StorageObjectKey = @StorageObjectKey
           AND CaptureSourceCode = @CaptureSourceCode AND MimeType = @MimeType AND (PhotoPurposeCode = @PurposeCode OR (@PurposeCode = 'INSPECTION' AND PhotoPurposeCode = 'CHECKIN')))
            THROW 51204, 'CLIENT_REQUEST_ID_CONFLICT', 1;
        IF @PhotoId IS NULL
        BEGIN
            DECLARE @New TABLE (PhotoId UNIQUEIDENTIFIER);
            INSERT plant.PlantPhotos (PlantId, CheckInId, ClientRequestId, StorageObjectKey, CaptureSourceCode, MimeType, CountsForStreak, CapturedAtUtc, PhotoPurposeCode, JourneyPhaseCode)
            OUTPUT inserted.PhotoId INTO @New
            VALUES (@PlantId, NULL, @ClientRequestId, @StorageObjectKey, @CaptureSourceCode, @MimeType, 0, SYSUTCDATETIME(), @PurposeCode, @Phase);
            SELECT @PhotoId = PhotoId FROM @New;
            IF @PurposeCode = 'INSPECTION' INSERT plant.PlantAnalyses (PlantId, PhotoId, StatusCode) VALUES (@PlantId, @PhotoId, 'PENDING');
        END;
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'JOURNEY_PHOTO_OK' AS ResultCode, @PhotoId AS PhotoId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION JourneyPhotoSave;
        THROW;
    END CATCH;
END;
GO

/* A new phase ALWAYS needs explicit confirmation and a fresh photo already owned
   by this plant. Existing references keep their historical phase for audit. */
CREATE OR ALTER PROCEDURE plant.usp_ConfirmJourneyReference
    @UserId UNIQUEIDENTIFIER, @PlantId UNIQUEIDENTIFIER, @PhotoId UNIQUEIDENTIFIER,
    @PhaseCode VARCHAR(16), @ConfirmedByUser BIT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @ConfirmedByUser <> 1 OR @ConfirmedByUser IS NULL THROW 51205, 'USER_CONFIRMATION_REQUIRED', 1;
    IF @PhaseCode NOT IN ('planning', 'germinating', 'seedling', 'growing', 'flowering', 'fruiting') THROW 51206, 'INVALID_PHASE', 1;
    DECLARE @Depth INT = @@TRANCOUNT, @Current VARCHAR(16), @PhotoPhase VARCHAR(16), @PhotoTime DATETIME2(3),
            @PhotoPurpose VARCHAR(16), @PhotoCheckIn UNIQUEIDENTIFIER;
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION JourneyReferenceSave;
        SELECT @Current = j.PhaseCode FROM plant.Plants p WITH (UPDLOCK, HOLDLOCK)
        JOIN plant.PlantJourneys j ON j.PlantId = p.PlantId WHERE p.PlantId = @PlantId AND p.UserId = @UserId AND p.DeletedAtUtc IS NULL AND j.IsActive = 1;
        SELECT @PhotoPhase = JourneyPhaseCode, @PhotoTime = CreatedAtUtc, @PhotoPurpose = PhotoPurposeCode, @PhotoCheckIn = CheckInId
        FROM plant.PlantPhotos WITH (UPDLOCK, HOLDLOCK)
        WHERE PlantId = @PlantId AND PhotoId = @PhotoId AND DeletedAtUtc IS NULL;
        IF @Current IS NULL OR @PhotoPhase IS NULL THROW 51207, 'OWNED_REFERENCE_PHOTO_REQUIRED', 1;
        IF EXISTS (SELECT 1 FROM plant.PlantReferencePhotos WHERE PlantId = @PlantId AND PhotoId = @PhotoId AND PhaseCode <> @PhaseCode)
            THROW 51208, 'REFERENCE_ALREADY_LINKED_TO_ANOTHER_PHASE', 1;
        IF @Current <> @PhaseCode AND EXISTS (SELECT 1 FROM plant.PlantReferencePhotos WHERE PlantId = @PlantId AND PhotoId = @PhotoId)
            THROW 51209, 'NEW_PHASE_NEEDS_NEW_REFERENCE', 1;
        IF @Current <> @PhaseCode AND (@PhotoPhase <> @Current OR @PhotoTime < DATEADD(MINUTE, -30, SYSUTCDATETIME())
            OR @PhotoPurpose NOT IN ('ENROLLMENT', 'REFERENCE') OR @PhotoCheckIn IS NOT NULL)
            THROW 51209, 'NEW_PHASE_NEEDS_NEW_REFERENCE', 1;
        IF @Current = @PhaseCode AND @PhotoPhase <> @PhaseCode THROW 51224, 'REFERENCE_PHOTO_PHASE_MISMATCH', 1;
        IF @PhaseCode = 'planning' AND @Current <> @PhaseCode AND EXISTS
        (
            SELECT 1 FROM game.GardenDailyTargets t JOIN game.GardenDailyRounds r ON r.RoundId = t.RoundId
            WHERE r.UserId = @UserId AND t.PlantId = @PlantId AND t.CompletedAtUtc IS NULL
              AND r.LocalDate = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time')
        ) THROW 51220, 'INSPECT_DAILY_TARGET_BEFORE_ARCHIVING', 1;
        IF @Current <> @PhaseCode
        BEGIN
            UPDATE plant.PlantJourneys SET PhaseCode = @PhaseCode, UpdatedAtUtc = SYSUTCDATETIME() WHERE PlantId = @PlantId;
            INSERT plant.PlantCareEvents (UserId, PlantId, ClientRequestId, EventCode, Note, OccurredAtUtc)
            VALUES (@UserId, @PlantId, NEWID(), 'phase_confirmed', CONCAT(@Current, N' → ', @PhaseCode), SYSUTCDATETIME());
        END;
        IF NOT EXISTS (SELECT 1 FROM plant.PlantReferencePhotos WHERE PlantId = @PlantId AND PhotoId = @PhotoId)
        BEGIN
            UPDATE plant.PlantPhotos SET JourneyPhaseCode = @PhaseCode WHERE PhotoId = @PhotoId;
            INSERT plant.PlantReferencePhotos (PlantId, PhotoId, PhaseCode) VALUES (@PlantId, @PhotoId, @PhaseCode);
        END;
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'REFERENCE_CONFIRMED' AS ResultCode, @PlantId AS PlantId, @PhaseCode AS PhaseCode;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION JourneyReferenceSave;
        THROW;
    END CATCH;
END;
GO

/* Snapshot once per local day. All reward operations lock the same user row to
   serialize parallel requests. Targets do not shrink when plants are archived. */
CREATE OR ALTER PROCEDURE game.usp_StartGardenDay
    @UserId UNIQUEIDENTIFIER, @RoundId UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @Depth INT = @@TRANCOUNT, @TimeZone SYSNAME, @Today DATE, @Found UNIQUEIDENTIFIER;
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION GardenDaySave;
        SELECT @Found = UserId FROM auth.Users WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND IsActive = 1 AND DeletedAtUtc IS NULL;
        IF @Found IS NULL THROW 51210, 'USER_NOT_FOUND', 1;
        /* Match mobile's fixed UTC+7 reward day; changing reminder time zone
           must not move the reward boundary or create another daily pack. */
        SET @TimeZone = N'SE Asia Standard Time';
        SET @Today = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE @TimeZone);
        SET @RoundId = NULL;
        SELECT @RoundId = RoundId FROM game.GardenDailyRounds WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND LocalDate = @Today;
        IF @RoundId IS NULL AND EXISTS
        (
            SELECT 1 FROM plant.Plants p JOIN plant.PlantJourneys j ON j.PlantId = p.PlantId
            WHERE p.UserId = @UserId AND p.DeletedAtUtc IS NULL AND j.IsActive = 1 AND j.PhaseCode <> 'planning'
        )
        BEGIN
            DECLARE @New TABLE (RoundId UNIQUEIDENTIFIER);
            INSERT game.GardenDailyRounds (UserId, LocalDate, TimeZoneId) OUTPUT inserted.RoundId INTO @New VALUES (@UserId, @Today, @TimeZone);
            SELECT @RoundId = RoundId FROM @New;
            INSERT game.GardenDailyTargets (UserId, RoundId, PlantId)
            SELECT @UserId, @RoundId, p.PlantId FROM plant.Plants p JOIN plant.PlantJourneys j ON j.PlantId = p.PlantId
            WHERE p.UserId = @UserId AND p.DeletedAtUtc IS NULL AND j.IsActive = 1 AND j.PhaseCode <> 'planning';
        END;
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'GARDEN_DAY_OK' AS ResultCode, @RoundId AS RoundId, @Today AS LocalDate;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION GardenDaySave;
        THROW;
    END CATCH;
END;
GO

/* RawResultJson is the AUTHORITATIVE full structured AI result, including every
   question/limitation/action. Summary (1000) and ActionText (500) are explicitly
   compatibility PREVIEWS, never the source for displaying safety/care guidance.
   Existing old procedure parameters would silently truncate long text, so the
   new API must call this procedure and read vw_JourneyInspectionResults instead.
   @ProviderCode comes from the server adapter, not untrusted client JSON. */
CREATE OR ALTER PROCEDURE plant.usp_CompleteJourneyAnalysis
    @UserId UNIQUEIDENTIFIER, @PhotoId UNIQUEIDENTIFIER, @ResultJson NVARCHAR(MAX),
    @ProviderCode VARCHAR(12), @ModelName NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @ProviderCode IS NULL OR @ProviderCode NOT IN ('GEMINI', 'DEMO') THROW 51215, 'INVALID_ANALYSIS_PROVIDER', 1;
    IF @ResultJson IS NULL OR ISJSON(@ResultJson) <> 1 OR LEN(@ResultJson) > 128000 THROW 51225, 'INVALID_FULL_ANALYSIS_JSON', 1;
    DECLARE @AnalysisJson NVARCHAR(MAX), @ActionsJson NVARCHAR(MAX), @QuestionsJson NVARCHAR(MAX), @LimitsJson NVARCHAR(MAX),
        @Level NVARCHAR(20), @Title NVARCHAR(MAX), @Summary NVARCHAR(MAX), @LevelCode VARCHAR(16),
        @AnalysisId UNIQUEIDENTIFIER, @PlantId UNIQUEIDENTIFIER, @Depth INT = @@TRANCOUNT;
    SELECT @AnalysisJson = analysis, @QuestionsJson = COALESCE(questions, N'[]'), @LimitsJson = COALESCE(limitations, N'[]')
    FROM OPENJSON(@ResultJson) WITH (analysis NVARCHAR(MAX) '$.analysis' AS JSON, questions NVARCHAR(MAX) '$.questions' AS JSON, limitations NVARCHAR(MAX) '$.limitations' AS JSON);
    IF @AnalysisJson IS NULL THROW 51225, 'INVALID_FULL_ANALYSIS_JSON', 1;
    SELECT @Level = level, @Title = title, @Summary = summary, @ActionsJson = actions FROM OPENJSON(@AnalysisJson)
    WITH (level NVARCHAR(20) '$.level', title NVARCHAR(MAX) '$.title', summary NVARCHAR(MAX) '$.summary', actions NVARCHAR(MAX) '$.actions' AS JSON);
    SET @LevelCode = CASE @Level WHEN N'Tốt' THEN 'GOOD' WHEN N'Chú ý' THEN 'ATTENTION' WHEN N'Cảnh báo' THEN 'WARNING' END;
    IF @LevelCode IS NULL OR @Title IS NULL OR LEN(LTRIM(RTRIM(@Title))) NOT BETWEEN 1 AND 200
        OR @Summary IS NULL OR LEN(LTRIM(RTRIM(@Summary))) NOT BETWEEN 1 AND 32000
        OR @ActionsJson IS NULL OR LEFT(LTRIM(@ActionsJson), 1) <> '['
        OR LEFT(LTRIM(@QuestionsJson), 1) <> '[' OR LEFT(LTRIM(@LimitsJson), 1) <> '['
        THROW 51225, 'INVALID_FULL_ANALYSIS_JSON', 1;
    IF (SELECT COUNT(*) FROM OPENJSON(@ActionsJson)) > 8 OR (SELECT COUNT(*) FROM OPENJSON(@QuestionsJson)) > 8 OR (SELECT COUNT(*) FROM OPENJSON(@LimitsJson)) > 8
        OR EXISTS (SELECT 1 FROM (SELECT value, type FROM OPENJSON(@ActionsJson) UNION ALL SELECT value, type FROM OPENJSON(@QuestionsJson)
            UNION ALL SELECT value, type FROM OPENJSON(@LimitsJson)) x WHERE type <> 1 OR LEN(LTRIM(RTRIM(value))) NOT BETWEEN 1 AND 1500)
        THROW 51225, 'INVALID_FULL_ANALYSIS_JSON', 1;
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION CompleteJourneyAnalysisSave;
        SELECT @AnalysisId = a.AnalysisId, @PlantId = a.PlantId FROM plant.Plants p WITH (UPDLOCK, HOLDLOCK)
        JOIN plant.PlantJourneys j ON j.PlantId = p.PlantId JOIN plant.PlantPhotos ph ON ph.PlantId = p.PlantId
        JOIN plant.PlantAnalyses a WITH (UPDLOCK, HOLDLOCK) ON a.PlantId = ph.PlantId AND a.PhotoId = ph.PhotoId
        WHERE p.UserId = @UserId AND ph.PhotoId = @PhotoId AND p.DeletedAtUtc IS NULL AND j.IsActive = 1
            AND ph.DeletedAtUtc IS NULL AND ph.PhotoPurposeCode IN ('INSPECTION', 'CHECKIN') AND ph.JourneyPhaseCode = j.PhaseCode;
        IF @AnalysisId IS NULL THROW 51226, 'ACTIVE_INSPECTION_PHOTO_REQUIRED', 1;
        UPDATE plant.PlantAnalyses SET StatusCode = 'COMPLETED', LevelCode = @LevelCode, Title = @Title,
            Summary = LEFT(@Summary, 1000), Confidence = NULL, RawResultJson = @ResultJson, ProviderCode = @ProviderCode,
            ModelName = @ModelName, FailureCode = NULL, CompletedAtUtc = SYSUTCDATETIME() WHERE AnalysisId = @AnalysisId;
        DELETE plant.PlantAnalysisActions WHERE AnalysisId = @AnalysisId;
        INSERT plant.PlantAnalysisActions (AnalysisId, SortOrder, ActionText)
        SELECT @AnalysisId, CONVERT(TINYINT, [key]) + 1, LEFT(value, 500) FROM OPENJSON(@ActionsJson);
        UPDATE plant.Plants SET HealthStatus = CASE WHEN @ProviderCode = 'DEMO' THEN N'Chưa đánh giá bằng AI'
            WHEN @LevelCode = 'GOOD' THEN N'Đã kiểm tra' ELSE N'Cần theo dõi' END,
            MoodText = LEFT(@Title, 160), UpdatedAtUtc = SYSUTCDATETIME() WHERE PlantId = @PlantId
            AND @PhotoId = (SELECT TOP (1) ph.PhotoId FROM plant.PlantPhotos ph JOIN plant.PlantAnalyses a ON a.PhotoId = ph.PhotoId
                WHERE ph.PlantId = @PlantId AND ph.DeletedAtUtc IS NULL AND a.StatusCode = 'COMPLETED' ORDER BY ph.CreatedAtUtc DESC, ph.PhotoId DESC);
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'JOURNEY_ANALYSIS_COMPLETED' AS ResultCode, @AnalysisId AS AnalysisId, @PhotoId AS PhotoId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION CompleteJourneyAnalysisSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER VIEW plant.vw_JourneyInspectionResults
AS
    SELECT p.UserId, ph.PlantId, ph.PhotoId, ph.JourneyPhaseCode, ph.PhotoPurposeCode,
        a.AnalysisId, a.ProviderCode, a.RawResultJson AS FullResultJson,
        a.Summary AS SummaryPreview, a.StatusCode, a.CreatedAtUtc, a.CompletedAtUtc
    FROM plant.PlantPhotos ph JOIN plant.PlantAnalyses a ON a.PhotoId = ph.PhotoId AND a.PlantId = ph.PlantId
    JOIN plant.Plants p ON p.PlantId = ph.PlantId
    WHERE ph.JourneyPhaseCode IS NOT NULL AND ph.DeletedAtUtc IS NULL;
GO

/* Credit only a confirmed, analyzed inspection captured today in the current phase.
   Physical watering is NOT proven by a picture. No daily watering requirement. */
CREATE OR ALTER PROCEDURE plant.usp_RecordJourneyInspection
    @UserId UNIQUEIDENTIFIER, @PlantId UNIQUEIDENTIFIER, @PhotoId UNIQUEIDENTIFIER, @ConfirmedByUser BIT
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    IF @ConfirmedByUser <> 1 OR @ConfirmedByUser IS NULL THROW 51205, 'USER_CONFIRMATION_REQUIRED', 1;
    DECLARE @Depth INT = @@TRANCOUNT, @RoundId UNIQUEIDENTIFIER, @Today DATE, @TimeZone SYSNAME, @CheckInId UNIQUEIDENTIFIER,
            @Now DATETIME2(3) = SYSUTCDATETIME(), @Last DATE, @Current INT, @Best INT, @Phase VARCHAR(16), @ProviderCode VARCHAR(12);
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION JourneyInspectionSave;
        EXEC game.usp_StartGardenDay @UserId, @RoundId OUTPUT;
        SELECT @Today = LocalDate, @TimeZone = TimeZoneId FROM game.GardenDailyRounds WHERE RoundId = @RoundId;
        SELECT @Last = p.LastCheckInLocalDate, @Current = p.CurrentStreak, @Best = p.BestStreak, @Phase = j.PhaseCode
        FROM plant.Plants p WITH (UPDLOCK, HOLDLOCK) JOIN plant.PlantJourneys j ON j.PlantId = p.PlantId
        WHERE p.PlantId = @PlantId AND p.UserId = @UserId AND p.DeletedAtUtc IS NULL AND j.IsActive = 1;
        IF @Phase IS NULL THROW 51203, 'JOURNEY_NOT_FOUND', 1;
        IF @Phase = 'planning' THROW 51221, 'START_GROWING_BEFORE_DAILY_INSPECTION', 1;
        /* Provider is read from the persisted trusted analysis, not supplied by client. */
        SELECT @ProviderCode = a.ProviderCode FROM plant.PlantPhotos ph JOIN plant.PlantAnalyses a ON a.PhotoId = ph.PhotoId AND a.PlantId = ph.PlantId
            WHERE ph.PhotoId = @PhotoId AND ph.PlantId = @PlantId AND ph.DeletedAtUtc IS NULL
              AND ph.PhotoPurposeCode IN ('INSPECTION', 'CHECKIN') AND ph.JourneyPhaseCode = @Phase
              AND CONVERT(DATE, ph.CapturedAtUtc AT TIME ZONE 'UTC' AT TIME ZONE @TimeZone) = @Today AND a.StatusCode = 'COMPLETED'
              AND a.ProviderCode IN ('GEMINI', 'DEMO') AND a.RawResultJson IS NOT NULL;
        IF @ProviderCode IS NULL THROW 51211, 'VALID_ANALYZED_INSPECTION_REQUIRED', 1;
        SELECT @CheckInId = CheckInId FROM plant.PlantCheckIns WITH (UPDLOCK, HOLDLOCK) WHERE PlantId = @PlantId AND CheckInLocalDate = @Today;
        IF @CheckInId IS NULL
        BEGIN
            DECLARE @New TABLE (Id UNIQUEIDENTIFIER);
            INSERT plant.PlantCheckIns (PlantId, CheckInLocalDate) OUTPUT inserted.CheckInId INTO @New VALUES (@PlantId, @Today);
            SELECT @CheckInId = Id FROM @New;
            SET @Current = CASE WHEN @Last = DATEADD(DAY, -1, @Today) THEN @Current + 1 ELSE 1 END;
            SET @Best = CASE WHEN @Current > @Best THEN @Current ELSE @Best END;
            UPDATE plant.Plants SET CurrentStreak = @Current, BestStreak = @Best, LastCheckInLocalDate = @Today, UpdatedAtUtc = @Now WHERE PlantId = @PlantId;
            UPDATE plant.PlantPhotos SET PhotoPurposeCode = 'CHECKIN', CheckInId = @CheckInId, CountsForStreak = 1 WHERE PhotoId = @PhotoId;
        END
        ELSE IF EXISTS (SELECT 1 FROM plant.PlantPhotos WHERE PhotoId = @PhotoId AND CheckInId IS NULL)
            UPDATE plant.PlantPhotos SET PhotoPurposeCode = 'CHECKIN', CheckInId = @CheckInId, CountsForStreak = 0 WHERE PhotoId = @PhotoId;
        UPDATE game.GardenDailyTargets SET InspectionPhotoId = @PhotoId, ProviderCode = @ProviderCode, CompletedAtUtc = @Now
        WHERE RoundId = @RoundId AND PlantId = @PlantId AND CompletedAtUtc IS NULL;
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'JOURNEY_INSPECTION_OK' AS ResultCode, @CheckInId AS CheckInId, @RoundId AS RoundId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION JourneyInspectionSave;
        THROW;
    END CATCH;
END;
GO

/* Persist the draw + inventory change BEFORE any reveal animation. A retry with a
   new request ID still returns the same daily receipt. No client-selected PetId.
   Version garden-v1: Common60%, Uncommon25%, Rare10%, Epic4%, Legendary1%. */
CREATE OR ALTER PROCEDURE game.usp_OpenGardenPack
    @UserId UNIQUEIDENTIFIER, @ClientRequestId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @Depth INT = @@TRANCOUNT, @RoundId UNIQUEIDENTIFIER, @Today DATE, @ReceiptId UNIQUEIDENTIFIER,
            @PetId INT, @Roll INT, @NewPet BIT, @PetCode VARCHAR(50), @Rarity VARCHAR(12), @IsDemo BIT, @ReplayOwner UNIQUEIDENTIFIER;
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION GardenPackSave;
        SELECT @ReplayOwner = UserId FROM auth.Users WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND IsActive = 1 AND DeletedAtUtc IS NULL;
        IF @ReplayOwner IS NULL THROW 51210, 'USER_NOT_FOUND', 1;
        SET @ReplayOwner = NULL;
        /* A retry of yesterday's receipt must not freeze today's target snapshot. */
        SELECT @ReceiptId = ReceiptId, @ReplayOwner = UserId FROM game.GardenPackReceipts WITH (UPDLOCK, HOLDLOCK) WHERE ClientRequestId = @ClientRequestId;
        IF @ReplayOwner IS NOT NULL AND @ReplayOwner <> @UserId THROW 51204, 'CLIENT_REQUEST_ID_CONFLICT', 1;
        IF @ReceiptId IS NULL
        BEGIN
            SET @Today = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time');
            SELECT @ReceiptId = ReceiptId FROM game.GardenPackReceipts WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND LocalDate = @Today;
        END;
        IF @ReceiptId IS NULL
        BEGIN
            /* Migration safety: legacy hunt dates used the user's old time zone.
               CompletedAtUtc is authoritative for the new fixed UTC+7 boundary.
               Both CAPTURED and NO_RESULT consumed the old one-hunt daily quota. */
            IF EXISTS (SELECT 1 FROM game.ArHunts WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId
                AND CONVERT(DATE, CompletedAtUtc AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time') = @Today)
                THROW 51223, 'DAILY_REWARD_ALREADY_USED_BY_LEGACY_HUNT', 1;
            EXEC game.usp_StartGardenDay @UserId, @RoundId OUTPUT;
            IF NOT EXISTS (SELECT 1 FROM game.GardenDailyTargets WHERE RoundId = @RoundId)
                OR EXISTS (SELECT 1 FROM game.GardenDailyTargets WHERE RoundId = @RoundId AND CompletedAtUtc IS NULL)
                THROW 51212, 'CHECK_ALL_GARDEN_PLANTS_FIRST', 1;
            /* Rejection sampling prevents modulo bias and avoids ABS(INT_MIN). */
            SET @Roll = CONVERT(INT, CRYPT_GEN_RANDOM(4)) & 2147483647;
            WHILE @Roll >= 2147480000 SET @Roll = CONVERT(INT, CRYPT_GEN_RANDOM(4)) & 2147483647;
            SET @Roll = @Roll % 10000;
            SET @PetCode = CASE WHEN @Roll < 6000 THEN 'caterpillar' WHEN @Roll < 8500 THEN 'ladybug'
                WHEN @Roll < 9500 THEN 'hunter-bee' WHEN @Roll < 9900 THEN 'moon-moth' ELSE 'mantis' END;
            SELECT @PetId = PetId, @Rarity = RarityCode FROM game.PetCatalog WHERE PetCode = @PetCode AND IsActive = 1;
            IF @PetId IS NULL THROW 51213, 'PACK_CATALOG_MISSING', 1;
            SET @IsDemo = CASE WHEN EXISTS (SELECT 1 FROM game.GardenDailyTargets WHERE RoundId = @RoundId AND ProviderCode = 'DEMO') THEN 1 ELSE 0 END;
            SET @NewPet = CASE WHEN EXISTS (SELECT 1 FROM game.UserPets WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND PetId = @PetId) THEN 0 ELSE 1 END;
            IF @NewPet = 1 INSERT game.UserPets (UserId, PetId, Quantity, LevelNumber, TotalExperience, IsCompanion) VALUES (@UserId, @PetId, 1, 1, 0, 0);
            ELSE UPDATE game.UserPets SET Quantity = Quantity + 1, UpdatedAtUtc = SYSUTCDATETIME() WHERE UserId = @UserId AND PetId = @PetId;
            DECLARE @New TABLE (Id UNIQUEIDENTIFIER);
            INSERT game.GardenPackReceipts (UserId, RoundId, LocalDate, ClientRequestId, PetId, RarityCode, WasNewPet, IsDemo, RandomRoll)
            OUTPUT inserted.ReceiptId INTO @New VALUES (@UserId, @RoundId, @Today, @ClientRequestId, @PetId, @Rarity, @NewPet, @IsDemo, @Roll);
            SELECT @ReceiptId = Id FROM @New;
        END;
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'GARDEN_PACK_OK' AS ResultCode, ReceiptId, RoundId, LocalDate, PetId, RarityCode, WasNewPet, IsDemo, OddsVersion, GrantedAtUtc, RevealedAtUtc
        FROM game.GardenPackReceipts WHERE ReceiptId = @ReceiptId AND UserId = @UserId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION GardenPackSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE game.usp_RevealGardenPack
    @UserId UNIQUEIDENTIFIER, @ReceiptId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE game.GardenPackReceipts SET RevealedAtUtc = COALESCE(RevealedAtUtc, SYSUTCDATETIME())
    WHERE UserId = @UserId AND ReceiptId = @ReceiptId;
    IF @@ROWCOUNT = 0 THROW 51214, 'PACK_NOT_FOUND', 1;
    SELECT 'GARDEN_PACK_REVEALED' AS ResultCode, ReceiptId, PetId, RevealedAtUtc FROM game.GardenPackReceipts WHERE UserId = @UserId AND ReceiptId = @ReceiptId;
END;
GO

CREATE OR ALTER PROCEDURE plant.usp_ArchivePlantJourney
    @UserId UNIQUEIDENTIFIER, @PlantId UNIQUEIDENTIFIER
AS
BEGIN
    SET NOCOUNT ON; SET XACT_ABORT ON;
    DECLARE @Depth INT = @@TRANCOUNT, @Today DATE = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time');
    BEGIN TRY
        IF @Depth = 0 BEGIN TRANSACTION; ELSE SAVE TRANSACTION ArchiveJourneySave;
        IF NOT EXISTS (SELECT 1 FROM auth.Users WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND IsActive = 1 AND DeletedAtUtc IS NULL)
            THROW 51210, 'USER_NOT_FOUND', 1;
        IF NOT EXISTS (SELECT 1 FROM plant.Plants WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND PlantId = @PlantId)
            THROW 51203, 'JOURNEY_NOT_FOUND', 1;
        IF EXISTS (SELECT 1 FROM game.GardenDailyTargets t JOIN game.GardenDailyRounds r ON r.RoundId = t.RoundId
            WHERE r.UserId = @UserId AND r.LocalDate = @Today AND t.PlantId = @PlantId AND t.CompletedAtUtc IS NULL)
            THROW 51220, 'INSPECT_DAILY_TARGET_BEFORE_ARCHIVING', 1;
        UPDATE plant.PlantJourneys SET IsActive = 0, UpdatedAtUtc = SYSUTCDATETIME() WHERE PlantId = @PlantId;
        UPDATE plant.Plants SET DeletedAtUtc = COALESCE(DeletedAtUtc, SYSUTCDATETIME()), UpdatedAtUtc = SYSUTCDATETIME() WHERE PlantId = @PlantId;
        IF @Depth = 0 COMMIT TRANSACTION;
        SELECT 'JOURNEY_ARCHIVED' AS ResultCode, @PlantId AS PlantId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @Depth = 0 ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1 ROLLBACK TRANSACTION ArchiveJourneySave;
        THROW;
    END CATCH;
END;
GO

/* The new trusted API must not use old client-selected AR prizes/check-in ingestion.
   No direct table grants are added. Existing owners retain their data and access. */
DENY EXECUTE ON OBJECT::game.usp_RecordArHunt TO pat_api_executor;
DENY EXECUTE ON OBJECT::plant.usp_CreatePlantCheckIn TO pat_api_executor;
DENY EXECUTE ON OBJECT::plant.usp_SoftDeletePlant TO pat_api_executor;
DENY EXECUTE ON OBJECT::plant.usp_CompletePlantAnalysis TO pat_api_executor;
GRANT SELECT ON OBJECT::plant.vw_JourneyInspectionResults TO pat_api_executor;
GO
