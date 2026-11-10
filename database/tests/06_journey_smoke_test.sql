/*
 * Kiểm thử SQL hành trình thủ công sau 01, 02 và 05; tự tạo tài khoản giả trong giao dịch rồi hoàn tác.
 * Chỉ chạy thủ công, không gọi Gemini hay sửa người dùng thật; không kiểm chứng đồng bộ điện thoại/API.
 */
USE [PAT];
GO
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @UserId UNIQUEIDENTIFIER, @Nonce UNIQUEIDENTIFIER = NEWID(),
        @Plant1 UNIQUEIDENTIFIER, @Plant2 UNIQUEIDENTIFIER, @Plant3 UNIQUEIDENTIFIER,
        @Request1 UNIQUEIDENTIFIER = NEWID(), @Request2 UNIQUEIDENTIFIER = NEWID(), @Request3 UNIQUEIDENTIFIER = NEWID(),
        @Photo UNIQUEIDENTIFIER, @EnrollmentPhoto UNIQUEIDENTIFIER, @RoundId UNIQUEIDENTIFIER, @ReplayRound UNIQUEIDENTIFIER,
        @PackRequest UNIQUEIDENTIFIER = NEWID(), @ReplayPackRequest UNIQUEIDENTIFIER = NEWID(),
        @ReceiptId UNIQUEIDENTIFIER, @OriginalPet INT, @OriginalQuantity INT, @Key NVARCHAR(512),
        @Today DATE = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time');
    DECLARE @Email NVARCHAR(320) = N'journey-smoke-' + CONVERT(NVARCHAR(36), @Nonce) + N'@pat.invalid';

    EXEC auth.usp_RegisterLocalUser @Email = @Email, @PasswordHash = N'synthetic-never-used-for-login',
        @PasswordHashVersion = 1, @DisplayName = N'Journey smoke', @TimeZoneId = N'SE Asia Standard Time', @UserId = @UserId OUTPUT;
    EXEC game.usp_StartGardenDay @UserId, @RoundId OUTPUT;
    IF @RoundId IS NOT NULL THROW 51311, 'EMPTY_GARDEN_MUST_NOT_FREEZE_DAILY_ROUND', 1;
    EXEC plant.usp_CreatePlant @UserId, @Request1, N'Cà chua test', N'Solanum lycopersicum', @Today;
    EXEC plant.usp_CreatePlant @UserId, @Request2, N'Ớt test', N'Capsicum annuum', @Today;
    SELECT @Plant1 = PlantId FROM plant.Plants WHERE CreateClientRequestId = @Request1;
    SELECT @Plant2 = PlantId FROM plant.Plants WHERE CreateClientRequestId = @Request2;
    EXEC plant.usp_StartPlantJourney @UserId, @Plant1, 'tomato', 'seedling', 'seedling', 1;
    EXEC plant.usp_StartPlantJourney @UserId, @Plant2, 'chili', 'seedling', 'seedling', 1;

    SET @Key = N'journey-smoke/' + CONVERT(NVARCHAR(36), @Nonce) + N'/enroll.jpg';
    DECLARE @PhotoRequest UNIQUEIDENTIFIER = NEWID();
    EXEC plant.usp_AddJourneyPhoto @UserId, @Plant1, @PhotoRequest, @Key, 'ENROLLMENT', 'CAMERA', 'image/jpeg', @EnrollmentPhoto OUTPUT;
    EXEC plant.usp_AddJourneyPhoto @UserId, @Plant1, @PhotoRequest, @Key, 'ENROLLMENT', 'CAMERA', 'image/jpeg', @Photo OUTPUT;
    IF @Photo <> @EnrollmentPhoto THROW 51300, 'PHOTO_REPLAY_NOT_IDEMPOTENT', 1;
    EXEC plant.usp_ConfirmJourneyReference @UserId, @Plant1, @EnrollmentPhoto, 'seedling', 1;
    IF EXISTS (SELECT 1 FROM plant.PlantCheckIns WHERE PlantId IN (@Plant1, @Plant2))
        OR EXISTS (SELECT 1 FROM plant.Plants WHERE PlantId IN (@Plant1, @Plant2) AND CurrentStreak <> 0)
        THROW 51301, 'ENROLLMENT_MUST_NOT_CREDIT_STREAK', 1;

    SET @PhotoRequest = NEWID();
    SET @Key = N'journey-smoke/' + CONVERT(NVARCHAR(36), @Nonce) + N'/growing-reference.jpg';
    EXEC plant.usp_AddJourneyPhoto @UserId, @Plant1, @PhotoRequest, @Key, 'REFERENCE', 'CAMERA', 'image/jpeg', @Photo OUTPUT;
    EXEC plant.usp_ConfirmJourneyReference @UserId, @Plant1, @Photo, 'growing', 1;
    EXEC plant.usp_ConfirmJourneyReference @UserId, @Plant1, @Photo, 'growing', 1;
    IF (SELECT PhaseCode FROM plant.PlantJourneys WHERE PlantId = @Plant1) <> 'growing'
        OR (SELECT PhaseCode FROM plant.PlantReferencePhotos WHERE PhotoId = @EnrollmentPhoto) <> 'seedling'
        OR (SELECT COUNT(*) FROM plant.PlantCareEvents WHERE PlantId = @Plant1 AND EventCode = 'phase_confirmed') <> 1
        THROW 51302, 'CONFIRMED_PHASE_HISTORY_BROKEN', 1;

    EXEC game.usp_StartGardenDay @UserId, @RoundId OUTPUT;
    IF (SELECT COUNT(*) FROM game.GardenDailyTargets WHERE RoundId = @RoundId) <> 2
        THROW 51303, 'DAY_SNAPSHOT_MISSING_PLANTS', 1;
    EXEC plant.usp_CreatePlant @UserId, @Request3, N'Xoài thêm sau', N'Mangifera indica', @Today;
    SELECT @Plant3 = PlantId FROM plant.Plants WHERE CreateClientRequestId = @Request3;
    EXEC plant.usp_StartPlantJourney @UserId, @Plant3, 'mango', 'seedling', 'seedling', 1;
    EXEC game.usp_StartGardenDay @UserId, @ReplayRound OUTPUT;
    IF @ReplayRound <> @RoundId OR (SELECT COUNT(*) FROM game.GardenDailyTargets WHERE RoundId = @RoundId) <> 2
        THROW 51304, 'DAY_SNAPSHOT_CHANGED_AFTER_ENROLLMENT', 1;

    /* Synthetic COMPLETED results, not a claim these photos were analyzed by AI. */
    DECLARE @CurrentPlant UNIQUEIDENTIFIER, @Index INT = 1, @FullAnalysis NVARCHAR(MAX),
        @LongSafetyNote NVARCHAR(MAX) = REPLICATE(CONVERT(NVARCHAR(MAX), N'Safety caveat. '), 90), @FullChat NVARCHAR(MAX);
    WHILE @Index <= 2
    BEGIN
        SET @CurrentPlant = CASE WHEN @Index = 1 THEN @Plant1 ELSE @Plant2 END;
        SET @PhotoRequest = NEWID();
        SET @Key = N'journey-smoke/' + CONVERT(NVARCHAR(36), @Nonce) + N'/inspect-' + CONVERT(NVARCHAR(10), @Index) + N'.jpg';
        EXEC plant.usp_AddJourneyPhoto @UserId, @CurrentPlant, @PhotoRequest, @Key, 'INSPECTION', 'CAMERA', 'image/jpeg', @Photo OUTPUT;
        SET @FullAnalysis = N'{"analysis":{"level":"Chú ý","title":"Synthetic smoke result","summary":"Not a real diagnosis.","actions":['
            + N'"' + STRING_ESCAPE(@LongSafetyNote, 'json') + N'"]},"questions":[],"limitations":["'
            + STRING_ESCAPE(@LongSafetyNote, 'json') + N'"]}';
        EXEC plant.usp_CompleteJourneyAnalysis @UserId, @Photo, @FullAnalysis, 'DEMO', N'synthetic-no-model-call';
        IF NOT EXISTS (SELECT 1 FROM plant.vw_JourneyInspectionResults WHERE PhotoId = @Photo AND FullResultJson = @FullAnalysis)
            THROW 51314, 'FULL_SAFETY_CAVEATS_MUST_NOT_BE_TRUNCATED', 1;
        EXEC plant.usp_RecordJourneyInspection @UserId, @CurrentPlant, @Photo, 1;
        EXEC plant.usp_RecordJourneyInspection @UserId, @CurrentPlant, @Photo, 1;
        SET @Index += 1;
    END;
    IF (SELECT COUNT(*) FROM game.GardenDailyTargets WHERE RoundId = @RoundId AND CompletedAtUtc IS NOT NULL) <> 2
        OR EXISTS (SELECT 1 FROM plant.Plants WHERE PlantId IN (@Plant1, @Plant2) AND CurrentStreak <> 1)
        OR (SELECT COUNT(*) FROM plant.PlantCheckIns WHERE PlantId IN (@Plant1, @Plant2)) <> 2
        THROW 51305, 'INSPECTION_REPLAY_DOUBLE_CREDITED', 1;
    IF EXISTS (SELECT 1 FROM plant.Plants WHERE PlantId IN (@Plant1, @Plant2) AND HealthStatus <> N'Chưa đánh giá bằng AI')
        THROW 51317, 'DEMO_MUST_NOT_CLAIM_AI_HEALTH_ASSESSMENT', 1;
    EXEC plant.usp_ArchivePlantJourney @UserId, @Plant2;
    IF (SELECT COUNT(*) FROM game.GardenDailyTargets WHERE RoundId = @RoundId) <> 2
        THROW 51309, 'ARCHIVING_MUST_NOT_SHRINK_SNAPSHOT', 1;

    EXEC game.usp_OpenGardenPack @UserId, @PackRequest;
    SELECT @ReceiptId = ReceiptId, @OriginalPet = PetId FROM game.GardenPackReceipts WHERE UserId = @UserId AND LocalDate = @Today;
    SELECT @OriginalQuantity = Quantity FROM game.UserPets WHERE UserId = @UserId AND PetId = @OriginalPet;
    EXEC game.usp_OpenGardenPack @UserId, @PackRequest;
    EXEC game.usp_OpenGardenPack @UserId, @ReplayPackRequest;
    IF (SELECT COUNT(*) FROM game.GardenPackReceipts WHERE UserId = @UserId) <> 1
        OR NOT EXISTS (SELECT 1 FROM game.GardenPackReceipts WHERE ReceiptId = @ReceiptId AND PetId = @OriginalPet AND RandomRoll BETWEEN 0 AND 9999)
        OR (SELECT Quantity FROM game.UserPets WHERE UserId = @UserId AND PetId = @OriginalPet) <> @OriginalQuantity
        THROW 51306, 'PACK_REPLAY_REROLLED_OR_DOUBLE_GRANTED', 1;
    IF EXISTS (SELECT 1 FROM game.GardenPackReceipts WHERE ReceiptId = @ReceiptId AND RevealedAtUtc IS NOT NULL)
        THROW 51307, 'GRANT_MUST_BE_PERSISTED_BEFORE_REVEAL', 1;
    IF NOT EXISTS (SELECT 1 FROM game.GardenPackReceipts WHERE ReceiptId = @ReceiptId AND IsDemo = 1)
        THROW 51310, 'DEMO_INSPECTION_MUST_MARK_DEMO_PACK', 1;
    EXEC game.usp_RevealGardenPack @UserId, @ReceiptId;
    EXEC game.usp_RevealGardenPack @UserId, @ReceiptId;
    IF NOT EXISTS (SELECT 1 FROM game.GardenPackReceipts WHERE ReceiptId = @ReceiptId AND RevealedAtUtc IS NOT NULL)
        THROW 51308, 'PACK_REVEAL_NOT_SAVED', 1;

    SET @FullChat = REPLICATE(CONVERT(NVARCHAR(MAX), N'Full guidance and caveats. '), 400);
    INSERT plant.PlantChatMessages (UserId, PlantId, ClientRequestId, RoleCode, ProviderCode, Content)
    VALUES (@UserId, @Plant1, NEWID(), 'ASSISTANT', 'DEMO', @FullChat);
    IF NOT EXISTS (SELECT 1 FROM plant.PlantChatMessages WHERE PlantId = @Plant1 AND Content = @FullChat)
        THROW 51315, 'FULL_CHAT_CAVEATS_MUST_NOT_BE_TRUNCATED', 1;

    /* Expected rejection is last: THROW with XACT_ABORT may doom the fixture
       transaction. Only read-only assertions and ROLLBACK follow it. */
    DECLARE @InspectionProbe UNIQUEIDENTIFIER, @PhaseGuardRejected BIT = 0;
    SELECT @InspectionProbe = PhotoId FROM plant.PlantPhotos WHERE PlantId = @Plant1 AND PhotoPurposeCode = 'CHECKIN';
    BEGIN TRY
        EXEC plant.usp_ConfirmJourneyReference @UserId, @Plant1, @InspectionProbe, 'flowering', 1;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() <> 51209 THROW;
        SET @PhaseGuardRejected = 1;
    END CATCH;
    IF @PhaseGuardRejected <> 1 OR (SELECT PhaseCode FROM plant.PlantJourneys WHERE PlantId = @Plant1) <> 'growing'
        OR (SELECT JourneyPhaseCode FROM plant.PlantPhotos WHERE PhotoId = @InspectionProbe) <> 'growing'
        THROW 51316, 'PHASE_CHANGE_MUST_NOT_RELABEL_INSPECTION_HISTORY', 1;

    ROLLBACK TRANSACTION;
    SELECT 'JOURNEY_CORE_SMOKE_OK_ROLLED_BACK' AS ResultCode;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

/* Separate fixture because the expected phase rejection above may doom its
   transaction. Test migration quota using a deliberately DIFFERENT old local
   date: UTC completion time, not HuntLocalDate, must govern the new UTC+7 day. */
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @LegacyUser UNIQUEIDENTIFIER, @LegacyPlant UNIQUEIDENTIFIER, @LegacyRound UNIQUEIDENTIFIER,
        @LegacyNonce UNIQUEIDENTIFIER = NEWID(), @LegacyCreate UNIQUEIDENTIFIER = NEWID(), @LegacyPhoto UNIQUEIDENTIFIER,
        @LegacyPhotoRequest UNIQUEIDENTIFIER = NEWID(), @LegacyPackRequest UNIQUEIDENTIFIER = NEWID(), @LegacyBlocked BIT = 0,
        @LegacyPet INT = (SELECT PetId FROM game.PetCatalog WHERE PetCode = 'caterpillar'),
        @LegacyToday DATE = CONVERT(DATE, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time'),
        @LegacyNow DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @LegacyEmail NVARCHAR(320) = N'legacy-journey-smoke-' + CONVERT(NVARCHAR(36), @LegacyNonce) + N'@pat.invalid',
        @LegacyKey NVARCHAR(512) = N'journey-smoke/' + CONVERT(NVARCHAR(36), @LegacyNonce) + N'/inspection.jpg',
        @LegacyResult NVARCHAR(MAX) = N'{"analysis":{"level":"Chú ý","title":"Synthetic legacy quota fixture","summary":"Not a diagnosis.","actions":[]},"questions":[],"limitations":[]}';
    EXEC auth.usp_RegisterLocalUser @Email = @LegacyEmail, @PasswordHash = N'synthetic-never-used-for-login',
        @PasswordHashVersion = 1, @DisplayName = N'Legacy quota smoke', @TimeZoneId = N'SE Asia Standard Time', @UserId = @LegacyUser OUTPUT;
    EXEC plant.usp_CreatePlant @LegacyUser, @LegacyCreate, N'Cà chua quota test', N'Solanum lycopersicum', @LegacyToday;
    SELECT @LegacyPlant = PlantId FROM plant.Plants WHERE CreateClientRequestId = @LegacyCreate;
    EXEC plant.usp_StartPlantJourney @LegacyUser, @LegacyPlant, 'tomato', 'seedling', 'seedling', 1;
    EXEC plant.usp_AddJourneyPhoto @LegacyUser, @LegacyPlant, @LegacyPhotoRequest, @LegacyKey, 'INSPECTION', 'CAMERA', 'image/jpeg', @LegacyPhoto OUTPUT;
    EXEC plant.usp_CompleteJourneyAnalysis @LegacyUser, @LegacyPhoto, @LegacyResult, 'DEMO', N'synthetic-no-model-call';
    EXEC plant.usp_RecordJourneyInspection @LegacyUser, @LegacyPlant, @LegacyPhoto, 1;
    INSERT game.UserPets (UserId, PetId, Quantity, LevelNumber, TotalExperience, IsCompanion) VALUES (@LegacyUser, @LegacyPet, 1, 1, 0, 0);
    INSERT game.ArHunts (UserId, PlantId, ClientRequestId, HuntLocalDate, StatusCode, CapturedPetId, WasNewPet, StartedAtUtc, CompletedAtUtc)
    VALUES (@LegacyUser, @LegacyPlant, NEWID(), DATEADD(DAY, -1, @LegacyToday), 'CAPTURED', @LegacyPet, 1, @LegacyNow, @LegacyNow);
    BEGIN TRY
        EXEC game.usp_OpenGardenPack @LegacyUser, @LegacyPackRequest;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() <> 51223 THROW;
        SET @LegacyBlocked = 1;
    END CATCH;
    IF @LegacyBlocked <> 1 OR EXISTS (SELECT 1 FROM game.GardenPackReceipts WHERE UserId = @LegacyUser)
        OR (SELECT Quantity FROM game.UserPets WHERE UserId = @LegacyUser AND PetId = @LegacyPet) <> 1
        THROW 51312, 'LEGACY_DAILY_QUOTA_MUST_PREVENT_EXTRA_GARDEN_PACK', 1;
    ROLLBACK TRANSACTION;
    SELECT 'JOURNEY_SMOKE_TEST_OK_ROLLED_BACK' AS ResultCode;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
