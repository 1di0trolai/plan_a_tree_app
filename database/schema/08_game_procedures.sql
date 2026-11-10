/*
 * Định nghĩa các thủ tục SQL nền tảng cho thức ăn, thú đồng hành và lượt săn trong schema game; không tự mở tính năng trên ứng dụng.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
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

