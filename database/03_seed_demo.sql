/*
    PAT demo seed
    Prerequisites: run 01_pat_schema.sql and 02_reference_data.sql first.

    This script is idempotent: rerunning it only inserts missing seed rows and
    does not reset progress made by the demo user.
*/

USE [PAT];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @DemoUserId UNIQUEIDENTIFIER = '11111111-1111-1111-1111-111111111111';
    DECLARE @MapPlantId UNIQUEIDENTIFIER = 'A1111111-1111-1111-1111-111111111111';
    DECLARE @MintPlantId UNIQUEIDENTIFIER = 'A2222222-2222-2222-2222-222222222222';
    DECLARE @CactusPlantId UNIQUEIDENTIFIER = 'A3333333-3333-3333-3333-333333333333';
    DECLARE @MapCheckInId UNIQUEIDENTIFIER = 'D1111111-1111-1111-1111-111111111111';
    DECLARE @MintCheckInId UNIQUEIDENTIFIER = 'D2222222-2222-2222-2222-222222222222';
    DECLARE @CactusCheckInId UNIQUEIDENTIFIER = 'D3333333-3333-3333-3333-333333333333';
    DECLARE @MapPhotoId UNIQUEIDENTIFIER = 'E1111111-1111-1111-1111-111111111111';
    DECLARE @MintPhotoId UNIQUEIDENTIFIER = 'E2222222-2222-2222-2222-222222222222';
    DECLARE @CactusPhotoId UNIQUEIDENTIFIER = 'E3333333-3333-3333-3333-333333333333';
    DECLARE @MapAnalysisId UNIQUEIDENTIFIER = 'F1111111-1111-1111-1111-111111111111';
    DECLARE @MintAnalysisId UNIQUEIDENTIFIER = 'F2222222-2222-2222-2222-222222222222';
    DECLARE @CactusAnalysisId UNIQUEIDENTIFIER = 'F3333333-3333-3333-3333-333333333333';
    DECLARE @MapPhotoRequestId UNIQUEIDENTIFIER = '71111111-1111-1111-1111-111111111111';
    DECLARE @MintPhotoRequestId UNIQUEIDENTIFIER = '72222222-2222-2222-2222-222222222222';
    DECLARE @CactusPhotoRequestId UNIQUEIDENTIFIER = '73333333-3333-3333-3333-333333333333';
    DECLARE @Today DATE = CONVERT
    (
        DATE,
        SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time'
    );

    IF NOT EXISTS (SELECT 1 FROM auth.Users WHERE UserId = @DemoUserId)
    BEGIN
        INSERT auth.Users
        (
            UserId, Email, NormalizedEmail, AuthProviderCode, IsActive
        )
        VALUES
        (
            @DemoUserId, N'demo@pat.vn', N'DEMO@PAT.VN', 'DEMO', 1
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM app.UserProfiles WHERE UserId = @DemoUserId)
    BEGIN
        INSERT app.UserProfiles (UserId, DisplayName, ProfileTitle, AvatarEmoji)
        VALUES (@DemoUserId, N'Lâm Chill', N'Nông dân Ban Công Lv.4', N'🧑‍🌾');
    END;

    IF NOT EXISTS (SELECT 1 FROM app.UserSettings WHERE UserId = @DemoUserId)
    BEGIN
        INSERT app.UserSettings
        (
            UserId, NotificationsEnabled, ReminderLocalTime, TimeZoneId,
            LightArEnabled, MusicEnabled, AiToneCode, BattleNotifyEnabled
        )
        VALUES
        (
            @DemoUserId, 1, '08:00', N'SE Asia Standard Time',
            0, 1, 'FUNNY', 0
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM plant.Plants WHERE PlantId = @MapPlantId)
    BEGIN
        INSERT plant.Plants
        (
            PlantId, UserId, PlantName, SpeciesName, PlantedOn, StageCode,
            ProgressPercent, HealthStatus, MoodText, CurrentStreak, BestStreak,
            LastCheckInLocalDate, HistoryComplete
        )
        VALUES
        (
            @MapPlantId, @DemoUserId, N'Bé Mập', N'Monstera', DATEADD(DAY, -32, @Today), 'SEEDLING',
            62, N'Khỏe mạnh', N'Hơi khát nước', 16, 16, DATEADD(DAY, -1, @Today), 0
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM plant.Plants WHERE PlantId = @MintPlantId)
    BEGIN
        INSERT plant.Plants
        (
            PlantId, UserId, PlantName, SpeciesName, PlantedOn, StageCode,
            ProgressPercent, HealthStatus, MoodText, CurrentStreak, BestStreak,
            LastCheckInLocalDate, HistoryComplete
        )
        VALUES
        (
            @MintPlantId, @DemoUserId, N'Minty', N'Bạc hà', DATEADD(DAY, -48, @Today), 'GROWING',
            78, N'Tươi tốt', N'Muốn tắm nắng', 8, 12, DATEADD(DAY, -1, @Today), 0
        );
    END;

    IF NOT EXISTS (SELECT 1 FROM plant.Plants WHERE PlantId = @CactusPlantId)
    BEGIN
        INSERT plant.Plants
        (
            PlantId, UserId, PlantName, SpeciesName, PlantedOn, StageCode,
            ProgressPercent, HealthStatus, MoodText, CurrentStreak, BestStreak,
            LastCheckInLocalDate, HistoryComplete
        )
        VALUES
        (
            @CactusPlantId, @DemoUserId, N'Gai Nhỏ', N'Xương rồng', DATEADD(DAY, -75, @Today), 'MATURE',
            92, N'Ổn định', N'Đủ nước rồi', 4, 9, DATEADD(DAY, -2, @Today), 0
        );
    END;

    /* Keep relative demo history stable when this idempotent script is rerun later. */
    SELECT @Today = CONVERT
    (
        DATE,
        CreatedAtUtc AT TIME ZONE 'UTC' AT TIME ZONE 'SE Asia Standard Time'
    )
    FROM auth.Users
    WHERE UserId = @DemoUserId;

    DECLARE @MapCapturedAtUtc DATETIME2(3) = DATEADD
    (
        HOUR, -7,
        DATEADD(MINUTE, 478, CONVERT(DATETIME2(3), DATEADD(DAY, -1, @Today)))
    );
    DECLARE @MintCapturedAtUtc DATETIME2(3) = DATEADD
    (
        HOUR, -7,
        DATEADD(MINUTE, 455, CONVERT(DATETIME2(3), DATEADD(DAY, -1, @Today)))
    );
    DECLARE @CactusCapturedAtUtc DATETIME2(3) = DATEADD
    (
        HOUR, -7,
        DATEADD(MINUTE, 542, CONVERT(DATETIME2(3), DATEADD(DAY, -2, @Today)))
    );

    IF NOT EXISTS
    (
        SELECT 1 FROM plant.PlantCheckIns
        WHERE PlantId = @MapPlantId AND CheckInLocalDate = DATEADD(DAY, -1, @Today)
    )
        INSERT plant.PlantCheckIns (CheckInId, PlantId, CheckInLocalDate, CreatedAtUtc)
        VALUES (@MapCheckInId, @MapPlantId, DATEADD(DAY, -1, @Today), @MapCapturedAtUtc);
    SELECT @MapCheckInId = CheckInId FROM plant.PlantCheckIns
    WHERE PlantId = @MapPlantId AND CheckInLocalDate = DATEADD(DAY, -1, @Today);

    IF NOT EXISTS
    (
        SELECT 1 FROM plant.PlantCheckIns
        WHERE PlantId = @MintPlantId AND CheckInLocalDate = DATEADD(DAY, -1, @Today)
    )
        INSERT plant.PlantCheckIns (CheckInId, PlantId, CheckInLocalDate, CreatedAtUtc)
        VALUES (@MintCheckInId, @MintPlantId, DATEADD(DAY, -1, @Today), @MintCapturedAtUtc);
    SELECT @MintCheckInId = CheckInId FROM plant.PlantCheckIns
    WHERE PlantId = @MintPlantId AND CheckInLocalDate = DATEADD(DAY, -1, @Today);

    IF NOT EXISTS
    (
        SELECT 1 FROM plant.PlantCheckIns
        WHERE PlantId = @CactusPlantId AND CheckInLocalDate = DATEADD(DAY, -2, @Today)
    )
        INSERT plant.PlantCheckIns (CheckInId, PlantId, CheckInLocalDate, CreatedAtUtc)
        VALUES (@CactusCheckInId, @CactusPlantId, DATEADD(DAY, -2, @Today), @CactusCapturedAtUtc);
    SELECT @CactusCheckInId = CheckInId FROM plant.PlantCheckIns
    WHERE PlantId = @CactusPlantId AND CheckInLocalDate = DATEADD(DAY, -2, @Today);

    IF NOT EXISTS (SELECT 1 FROM plant.PlantPhotos WHERE ClientRequestId = @MapPhotoRequestId)
        INSERT plant.PlantPhotos
        (
            PhotoId, PlantId, CheckInId, ClientRequestId, StorageObjectKey,
            CaptureSourceCode, MimeType, CountsForStreak, CapturedAtUtc, CreatedAtUtc
        )
        VALUES
        (
            @MapPhotoId, @MapPlantId, @MapCheckInId, @MapPhotoRequestId,
            N'demo/photos/monstera-latest.jpg', 'LIBRARY', 'image/jpeg', 1,
            @MapCapturedAtUtc, @MapCapturedAtUtc
        );
    SELECT @MapPhotoId = PhotoId FROM plant.PlantPhotos WHERE ClientRequestId = @MapPhotoRequestId;

    IF NOT EXISTS (SELECT 1 FROM plant.PlantPhotos WHERE ClientRequestId = @MintPhotoRequestId)
        INSERT plant.PlantPhotos
        (
            PhotoId, PlantId, CheckInId, ClientRequestId, StorageObjectKey,
            CaptureSourceCode, MimeType, CountsForStreak, CapturedAtUtc, CreatedAtUtc
        )
        VALUES
        (
            @MintPhotoId, @MintPlantId, @MintCheckInId, @MintPhotoRequestId,
            N'demo/photos/mint-latest.jpg', 'LIBRARY', 'image/jpeg', 1,
            @MintCapturedAtUtc, @MintCapturedAtUtc
        );
    SELECT @MintPhotoId = PhotoId FROM plant.PlantPhotos WHERE ClientRequestId = @MintPhotoRequestId;

    IF NOT EXISTS (SELECT 1 FROM plant.PlantPhotos WHERE ClientRequestId = @CactusPhotoRequestId)
        INSERT plant.PlantPhotos
        (
            PhotoId, PlantId, CheckInId, ClientRequestId, StorageObjectKey,
            CaptureSourceCode, MimeType, CountsForStreak, CapturedAtUtc, CreatedAtUtc
        )
        VALUES
        (
            @CactusPhotoId, @CactusPlantId, @CactusCheckInId, @CactusPhotoRequestId,
            N'demo/photos/cactus-latest.jpg', 'LIBRARY', 'image/jpeg', 1,
            @CactusCapturedAtUtc, @CactusCapturedAtUtc
        );
    SELECT @CactusPhotoId = PhotoId FROM plant.PlantPhotos WHERE ClientRequestId = @CactusPhotoRequestId;

    IF NOT EXISTS (SELECT 1 FROM plant.PlantAnalyses WHERE PhotoId = @MapPhotoId)
        INSERT plant.PlantAnalyses
        (
            AnalysisId, PlantId, PhotoId, StatusCode, LevelCode, Title, Summary,
            Confidence, ModelName, ModelVersion, RawResultJson, CreatedAtUtc, CompletedAtUtc
        )
        VALUES
        (
            @MapAnalysisId, @MapPlantId, @MapPhotoId, 'COMPLETED', 'ATTENTION',
            N'Đất đang hơi khô', N'Cây vẫn khỏe nhưng nên được tưới trong hôm nay.',
            0.8900, N'pat-demo-analyzer', N'1.0', N'{"source":"demo-seed"}',
            @MapCapturedAtUtc, DATEADD(SECOND, 3, @MapCapturedAtUtc)
        );
    SELECT @MapAnalysisId = AnalysisId FROM plant.PlantAnalyses WHERE PhotoId = @MapPhotoId;

    IF NOT EXISTS (SELECT 1 FROM plant.PlantAnalyses WHERE PhotoId = @MintPhotoId)
        INSERT plant.PlantAnalyses
        (
            AnalysisId, PlantId, PhotoId, StatusCode, LevelCode, Title, Summary,
            Confidence, ModelName, ModelVersion, RawResultJson, CreatedAtUtc, CompletedAtUtc
        )
        VALUES
        (
            @MintAnalysisId, @MintPlantId, @MintPhotoId, 'COMPLETED', 'GOOD',
            N'Lá xanh và đều màu', N'Chưa thấy dấu hiệu sâu bệnh trong ảnh gần nhất.',
            0.9400, N'pat-demo-analyzer', N'1.0', N'{"source":"demo-seed"}',
            @MintCapturedAtUtc, DATEADD(SECOND, 3, @MintCapturedAtUtc)
        );
    SELECT @MintAnalysisId = AnalysisId FROM plant.PlantAnalyses WHERE PhotoId = @MintPhotoId;

    IF NOT EXISTS (SELECT 1 FROM plant.PlantAnalyses WHERE PhotoId = @CactusPhotoId)
        INSERT plant.PlantAnalyses
        (
            AnalysisId, PlantId, PhotoId, StatusCode, LevelCode, Title, Summary,
            Confidence, ModelName, ModelVersion, RawResultJson, CreatedAtUtc, CompletedAtUtc
        )
        VALUES
        (
            @CactusAnalysisId, @CactusPlantId, @CactusPhotoId, 'COMPLETED', 'GOOD',
            N'Thân cây căng khỏe', N'Độ ẩm phù hợp, chưa cần tưới thêm.',
            0.9600, N'pat-demo-analyzer', N'1.0', N'{"source":"demo-seed"}',
            @CactusCapturedAtUtc, DATEADD(SECOND, 3, @CactusCapturedAtUtc)
        );
    SELECT @CactusAnalysisId = AnalysisId FROM plant.PlantAnalyses WHERE PhotoId = @CactusPhotoId;

    IF NOT EXISTS (SELECT 1 FROM plant.PlantAnalysisActions WHERE AnalysisId = @MapAnalysisId)
        INSERT plant.PlantAnalysisActions (AnalysisId, SortOrder, ActionText)
        VALUES
            (@MapAnalysisId, 1, N'Tưới 150–200 ml nước'),
            (@MapAnalysisId, 2, N'Đặt cây ở nơi có ánh sáng tán xạ'),
            (@MapAnalysisId, 3, N'Kiểm tra lại độ ẩm đất sau 6 giờ');

    IF NOT EXISTS (SELECT 1 FROM plant.PlantAnalysisActions WHERE AnalysisId = @MintAnalysisId)
        INSERT plant.PlantAnalysisActions (AnalysisId, SortOrder, ActionText)
        VALUES
            (@MintAnalysisId, 1, N'Duy trì tưới vào buổi sáng'),
            (@MintAnalysisId, 2, N'Xoay chậu 1/4 vòng mỗi 3 ngày'),
            (@MintAnalysisId, 3, N'Tỉa lá già sát gốc');

    IF NOT EXISTS (SELECT 1 FROM plant.PlantAnalysisActions WHERE AnalysisId = @CactusAnalysisId)
        INSERT plant.PlantAnalysisActions (AnalysisId, SortOrder, ActionText)
        VALUES
            (@CactusAnalysisId, 1, N'Chưa tưới thêm trong 3 ngày'),
            (@CactusAnalysisId, 2, N'Đảm bảo chậu thoát nước tốt'),
            (@CactusAnalysisId, 3, N'Cho cây nhận nắng sáng 2–3 giờ');

    INSERT plant.PlantChibis
    (
        PlantChibiId, PlantId, SourcePhotoId, StatusCode, FallbackEmoji, IsCurrent
    )
    SELECT source.PlantChibiId, source.PlantId, source.SourcePhotoId, 'PENDING', source.FallbackEmoji, 1
    FROM
    (
        VALUES
            (CONVERT(UNIQUEIDENTIFIER, 'C1111111-1111-1111-1111-111111111111'), @MapPlantId, @MapPhotoId, N'🌿'),
            (CONVERT(UNIQUEIDENTIFIER, 'C2222222-2222-2222-2222-222222222222'), @MintPlantId, @MintPhotoId, N'🪴'),
            (CONVERT(UNIQUEIDENTIFIER, 'C3333333-3333-3333-3333-333333333333'), @CactusPlantId, @CactusPhotoId, N'🌵')
    ) AS source(PlantChibiId, PlantId, SourcePhotoId, FallbackEmoji)
    WHERE NOT EXISTS
    (
        SELECT 1 FROM plant.PlantChibis AS target WHERE target.PlantId = source.PlantId AND target.IsCurrent = 1
    );

    DECLARE @LadybugPetId INT = (SELECT PetId FROM game.PetCatalog WHERE PetCode = 'ladybug');
    DECLARE @CaterpillarPetId INT = (SELECT PetId FROM game.PetCatalog WHERE PetCode = 'caterpillar');
    DECLARE @BeePetId INT = (SELECT PetId FROM game.PetCatalog WHERE PetCode = 'hunter-bee');

    INSERT game.UserPets
    (
        UserPetId, UserId, PetId, Quantity, LevelNumber, TotalExperience, IsCompanion
    )
    SELECT
        source.UserPetId,
        @DemoUserId,
        source.PetId,
        1,
        source.LevelNumber,
        threshold.MinTotalExperience + source.ExperienceInLevel,
        source.IsCompanion
    FROM
    (
        VALUES
            (CONVERT(UNIQUEIDENTIFIER, 'B1111111-1111-1111-1111-111111111111'), @LadybugPetId,    CONVERT(SMALLINT, 15), CONVERT(BIGINT, 420), CONVERT(BIT, 1)),
            (CONVERT(UNIQUEIDENTIFIER, 'B2222222-2222-2222-2222-222222222222'), @CaterpillarPetId, CONVERT(SMALLINT, 8),  CONVERT(BIGINT, 75),  CONVERT(BIT, 0)),
            (CONVERT(UNIQUEIDENTIFIER, 'B3333333-3333-3333-3333-333333333333'), @BeePetId,         CONVERT(SMALLINT, 12), CONVERT(BIGINT, 190), CONVERT(BIT, 0))
    ) AS source(UserPetId, PetId, LevelNumber, ExperienceInLevel, IsCompanion)
    JOIN game.PetLevelThresholds AS threshold ON threshold.LevelNumber = source.LevelNumber
    WHERE NOT EXISTS
    (
        SELECT 1
        FROM game.UserPets AS target
        WHERE target.UserId = @DemoUserId AND target.PetId = source.PetId
    );

    INSERT game.UserItems (UserId, ItemId, Quantity)
    SELECT @DemoUserId, catalog.ItemId, source.Quantity
    FROM
    (
        VALUES
            ('berry-bites', 5),
            ('honey-cookie', 3),
            ('forest-milk', 2),
            ('star-snack', 1)
    ) AS source(ItemCode, Quantity)
    JOIN game.ItemCatalog AS catalog ON catalog.ItemCode = source.ItemCode
    WHERE NOT EXISTS
    (
        SELECT 1
        FROM game.UserItems AS target
        WHERE target.UserId = @DemoUserId AND target.ItemId = catalog.ItemId
    );

    COMMIT TRANSACTION;

    SELECT
        'SEED_OK' AS ResultCode,
        @DemoUserId AS DemoUserId,
        (SELECT COUNT(*) FROM plant.Plants WHERE UserId = @DemoUserId AND DeletedAtUtc IS NULL) AS PlantCount,
        (SELECT COUNT(*) FROM game.UserPets WHERE UserId = @DemoUserId) AS OwnedPetSpeciesCount,
        (SELECT COUNT(*) FROM game.UserItems WHERE UserId = @DemoUserId) AS ItemTypeCount;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
