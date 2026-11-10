/*
 * Định nghĩa thủ tục cây, kiểm tra hằng ngày, ảnh, phân tích và hình đại diện cây trong schema plant.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
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

