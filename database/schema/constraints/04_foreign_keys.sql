/*
 * Tạo quan hệ khóa ngoại sau khi toàn bộ bảng, khóa chính và khóa duy nhất đã có.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF OBJECT_ID(N'auth.FK_RefreshTokens_Users') IS NULL
    ALTER TABLE auth.RefreshTokens ADD CONSTRAINT FK_RefreshTokens_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'auth.FK_UserActionTokens_Users') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT FK_UserActionTokens_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'app.FK_UserProfiles_Users') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT FK_UserProfiles_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'app.FK_UserSettings_Users') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT FK_UserSettings_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'plant.FK_Plants_Users') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT FK_Plants_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'plant.FK_PlantCheckIns_Plants') IS NULL
    ALTER TABLE plant.PlantCheckIns ADD CONSTRAINT FK_PlantCheckIns_Plants FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId);
GO

IF OBJECT_ID(N'plant.FK_PlantPhotos_Plants') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT FK_PlantPhotos_Plants FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId);
GO

IF OBJECT_ID(N'plant.FK_PlantPhotos_CheckIns') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT FK_PlantPhotos_CheckIns FOREIGN KEY (PlantId, CheckInId)
            REFERENCES plant.PlantCheckIns (PlantId, CheckInId);
GO

IF OBJECT_ID(N'plant.FK_PlantAnalyses_PlantPhoto') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT FK_PlantAnalyses_PlantPhoto FOREIGN KEY (PlantId, PhotoId)
            REFERENCES plant.PlantPhotos (PlantId, PhotoId);
GO

IF OBJECT_ID(N'plant.FK_PlantAnalysisActions_Analyses') IS NULL
    ALTER TABLE plant.PlantAnalysisActions ADD CONSTRAINT FK_PlantAnalysisActions_Analyses FOREIGN KEY (AnalysisId)
            REFERENCES plant.PlantAnalyses (AnalysisId);
GO

IF OBJECT_ID(N'plant.FK_PlantChibis_Plants') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT FK_PlantChibis_Plants FOREIGN KEY (PlantId) REFERENCES plant.Plants (PlantId);
GO

IF OBJECT_ID(N'plant.FK_PlantChibis_SourcePhoto') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT FK_PlantChibis_SourcePhoto FOREIGN KEY (PlantId, SourcePhotoId)
            REFERENCES plant.PlantPhotos (PlantId, PhotoId);
GO

IF OBJECT_ID(N'game.FK_UserPets_Users') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT FK_UserPets_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'game.FK_UserPets_PetCatalog') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT FK_UserPets_PetCatalog FOREIGN KEY (PetId) REFERENCES game.PetCatalog (PetId);
GO

IF OBJECT_ID(N'game.FK_UserPets_Level') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT FK_UserPets_Level FOREIGN KEY (LevelNumber) REFERENCES game.PetLevelThresholds (LevelNumber);
GO

IF OBJECT_ID(N'game.FK_UserItems_Users') IS NULL
    ALTER TABLE game.UserItems ADD CONSTRAINT FK_UserItems_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'game.FK_UserItems_ItemCatalog') IS NULL
    ALTER TABLE game.UserItems ADD CONSTRAINT FK_UserItems_ItemCatalog FOREIGN KEY (ItemId) REFERENCES game.ItemCatalog (ItemId);
GO

IF OBJECT_ID(N'game.FK_PetFeedEvents_Users') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT FK_PetFeedEvents_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'game.FK_PetFeedEvents_UserPets') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT FK_PetFeedEvents_UserPets FOREIGN KEY (UserId, UserPetId)
            REFERENCES game.UserPets (UserId, UserPetId);
GO

IF OBJECT_ID(N'game.FK_PetFeedEvents_UserItems') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT FK_PetFeedEvents_UserItems FOREIGN KEY (UserId, ItemId)
            REFERENCES game.UserItems (UserId, ItemId);
GO

IF OBJECT_ID(N'game.FK_ArHunts_Users') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT FK_ArHunts_Users FOREIGN KEY (UserId) REFERENCES auth.Users (UserId);
GO

IF OBJECT_ID(N'game.FK_ArHunts_Plants') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT FK_ArHunts_Plants FOREIGN KEY (UserId, PlantId)
            REFERENCES plant.Plants (UserId, PlantId);
GO

IF OBJECT_ID(N'game.FK_ArHunts_Pets') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT FK_ArHunts_Pets FOREIGN KEY (CapturedPetId) REFERENCES game.PetCatalog (PetId);
GO

