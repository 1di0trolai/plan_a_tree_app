/*
 * Áp dụng các giá trị mặc định có tên cho cột; không cập nhật hoặc đặt lại dữ liệu hiện có.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

IF OBJECT_ID(N'auth.DF_Users_UserId') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT DF_Users_UserId DEFAULT NEWSEQUENTIALID() FOR UserId;
GO

IF OBJECT_ID(N'auth.DF_Users_AuthProviderCode') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT DF_Users_AuthProviderCode DEFAULT ('LOCAL') FOR AuthProviderCode;
GO

IF OBJECT_ID(N'auth.DF_Users_IsActive') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT DF_Users_IsActive DEFAULT (1) FOR IsActive;
GO

IF OBJECT_ID(N'auth.DF_Users_CreatedAtUtc') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT DF_Users_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'auth.DF_Users_UpdatedAtUtc') IS NULL
    ALTER TABLE auth.Users ADD CONSTRAINT DF_Users_UpdatedAtUtc DEFAULT SYSUTCDATETIME() FOR UpdatedAtUtc;
GO

IF OBJECT_ID(N'auth.DF_RefreshTokens_Id') IS NULL
    ALTER TABLE auth.RefreshTokens ADD CONSTRAINT DF_RefreshTokens_Id DEFAULT NEWSEQUENTIALID() FOR RefreshTokenId;
GO

IF OBJECT_ID(N'auth.DF_RefreshTokens_CreatedAtUtc') IS NULL
    ALTER TABLE auth.RefreshTokens ADD CONSTRAINT DF_RefreshTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'auth.DF_UserActionTokens_Id') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT DF_UserActionTokens_Id DEFAULT NEWSEQUENTIALID() FOR UserActionTokenId;
GO

IF OBJECT_ID(N'auth.DF_UserActionTokens_CreatedAtUtc') IS NULL
    ALTER TABLE auth.UserActionTokens ADD CONSTRAINT DF_UserActionTokens_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'app.DF_UserProfiles_Title') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT DF_UserProfiles_Title DEFAULT (N'Người yêu cây') FOR ProfileTitle;
GO

IF OBJECT_ID(N'app.DF_UserProfiles_AvatarEmoji') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT DF_UserProfiles_AvatarEmoji DEFAULT (N'🧑‍🌾') FOR AvatarEmoji;
GO

IF OBJECT_ID(N'app.DF_UserProfiles_CreatedAtUtc') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT DF_UserProfiles_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'app.DF_UserProfiles_UpdatedAtUtc') IS NULL
    ALTER TABLE app.UserProfiles ADD CONSTRAINT DF_UserProfiles_UpdatedAtUtc DEFAULT SYSUTCDATETIME() FOR UpdatedAtUtc;
GO

IF OBJECT_ID(N'app.DF_UserSettings_Notifications') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_Notifications DEFAULT (1) FOR NotificationsEnabled;
GO

IF OBJECT_ID(N'app.DF_UserSettings_ReminderTime') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_ReminderTime DEFAULT ('08:00') FOR ReminderLocalTime;
GO

IF OBJECT_ID(N'app.DF_UserSettings_TimeZone') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_TimeZone DEFAULT (N'SE Asia Standard Time') FOR TimeZoneId;
GO

IF OBJECT_ID(N'app.DF_UserSettings_LightAr') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_LightAr DEFAULT (0) FOR LightArEnabled;
GO

IF OBJECT_ID(N'app.DF_UserSettings_Music') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_Music DEFAULT (1) FOR MusicEnabled;
GO

IF OBJECT_ID(N'app.DF_UserSettings_AiTone') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_AiTone DEFAULT ('FUNNY') FOR AiToneCode;
GO

IF OBJECT_ID(N'app.DF_UserSettings_BattleNotify') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_BattleNotify DEFAULT (0) FOR BattleNotifyEnabled;
GO

IF OBJECT_ID(N'app.DF_UserSettings_UpdatedAtUtc') IS NULL
    ALTER TABLE app.UserSettings ADD CONSTRAINT DF_UserSettings_UpdatedAtUtc DEFAULT SYSUTCDATETIME() FOR UpdatedAtUtc;
GO

IF OBJECT_ID(N'plant.DF_Plants_PlantId') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_PlantId DEFAULT NEWSEQUENTIALID() FOR PlantId;
GO

IF OBJECT_ID(N'plant.DF_Plants_CreateClientRequestId') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_CreateClientRequestId DEFAULT NEWID() FOR CreateClientRequestId;
GO

IF OBJECT_ID(N'plant.DF_Plants_Stage') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_Stage DEFAULT ('SEEDLING') FOR StageCode;
GO

IF OBJECT_ID(N'plant.DF_Plants_Progress') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_Progress DEFAULT (0) FOR ProgressPercent;
GO

IF OBJECT_ID(N'plant.DF_Plants_Health') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_Health DEFAULT (N'Chưa đánh giá') FOR HealthStatus;
GO

IF OBJECT_ID(N'plant.DF_Plants_Mood') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_Mood DEFAULT (N'Đang chờ ảnh đầu tiên') FOR MoodText;
GO

IF OBJECT_ID(N'plant.DF_Plants_CurrentStreak') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_CurrentStreak DEFAULT (0) FOR CurrentStreak;
GO

IF OBJECT_ID(N'plant.DF_Plants_BestStreak') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_BestStreak DEFAULT (0) FOR BestStreak;
GO

IF OBJECT_ID(N'plant.DF_Plants_HistoryComplete') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_HistoryComplete DEFAULT (1) FOR HistoryComplete;
GO

IF OBJECT_ID(N'plant.DF_Plants_CreatedAtUtc') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'plant.DF_Plants_UpdatedAtUtc') IS NULL
    ALTER TABLE plant.Plants ADD CONSTRAINT DF_Plants_UpdatedAtUtc DEFAULT SYSUTCDATETIME() FOR UpdatedAtUtc;
GO

IF OBJECT_ID(N'plant.DF_PlantCheckIns_Id') IS NULL
    ALTER TABLE plant.PlantCheckIns ADD CONSTRAINT DF_PlantCheckIns_Id DEFAULT NEWSEQUENTIALID() FOR CheckInId;
GO

IF OBJECT_ID(N'plant.DF_PlantCheckIns_CreatedAtUtc') IS NULL
    ALTER TABLE plant.PlantCheckIns ADD CONSTRAINT DF_PlantCheckIns_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'plant.DF_PlantPhotos_Id') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT DF_PlantPhotos_Id DEFAULT NEWSEQUENTIALID() FOR PhotoId;
GO

IF OBJECT_ID(N'plant.DF_PlantPhotos_CountsForStreak') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT DF_PlantPhotos_CountsForStreak DEFAULT (0) FOR CountsForStreak;
GO

IF OBJECT_ID(N'plant.DF_PlantPhotos_CreatedAtUtc') IS NULL
    ALTER TABLE plant.PlantPhotos ADD CONSTRAINT DF_PlantPhotos_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'plant.DF_PlantAnalyses_Id') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT DF_PlantAnalyses_Id DEFAULT NEWSEQUENTIALID() FOR AnalysisId;
GO

IF OBJECT_ID(N'plant.DF_PlantAnalyses_Status') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT DF_PlantAnalyses_Status DEFAULT ('PENDING') FOR StatusCode;
GO

IF OBJECT_ID(N'plant.DF_PlantAnalyses_CreatedAtUtc') IS NULL
    ALTER TABLE plant.PlantAnalyses ADD CONSTRAINT DF_PlantAnalyses_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'plant.DF_PlantChibis_Id') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT DF_PlantChibis_Id DEFAULT NEWSEQUENTIALID() FOR PlantChibiId;
GO

IF OBJECT_ID(N'plant.DF_PlantChibis_Status') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT DF_PlantChibis_Status DEFAULT ('PENDING') FOR StatusCode;
GO

IF OBJECT_ID(N'plant.DF_PlantChibis_Style') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT DF_PlantChibis_Style DEFAULT ('PAT_CHIBI_V1') FOR StyleCode;
GO

IF OBJECT_ID(N'plant.DF_PlantChibis_Emoji') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT DF_PlantChibis_Emoji DEFAULT (N'🪴') FOR FallbackEmoji;
GO

IF OBJECT_ID(N'plant.DF_PlantChibis_IsCurrent') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT DF_PlantChibis_IsCurrent DEFAULT (1) FOR IsCurrent;
GO

IF OBJECT_ID(N'plant.DF_PlantChibis_CreatedAtUtc') IS NULL
    ALTER TABLE plant.PlantChibis ADD CONSTRAINT DF_PlantChibis_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'game.DF_PetCatalog_IsActive') IS NULL
    ALTER TABLE game.PetCatalog ADD CONSTRAINT DF_PetCatalog_IsActive DEFAULT (1) FOR IsActive;
GO

IF OBJECT_ID(N'game.DF_PetCatalog_CreatedAtUtc') IS NULL
    ALTER TABLE game.PetCatalog ADD CONSTRAINT DF_PetCatalog_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'game.DF_UserPets_Id') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_Id DEFAULT NEWSEQUENTIALID() FOR UserPetId;
GO

IF OBJECT_ID(N'game.DF_UserPets_Quantity') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_Quantity DEFAULT (1) FOR Quantity;
GO

IF OBJECT_ID(N'game.DF_UserPets_Level') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_Level DEFAULT (1) FOR LevelNumber;
GO

IF OBJECT_ID(N'game.DF_UserPets_Experience') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_Experience DEFAULT (0) FOR TotalExperience;
GO

IF OBJECT_ID(N'game.DF_UserPets_IsCompanion') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_IsCompanion DEFAULT (0) FOR IsCompanion;
GO

IF OBJECT_ID(N'game.DF_UserPets_FirstCaughtAtUtc') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_FirstCaughtAtUtc DEFAULT SYSUTCDATETIME() FOR FirstCaughtAtUtc;
GO

IF OBJECT_ID(N'game.DF_UserPets_UpdatedAtUtc') IS NULL
    ALTER TABLE game.UserPets ADD CONSTRAINT DF_UserPets_UpdatedAtUtc DEFAULT SYSUTCDATETIME() FOR UpdatedAtUtc;
GO

IF OBJECT_ID(N'game.DF_ItemCatalog_ExpGain') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT DF_ItemCatalog_ExpGain DEFAULT (0) FOR ExperienceGain;
GO

IF OBJECT_ID(N'game.DF_ItemCatalog_IsActive') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT DF_ItemCatalog_IsActive DEFAULT (1) FOR IsActive;
GO

IF OBJECT_ID(N'game.DF_ItemCatalog_CreatedAtUtc') IS NULL
    ALTER TABLE game.ItemCatalog ADD CONSTRAINT DF_ItemCatalog_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'game.DF_UserItems_Quantity') IS NULL
    ALTER TABLE game.UserItems ADD CONSTRAINT DF_UserItems_Quantity DEFAULT (0) FOR Quantity;
GO

IF OBJECT_ID(N'game.DF_UserItems_UpdatedAtUtc') IS NULL
    ALTER TABLE game.UserItems ADD CONSTRAINT DF_UserItems_UpdatedAtUtc DEFAULT SYSUTCDATETIME() FOR UpdatedAtUtc;
GO

IF OBJECT_ID(N'game.DF_PetFeedEvents_Id') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT DF_PetFeedEvents_Id DEFAULT NEWSEQUENTIALID() FOR PetFeedEventId;
GO

IF OBJECT_ID(N'game.DF_PetFeedEvents_Quantity') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT DF_PetFeedEvents_Quantity DEFAULT (1) FOR QuantityUsed;
GO

IF OBJECT_ID(N'game.DF_PetFeedEvents_CreatedAtUtc') IS NULL
    ALTER TABLE game.PetFeedEvents ADD CONSTRAINT DF_PetFeedEvents_CreatedAtUtc DEFAULT SYSUTCDATETIME() FOR CreatedAtUtc;
GO

IF OBJECT_ID(N'game.DF_ArHunts_Id') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT DF_ArHunts_Id DEFAULT NEWSEQUENTIALID() FOR ArHuntId;
GO

IF OBJECT_ID(N'game.DF_ArHunts_StartedAtUtc') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT DF_ArHunts_StartedAtUtc DEFAULT SYSUTCDATETIME() FOR StartedAtUtc;
GO

IF OBJECT_ID(N'game.DF_ArHunts_CompletedAtUtc') IS NULL
    ALTER TABLE game.ArHunts ADD CONSTRAINT DF_ArHunts_CompletedAtUtc DEFAULT SYSUTCDATETIME() FOR CompletedAtUtc;
GO

