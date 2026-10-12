/*
    PAT transactional smoke test
    Prerequisites: run 01_pat_schema.sql and 02_reference_data.sql first.
    The optional demo-account seed is not required.

    Every test row is created inside one transaction and rolled back at the end.
    A successful run returns ResultCode = SMOKE_TEST_OK and leaves no test data.
*/

USE [PAT];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @SmokeNonce UNIQUEIDENTIFIER = NEWID();
    DECLARE @SmokeUserId UNIQUEIDENTIFIER;
    DECLARE @SmokePlantId UNIQUEIDENTIFIER;
    DECLARE @SmokeUserPetId UNIQUEIDENTIFIER = NEWID();
    DECLARE @CreatePlantRequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @CheckInRequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @SecondCheckInRequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @FeedRequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @ArRequestId UNIQUEIDENTIFIER = NEWID();
    DECLARE @SmokeIdentity NVARCHAR(320) = N'smoke-' + REPLACE(CONVERT(NVARCHAR(36), @SmokeNonce), N'-', N'') + N'@pat.local';
    DECLARE @RefreshTokenHash BINARY(32) = HASHBYTES('SHA2_256', CONVERT(VARBINARY(36), NEWID()));
    DECLARE @RotatedTokenHash BINARY(32) = HASHBYTES('SHA2_256', CONVERT(VARBINARY(36), NEWID()));
    DECLARE @ResetTokenHash BINARY(32) = HASHBYTES('SHA2_256', CONVERT(VARBINARY(36), NEWID()));
    DECLARE @RefreshExpiresAtUtc DATETIME2(3) = DATEADD(DAY, 30, SYSUTCDATETIME());
    DECLARE @RotatedExpiresAtUtc DATETIME2(3) = DATEADD(DAY, 30, SYSUTCDATETIME());
    DECLARE @ResetExpiresAtUtc DATETIME2(3) = DATEADD(HOUR, 1, SYSUTCDATETIME());
    DECLARE @Today DATE = CONVERT
    (
        DATE,
        SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time'
    );
    DECLARE @SmokePlantedOn DATE = DATEADD(DAY, -10, @Today);
    DECLARE @LadybugPetId INT = (SELECT PetId FROM game.PetCatalog WHERE PetCode = 'ladybug');
    DECLARE @MoonMothPetId INT = (SELECT PetId FROM game.PetCatalog WHERE PetCode = 'moon-moth');
    DECLARE @FoodItemId INT = (SELECT ItemId FROM game.ItemCatalog WHERE ItemCode = 'berry-bites');

    IF @LadybugPetId IS NULL OR @MoonMothPetId IS NULL OR @FoodItemId IS NULL
        THROW 51100, 'SEED_DATA_MISSING', 1;

    EXEC auth.usp_RegisterLocalUser
        @Email = @SmokeIdentity,
        @PasswordHash = N'smoke-test-hash-not-a-real-password',
        @PasswordHashVersion = 1,
        @DisplayName = N'Smoke Test',
        @TimeZoneId = N'SE Asia Standard Time',
        @UserId = @SmokeUserId OUTPUT;

    EXEC auth.usp_GetLoginCredential @Identity = @SmokeIdentity;

    EXEC auth.usp_IssueRefreshToken
        @UserId = @SmokeUserId,
        @TokenHash = @RefreshTokenHash,
        @ExpiresAtUtc = @RefreshExpiresAtUtc;

    EXEC auth.usp_RotateRefreshToken
        @CurrentTokenHash = @RefreshTokenHash,
        @NewTokenHash = @RotatedTokenHash,
        @NewExpiresAtUtc = @RotatedExpiresAtUtc;

    EXEC auth.usp_CreatePasswordResetToken
        @Identity = @SmokeIdentity,
        @TokenHash = @ResetTokenHash,
        @ExpiresAtUtc = @ResetExpiresAtUtc;

    EXEC auth.usp_ResetPassword
        @TokenHash = @ResetTokenHash,
        @NewPasswordHash = N'smoke-test-new-hash-not-a-real-password',
        @PasswordHashVersion = 1;

    EXEC app.usp_UpdateUserProfile
        @UserId = @SmokeUserId,
        @DisplayName = N'Smoke Test',
        @ProfileTitle = N'Tài khoản kiểm thử',
        @AvatarEmoji = N'🧪';

    EXEC app.usp_UpdateUserSettings
        @UserId = @SmokeUserId,
        @NotificationsEnabled = 1,
        @ReminderLocalTime = '08:00',
        @TimeZoneId = N'SE Asia Standard Time',
        @LightArEnabled = 0,
        @MusicEnabled = 0,
        @AiToneCode = 'MINIMAL',
        @BattleNotifyEnabled = 0;

    EXEC plant.usp_CreatePlant
        @UserId = @SmokeUserId,
        @ClientRequestId = @CreatePlantRequestId,
        @PlantName = N'Cây kiểm thử',
        @SpeciesName = N'Monstera',
        @PlantedOn = @SmokePlantedOn,
        @FallbackEmoji = N'🪴';

    EXEC plant.usp_CreatePlant
        @UserId = @SmokeUserId,
        @ClientRequestId = @CreatePlantRequestId,
        @PlantName = N'Cây kiểm thử',
        @SpeciesName = N'Monstera',
        @PlantedOn = @SmokePlantedOn,
        @FallbackEmoji = N'🪴';

    SELECT @SmokePlantId = PlantId
    FROM plant.Plants
    WHERE CreateClientRequestId = @CreatePlantRequestId;

    IF (SELECT COUNT(*) FROM plant.Plants WHERE CreateClientRequestId = @CreatePlantRequestId) <> 1
        THROW 51110, 'PLANT_CREATE_IDEMPOTENCY_FAILED', 1;

    UPDATE plant.Plants
    SET ProgressPercent = 20,
        CurrentStreak = 2,
        BestStreak = 4,
        LastCheckInLocalDate = DATEADD(DAY, -1, @Today)
    WHERE PlantId = @SmokePlantId;

    INSERT game.UserPets
    (
        UserPetId, UserId, PetId, Quantity, LevelNumber, TotalExperience, IsCompanion
    )
    VALUES
    (
        @SmokeUserPetId, @SmokeUserId, @LadybugPetId, 1, 1, 0, 1
    );

    INSERT game.UserItems (UserId, ItemId, Quantity)
    VALUES (@SmokeUserId, @FoodItemId, 2);

    EXEC plant.usp_CreatePlantCheckIn
        @UserId = @SmokeUserId,
        @PlantId = @SmokePlantId,
        @ClientRequestId = @CheckInRequestId,
        @StorageObjectKey = N'smoke/photos/plant.jpg',
        @PublicUrl = NULL,
        @CaptureSourceCode = 'LIBRARY',
        @MimeType = 'image/jpeg',
        @WidthPixels = 1080,
        @HeightPixels = 1440,
        @FileSizeBytes = 250000,
        @FallbackEmoji = N'🪴';

    /* Retrying the same mobile request must return the original result. */
    EXEC plant.usp_CreatePlantCheckIn
        @UserId = @SmokeUserId,
        @PlantId = @SmokePlantId,
        @ClientRequestId = @CheckInRequestId,
        @StorageObjectKey = N'smoke/photos/plant.jpg',
        @CaptureSourceCode = 'LIBRARY';

    DECLARE @AnalysisId UNIQUEIDENTIFIER;
    DECLARE @GeneratedChibiId UNIQUEIDENTIFIER;
    SELECT
        @AnalysisId = analysis.AnalysisId,
        @GeneratedChibiId = chibi.PlantChibiId
    FROM plant.PlantPhotos AS photo
    JOIN plant.PlantAnalyses AS analysis ON analysis.PhotoId = photo.PhotoId
    JOIN plant.PlantChibis AS chibi ON chibi.SourcePhotoId = photo.PhotoId AND chibi.IsCurrent = 1
    WHERE photo.ClientRequestId = @CheckInRequestId;

    DECLARE @Actions plant.AnalysisActionInput;
    INSERT @Actions (SortOrder, ActionText)
    VALUES
        (1, N'Tưới cây vào buổi sáng'),
        (2, N'Đặt cây ở nơi có ánh sáng tán xạ');

    EXEC plant.usp_CompletePlantAnalysis
        @UserId = @SmokeUserId,
        @AnalysisId = @AnalysisId,
        @LevelCode = 'ATTENTION',
        @Title = N'Đất đang hơi khô',
        @Summary = N'Cây vẫn khỏe nhưng nên được tưới trong hôm nay.',
        @Confidence = 0.9200,
        @ModelName = N'pat-mock-analyzer',
        @ModelVersion = N'1.0',
        @RawResultJson = N'{"source":"smoke-test"}',
        @Actions = @Actions;

    EXEC plant.usp_CompletePlantChibi
        @UserId = @SmokeUserId,
        @PlantChibiId = @GeneratedChibiId,
        @ImageStorageObjectKey = N'smoke/chibis/plant.png';

    /* A different photo on the same day shares the daily check-in and does not add streak. */
    EXEC plant.usp_CreatePlantCheckIn
        @UserId = @SmokeUserId,
        @PlantId = @SmokePlantId,
        @ClientRequestId = @SecondCheckInRequestId,
        @StorageObjectKey = N'smoke/photos/plant-second.jpg',
        @CaptureSourceCode = 'CAMERA',
        @MimeType = 'image/jpeg';

    EXEC game.usp_FeedPet
        @UserId = @SmokeUserId,
        @UserPetId = @SmokeUserPetId,
        @ItemId = @FoodItemId,
        @ClientRequestId = @FeedRequestId;

    EXEC game.usp_FeedPet
        @UserId = @SmokeUserId,
        @UserPetId = @SmokeUserPetId,
        @ItemId = @FoodItemId,
        @ClientRequestId = @FeedRequestId;

    EXEC game.usp_RecordArHunt
        @UserId = @SmokeUserId,
        @PlantId = @SmokePlantId,
        @ClientRequestId = @ArRequestId,
        @CapturedPetId = @MoonMothPetId;

    EXEC game.usp_RecordArHunt
        @UserId = @SmokeUserId,
        @PlantId = @SmokePlantId,
        @ClientRequestId = @ArRequestId,
        @CapturedPetId = @MoonMothPetId;

    IF NOT EXISTS
    (
        SELECT 1 FROM auth.Users
        WHERE UserId = @SmokeUserId
          AND PasswordHash = N'smoke-test-new-hash-not-a-real-password'
    )
        THROW 51111, 'PASSWORD_RESET_FAILED', 1;

    IF EXISTS
    (
        SELECT 1 FROM auth.RefreshTokens
        WHERE UserId = @SmokeUserId AND RevokedAtUtc IS NULL
    )
        THROW 51112, 'PASSWORD_RESET_DID_NOT_REVOKE_SESSIONS', 1;

    IF NOT EXISTS
    (
        SELECT 1 FROM auth.UserActionTokens
        WHERE UserId = @SmokeUserId
          AND TokenHash = @ResetTokenHash
          AND ConsumedAtUtc IS NOT NULL
    )
        THROW 51113, 'PASSWORD_RESET_TOKEN_NOT_CONSUMED', 1;

    IF (SELECT COUNT(*) FROM plant.PlantPhotos WHERE ClientRequestId = @CheckInRequestId) <> 1
        THROW 51101, 'CHECKIN_IDEMPOTENCY_FAILED', 1;

    IF (SELECT COUNT(*) FROM plant.PlantCheckIns WHERE PlantId = @SmokePlantId AND CheckInLocalDate = @Today) <> 1
        THROW 51107, 'ONE_DAILY_CHECKIN_FAILED', 1;

    IF
    (
        SELECT COUNT(*)
        FROM plant.PlantPhotos AS photo
        JOIN plant.PlantCheckIns AS checkInRow ON checkInRow.CheckInId = photo.CheckInId
        WHERE photo.PlantId = @SmokePlantId AND checkInRow.CheckInLocalDate = @Today
    ) <> 2
        THROW 51108, 'MULTIPLE_DAILY_PHOTOS_FAILED', 1;

    IF
    (
        SELECT SUM(CONVERT(INT, photo.CountsForStreak))
        FROM plant.PlantPhotos AS photo
        JOIN plant.PlantCheckIns AS checkInRow ON checkInRow.CheckInId = photo.CheckInId
        WHERE photo.PlantId = @SmokePlantId AND checkInRow.CheckInLocalDate = @Today
    ) <> 1
        THROW 51109, 'STREAK_CREDIT_FAILED', 1;

    IF (SELECT COUNT(*) FROM game.PetFeedEvents WHERE ClientRequestId = @FeedRequestId) <> 1
        THROW 51102, 'FEED_IDEMPOTENCY_FAILED', 1;

    IF (SELECT Quantity FROM game.UserItems WHERE UserId = @SmokeUserId AND ItemId = @FoodItemId) <> 1
        THROW 51103, 'FEED_INVENTORY_FAILED', 1;

    IF (SELECT TotalExperience FROM game.UserPets WHERE UserPetId = @SmokeUserPetId) <> 25
        THROW 51104, 'FEED_EXPERIENCE_FAILED', 1;

    IF (SELECT COUNT(*) FROM game.ArHunts WHERE ClientRequestId = @ArRequestId) <> 1
        THROW 51105, 'AR_IDEMPOTENCY_FAILED', 1;

    IF NOT EXISTS
    (
        SELECT 1
        FROM game.UserPets
        WHERE UserId = @SmokeUserId AND PetId = @MoonMothPetId AND Quantity = 1
    )
        THROW 51106, 'AR_REWARD_FAILED', 1;

    SELECT * FROM app.vw_UserProfileSettings WHERE UserId = @SmokeUserId;
    SELECT * FROM plant.vw_PlantDashboard WHERE UserId = @SmokeUserId;
    SELECT * FROM game.vw_UserPetCollection WHERE UserId = @SmokeUserId;
    SELECT * FROM game.vw_UserItemInventory WHERE UserId = @SmokeUserId;

    ROLLBACK TRANSACTION;

    SELECT
        'SMOKE_TEST_OK' AS ResultCode,
        'All test rows were rolled back.' AS CleanupStatus;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
