/*
 * Tạo các chỉ mục tra cứu và chỉ mục duy nhất có điều kiện sau các ràng buộc bảng.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'auth.RefreshTokens') AND name = N'IX_RefreshTokens_User_Expiry')
    CREATE NONCLUSTERED INDEX IX_RefreshTokens_User_Expiry
        ON auth.RefreshTokens (UserId, ExpiresAtUtc DESC)
        INCLUDE (RevokedAtUtc);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'auth.UserActionTokens') AND name = N'IX_UserActionTokens_User_Purpose_Expiry')
    CREATE NONCLUSTERED INDEX IX_UserActionTokens_User_Purpose_Expiry
        ON auth.UserActionTokens (UserId, PurposeCode, ExpiresAtUtc DESC)
        INCLUDE (ConsumedAtUtc, RevokedAtUtc);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.Plants') AND name = N'IX_Plants_User_Active')
    CREATE NONCLUSTERED INDEX IX_Plants_User_Active
        ON plant.Plants (UserId, CreatedAtUtc)
        INCLUDE (PlantName, SpeciesName, CurrentStreak, BestStreak, LastCheckInLocalDate)
        WHERE DeletedAtUtc IS NULL;
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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'plant.PlantAnalyses') AND name = N'IX_PlantAnalyses_Plant_Time')
    CREATE NONCLUSTERED INDEX IX_PlantAnalyses_Plant_Time
        ON plant.PlantAnalyses (PlantId, CreatedAtUtc DESC)
        INCLUDE (PhotoId, StatusCode, LevelCode, Title, Confidence);
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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'game.UserPets') AND name = N'UX_UserPets_Companion')
    CREATE UNIQUE NONCLUSTERED INDEX UX_UserPets_Companion
        ON game.UserPets (UserId)
        WHERE IsCompanion = 1;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'game.PetFeedEvents') AND name = N'IX_PetFeedEvents_UserPet_Time')
    CREATE NONCLUSTERED INDEX IX_PetFeedEvents_UserPet_Time
        ON game.PetFeedEvents (UserPetId, CreatedAtUtc DESC)
        INCLUDE (ItemId, ExperienceGained, LevelAfter);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'game.ArHunts') AND name = N'IX_ArHunts_Plant_Time')
    CREATE NONCLUSTERED INDEX IX_ArHunts_Plant_Time
        ON game.ArHunts (PlantId, StartedAtUtc DESC)
        INCLUDE (UserId, StatusCode, CapturedPetId);
GO

