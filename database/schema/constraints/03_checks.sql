/*
 * Áp dụng các ràng buộc CHECK kiểm tra tính hợp lệ của dữ liệu nền tảng.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF OBJECT_ID(N'auth.CK_Users_Identity') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT CK_Users_Identity CHECK (NormalizedEmail IS NOT NULL OR PhoneE164 IS NOT NULL);
GO

IF OBJECT_ID(N'auth.CK_Users_EmailPair') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT CK_Users_EmailPair CHECK
        (
            (Email IS NULL AND NormalizedEmail IS NULL)
            OR (Email IS NOT NULL AND NormalizedEmail IS NOT NULL)
        );
GO

IF OBJECT_ID(N'auth.CK_Users_AuthProvider') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT CK_Users_AuthProvider CHECK (AuthProviderCode IN ('LOCAL', 'DEMO', 'EXTERNAL'));
GO

IF OBJECT_ID(N'auth.CK_Users_LocalPassword') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT CK_Users_LocalPassword CHECK (AuthProviderCode <> 'LOCAL' OR PasswordHash IS NOT NULL);
GO

IF OBJECT_ID(N'auth.CK_RefreshTokens_Expiry') IS NULL
    ALTER TABLE auth.RefreshTokens ADD CONSTRAINT CK_RefreshTokens_Expiry CHECK (ExpiresAtUtc > CreatedAtUtc);
GO

IF OBJECT_ID(N'auth.CK_UserActionTokens_Purpose') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT CK_UserActionTokens_Purpose CHECK (PurposeCode IN ('VERIFY_EMAIL', 'RESET_PASSWORD'));
GO

IF OBJECT_ID(N'auth.CK_UserActionTokens_Expiry') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT CK_UserActionTokens_Expiry CHECK (ExpiresAtUtc > CreatedAtUtc);
GO

IF OBJECT_ID(N'auth.CK_UserActionTokens_FinalState') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT CK_UserActionTokens_FinalState CHECK
        (
            (ConsumedAtUtc IS NULL OR RevokedAtUtc IS NULL)
            AND (ConsumedAtUtc IS NULL OR ConsumedAtUtc >= CreatedAtUtc)
            AND (RevokedAtUtc IS NULL OR RevokedAtUtc >= CreatedAtUtc)
        );
GO

IF OBJECT_ID(N'app.CK_UserProfiles_DisplayName') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT CK_UserProfiles_DisplayName CHECK (LEN(LTRIM(RTRIM(DisplayName))) >= 2);
GO

IF OBJECT_ID(N'app.CK_UserSettings_AiTone') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT CK_UserSettings_AiTone CHECK (AiToneCode IN ('FUNNY', 'GENTLE', 'EXPERT', 'MINIMAL'));
GO

IF OBJECT_ID(N'plant.CK_Plants_Name') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT CK_Plants_Name CHECK (LEN(LTRIM(RTRIM(PlantName))) >= 2);
GO

IF OBJECT_ID(N'plant.CK_Plants_Species') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT CK_Plants_Species CHECK (LEN(LTRIM(RTRIM(SpeciesName))) >= 2);
GO

IF OBJECT_ID(N'plant.CK_Plants_Stage') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT CK_Plants_Stage CHECK (StageCode IN ('SEEDLING', 'GROWING', 'MATURE'));
GO

IF OBJECT_ID(N'plant.CK_Plants_Progress') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT CK_Plants_Progress CHECK (ProgressPercent BETWEEN 0 AND 100);
GO

IF OBJECT_ID(N'plant.CK_Plants_Streak') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT CK_Plants_Streak CHECK (CurrentStreak >= 0 AND BestStreak >= CurrentStreak);
GO

IF OBJECT_ID(N'plant.CK_PlantPhotos_StorageKey') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT CK_PlantPhotos_StorageKey CHECK
        (
            LEN(LTRIM(RTRIM(StorageObjectKey))) > 0
            AND StorageObjectKey NOT LIKE N'file://%'
            AND StorageObjectKey NOT LIKE N'data:%'
        );
GO

IF OBJECT_ID(N'plant.CK_PlantPhotos_Source') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT CK_PlantPhotos_Source CHECK (CaptureSourceCode IN ('CAMERA', 'LIBRARY'));
GO

IF OBJECT_ID(N'plant.CK_PlantPhotos_Dimensions') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT CK_PlantPhotos_Dimensions CHECK
        (
            (WidthPixels IS NULL OR WidthPixels > 0)
            AND (HeightPixels IS NULL OR HeightPixels > 0)
            AND (FileSizeBytes IS NULL OR FileSizeBytes >= 0)
        );
GO

IF OBJECT_ID(N'plant.CK_PlantAnalyses_Status') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT CK_PlantAnalyses_Status CHECK (StatusCode IN ('PENDING', 'COMPLETED', 'FAILED'));
GO

IF OBJECT_ID(N'plant.CK_PlantAnalyses_Level') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT CK_PlantAnalyses_Level CHECK (LevelCode IS NULL OR LevelCode IN ('GOOD', 'ATTENTION', 'WARNING'));
GO

IF OBJECT_ID(N'plant.CK_PlantAnalyses_Confidence') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT CK_PlantAnalyses_Confidence CHECK (Confidence IS NULL OR Confidence BETWEEN 0 AND 1);
GO

IF OBJECT_ID(N'plant.CK_PlantAnalyses_Json') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT CK_PlantAnalyses_Json CHECK (RawResultJson IS NULL OR ISJSON(RawResultJson) = 1);
GO

IF OBJECT_ID(N'plant.CK_PlantAnalyses_ResultState') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT CK_PlantAnalyses_ResultState CHECK
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
        );
GO

IF OBJECT_ID(N'plant.CK_PlantAnalysisActions_Text') IS NULL
    ALTER TABLE plant.PlantAnalysisActions ADD CONSTRAINT CK_PlantAnalysisActions_Text CHECK (LEN(LTRIM(RTRIM(ActionText))) > 0);
GO

IF OBJECT_ID(N'plant.CK_PlantChibis_Status') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT CK_PlantChibis_Status CHECK (StatusCode IN ('PENDING', 'COMPLETED', 'FAILED'));
GO

IF OBJECT_ID(N'plant.CK_PlantChibis_ResultState') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT CK_PlantChibis_ResultState CHECK
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
        );
GO

IF OBJECT_ID(N'game.CK_PetCatalog_Rarity') IS NULL
    ALTER TABLE game.PetCatalog ADD CONSTRAINT CK_PetCatalog_Rarity CHECK (RarityCode IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY'));
GO

IF OBJECT_ID(N'game.CK_PetCatalog_Role') IS NULL
    ALTER TABLE game.PetCatalog ADD CONSTRAINT CK_PetCatalog_Role CHECK (RoleCode IN ('BATTLE', 'SUPPORT'));
GO

IF OBJECT_ID(N'game.CK_PetLevelThresholds_Level') IS NULL
    ALTER TABLE game.PetLevelThresholds ADD CONSTRAINT CK_PetLevelThresholds_Level CHECK (LevelNumber >= 1);
GO

IF OBJECT_ID(N'game.CK_PetLevelThresholds_Experience') IS NULL
    ALTER TABLE game.PetLevelThresholds ADD CONSTRAINT CK_PetLevelThresholds_Experience CHECK (MinTotalExperience >= 0);
GO

IF OBJECT_ID(N'game.CK_UserPets_Quantity') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT CK_UserPets_Quantity CHECK (Quantity >= 1);
GO

IF OBJECT_ID(N'game.CK_UserPets_Experience') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT CK_UserPets_Experience CHECK (TotalExperience >= 0);
GO

IF OBJECT_ID(N'game.CK_ItemCatalog_Rarity') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT CK_ItemCatalog_Rarity CHECK (RarityCode IN ('COMMON', 'RARE', 'EVENT'));
GO

IF OBJECT_ID(N'game.CK_ItemCatalog_Category') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT CK_ItemCatalog_Category CHECK (CategoryCode IN ('FOOD', 'TOY', 'ACCESSORY'));
GO

IF OBJECT_ID(N'game.CK_ItemCatalog_Experience') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT CK_ItemCatalog_Experience CHECK
        (
            ExperienceGain >= 0
            AND (CategoryCode <> 'FOOD' OR ExperienceGain > 0)
        );
GO

IF OBJECT_ID(N'game.CK_UserItems_Quantity') IS NULL
    ALTER TABLE game.UserItems ADD CONSTRAINT CK_UserItems_Quantity CHECK (Quantity >= 0);
GO

IF OBJECT_ID(N'game.CK_PetFeedEvents_Values') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT CK_PetFeedEvents_Values CHECK
        (
            QuantityUsed > 0
            AND ExperienceGained > 0
            AND ExperienceAfter >= ExperienceBefore
            AND LevelAfter >= LevelBefore
            AND ItemQuantityAfter >= 0
        );
GO

IF OBJECT_ID(N'game.CK_ArHunts_Status') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT CK_ArHunts_Status CHECK (StatusCode IN ('CAPTURED', 'NO_RESULT'));
GO

IF OBJECT_ID(N'game.CK_ArHunts_Result') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT CK_ArHunts_Result CHECK
        (
            (StatusCode = 'CAPTURED' AND CapturedPetId IS NOT NULL AND WasNewPet IS NOT NULL)
            OR (StatusCode = 'NO_RESULT' AND CapturedPetId IS NULL AND WasNewPet IS NULL)
        );
GO

IF OBJECT_ID(N'game.CK_ArHunts_Time') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT CK_ArHunts_Time CHECK (CompletedAtUtc >= StartedAtUtc);
GO

