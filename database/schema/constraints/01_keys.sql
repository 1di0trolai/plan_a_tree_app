/*
 * Tạo khóa chính và khóa duy nhất trước khi áp dụng khóa ngoại; giữ nguyên tên và định nghĩa các khóa.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF OBJECT_ID(N'auth.PK_Users') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT PK_Users PRIMARY KEY CLUSTERED (UserId);
GO

IF OBJECT_ID(N'auth.PK_RefreshTokens') IS NULL
    ALTER TABLE auth.RefreshTokens ADD CONSTRAINT PK_RefreshTokens PRIMARY KEY CLUSTERED (RefreshTokenId);
GO

IF OBJECT_ID(N'auth.UQ_RefreshTokens_TokenHash') IS NULL
    ALTER TABLE auth.RefreshTokens ADD CONSTRAINT UQ_RefreshTokens_TokenHash UNIQUE (TokenHash);
GO

IF OBJECT_ID(N'auth.PK_UserActionTokens') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT PK_UserActionTokens PRIMARY KEY CLUSTERED (UserActionTokenId);
GO

IF OBJECT_ID(N'auth.UQ_UserActionTokens_TokenHash') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT UQ_UserActionTokens_TokenHash UNIQUE (TokenHash);
GO

IF OBJECT_ID(N'app.PK_UserProfiles') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT PK_UserProfiles PRIMARY KEY CLUSTERED (UserId);
GO

IF OBJECT_ID(N'app.PK_UserSettings') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT PK_UserSettings PRIMARY KEY CLUSTERED (UserId);
GO

IF OBJECT_ID(N'plant.PK_Plants') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT PK_Plants PRIMARY KEY CLUSTERED (PlantId);
GO

IF OBJECT_ID(N'plant.UQ_Plants_CreateClientRequest') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT UQ_Plants_CreateClientRequest UNIQUE (CreateClientRequestId);
GO

IF OBJECT_ID(N'plant.UQ_Plants_User_Plant') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT UQ_Plants_User_Plant UNIQUE (UserId, PlantId);
GO

IF OBJECT_ID(N'plant.PK_PlantCheckIns') IS NULL
    ALTER TABLE plant.PlantCheckIns ADD CONSTRAINT PK_PlantCheckIns PRIMARY KEY CLUSTERED (CheckInId);
GO

IF OBJECT_ID(N'plant.UQ_PlantCheckIns_Plant_Day') IS NULL
    ALTER TABLE plant.PlantCheckIns ADD CONSTRAINT UQ_PlantCheckIns_Plant_Day UNIQUE (PlantId, CheckInLocalDate);
GO

IF OBJECT_ID(N'plant.UQ_PlantCheckIns_Plant_CheckIn') IS NULL
    ALTER TABLE plant.PlantCheckIns ADD CONSTRAINT UQ_PlantCheckIns_Plant_CheckIn UNIQUE (PlantId, CheckInId);
GO

IF OBJECT_ID(N'plant.PK_PlantPhotos') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT PK_PlantPhotos PRIMARY KEY CLUSTERED (PhotoId);
GO

IF OBJECT_ID(N'plant.UQ_PlantPhotos_ClientRequest') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT UQ_PlantPhotos_ClientRequest UNIQUE (ClientRequestId);
GO

IF OBJECT_ID(N'plant.UQ_PlantPhotos_StorageObjectKey') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT UQ_PlantPhotos_StorageObjectKey UNIQUE (StorageObjectKey);
GO

IF OBJECT_ID(N'plant.UQ_PlantPhotos_Plant_Photo') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT UQ_PlantPhotos_Plant_Photo UNIQUE (PlantId, PhotoId);
GO

IF OBJECT_ID(N'plant.PK_PlantAnalyses') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT PK_PlantAnalyses PRIMARY KEY CLUSTERED (AnalysisId);
GO

IF OBJECT_ID(N'plant.UQ_PlantAnalyses_Photo') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT UQ_PlantAnalyses_Photo UNIQUE (PhotoId);
GO

IF OBJECT_ID(N'plant.PK_PlantAnalysisActions') IS NULL
    ALTER TABLE plant.PlantAnalysisActions ADD CONSTRAINT PK_PlantAnalysisActions PRIMARY KEY CLUSTERED (AnalysisActionId);
GO

IF OBJECT_ID(N'plant.UQ_PlantAnalysisActions_Order') IS NULL
    ALTER TABLE plant.PlantAnalysisActions ADD CONSTRAINT UQ_PlantAnalysisActions_Order UNIQUE (AnalysisId, SortOrder);
GO

IF OBJECT_ID(N'plant.PK_PlantChibis') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT PK_PlantChibis PRIMARY KEY CLUSTERED (PlantChibiId);
GO

IF OBJECT_ID(N'game.PK_PetCatalog') IS NULL
    ALTER TABLE game.PetCatalog ADD CONSTRAINT PK_PetCatalog PRIMARY KEY CLUSTERED (PetId);
GO

IF OBJECT_ID(N'game.UQ_PetCatalog_Code') IS NULL
    ALTER TABLE game.PetCatalog ADD CONSTRAINT UQ_PetCatalog_Code UNIQUE (PetCode);
GO

IF OBJECT_ID(N'game.PK_PetLevelThresholds') IS NULL
    ALTER TABLE game.PetLevelThresholds ADD CONSTRAINT PK_PetLevelThresholds PRIMARY KEY CLUSTERED (LevelNumber);
GO

IF OBJECT_ID(N'game.UQ_PetLevelThresholds_Experience') IS NULL
    ALTER TABLE game.PetLevelThresholds ADD CONSTRAINT UQ_PetLevelThresholds_Experience UNIQUE (MinTotalExperience);
GO

IF OBJECT_ID(N'game.PK_UserPets') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT PK_UserPets PRIMARY KEY CLUSTERED (UserPetId);
GO

IF OBJECT_ID(N'game.UQ_UserPets_User_Pet') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT UQ_UserPets_User_Pet UNIQUE (UserId, PetId);
GO

IF OBJECT_ID(N'game.UQ_UserPets_User_UserPet') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT UQ_UserPets_User_UserPet UNIQUE (UserId, UserPetId);
GO

IF OBJECT_ID(N'game.PK_ItemCatalog') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT PK_ItemCatalog PRIMARY KEY CLUSTERED (ItemId);
GO

IF OBJECT_ID(N'game.UQ_ItemCatalog_Code') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT UQ_ItemCatalog_Code UNIQUE (ItemCode);
GO

IF OBJECT_ID(N'game.PK_UserItems') IS NULL
    ALTER TABLE game.UserItems ADD CONSTRAINT PK_UserItems PRIMARY KEY CLUSTERED (UserId, ItemId);
GO

IF OBJECT_ID(N'game.PK_PetFeedEvents') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT PK_PetFeedEvents PRIMARY KEY CLUSTERED (PetFeedEventId);
GO

IF OBJECT_ID(N'game.UQ_PetFeedEvents_ClientRequest') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT UQ_PetFeedEvents_ClientRequest UNIQUE (ClientRequestId);
GO

IF OBJECT_ID(N'game.PK_ArHunts') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT PK_ArHunts PRIMARY KEY CLUSTERED (ArHuntId);
GO

IF OBJECT_ID(N'game.UQ_ArHunts_User_Day') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT UQ_ArHunts_User_Day UNIQUE (UserId, HuntLocalDate);
GO

IF OBJECT_ID(N'game.UQ_ArHunts_ClientRequest') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT UQ_ArHunts_ClientRequest UNIQUE (ClientRequestId);
GO

