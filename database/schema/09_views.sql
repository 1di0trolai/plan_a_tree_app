/*
 * Định nghĩa các view đọc hồ sơ, khu vườn, kho và lịch sử từ dữ liệu SQL nền tảng.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

CREATE OR ALTER VIEW app.vw_UserProfileSettings
AS
    SELECT
        u.UserId,
        u.Email,
        u.PhoneE164,
        p.DisplayName,
        p.ProfileTitle,
        p.AvatarEmoji,
        p.AvatarStorageKey,
        p.AvatarPublicUrl,
        s.NotificationsEnabled,
        s.ReminderLocalTime,
        s.TimeZoneId,
        s.LightArEnabled,
        s.MusicEnabled,
        s.AiToneCode,
        s.BattleNotifyEnabled
    FROM auth.Users AS u
    JOIN app.UserProfiles AS p ON p.UserId = u.UserId
    JOIN app.UserSettings AS s ON s.UserId = u.UserId
    WHERE u.IsActive = 1 AND u.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW plant.vw_PlantDashboard
AS
    SELECT
        p.PlantId,
        p.UserId,
        p.PlantName,
        p.SpeciesName,
        p.PlantedOn,
        p.StageCode,
        p.ProgressPercent,
        p.HealthStatus,
        p.MoodText,
        p.CurrentStreak,
        p.BestStreak,
        p.LastCheckInLocalDate,
        p.HistoryComplete,
        c.PlantChibiId,
        c.StatusCode AS ChibiStatusCode,
        c.FallbackEmoji,
        c.ImageStorageObjectKey AS ChibiStorageObjectKey,
        c.ImagePublicUrl AS ChibiPublicUrl,
        latest.PhotoId AS LatestPhotoId,
        latest.StorageObjectKey AS LatestPhotoStorageObjectKey,
        latest.PublicUrl AS LatestPhotoPublicUrl,
        latest.AnalysisId AS LatestAnalysisId,
        latest.AnalysisStatusCode,
        latest.LevelCode AS LatestAnalysisLevelCode,
        latest.Title AS LatestAnalysisTitle,
        latest.Summary AS LatestAnalysisSummary,
        p.RowVersion
    FROM plant.Plants AS p
    OUTER APPLY
    (
        SELECT TOP (1) pc.*
        FROM plant.PlantChibis AS pc
        WHERE pc.PlantId = p.PlantId AND pc.IsCurrent = 1
    ) AS c
    OUTER APPLY
    (
        SELECT TOP (1)
            ph.PhotoId,
            ph.StorageObjectKey,
            ph.PublicUrl,
            a.AnalysisId,
            a.StatusCode AS AnalysisStatusCode,
            a.LevelCode,
            a.Title,
            a.Summary
        FROM plant.PlantPhotos AS ph
        LEFT JOIN plant.PlantAnalyses AS a ON a.PhotoId = ph.PhotoId
        WHERE ph.PlantId = p.PlantId AND ph.DeletedAtUtc IS NULL
        ORDER BY ph.CreatedAtUtc DESC, ph.PhotoId DESC
    ) AS latest
    WHERE p.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW game.vw_UserPetCollection
AS
    SELECT
        up.UserPetId,
        up.UserId,
        pc.PetId,
        pc.PetCode,
        pc.DisplayName,
        pc.IconEmoji,
        pc.RarityCode,
        pc.ElementCode,
        pc.RoleCode,
        pc.BuffText,
        pc.DiscoveryHint,
        up.Quantity,
        up.LevelNumber,
        up.TotalExperience,
        up.TotalExperience - currentLevel.MinTotalExperience AS ExperienceInCurrentLevel,
        nextLevel.MinTotalExperience - currentLevel.MinTotalExperience AS ExperienceRequiredForLevel,
        nextLevel.MinTotalExperience AS NextLevelExperience,
        up.IsCompanion,
        up.RowVersion
    FROM game.UserPets AS up
    JOIN game.PetCatalog AS pc ON pc.PetId = up.PetId
    JOIN game.PetLevelThresholds AS currentLevel ON currentLevel.LevelNumber = up.LevelNumber
    LEFT JOIN game.PetLevelThresholds AS nextLevel ON nextLevel.LevelNumber = up.LevelNumber + 1;
GO

CREATE OR ALTER VIEW game.vw_UserItemInventory
AS
    SELECT
        ui.UserId,
        ic.ItemId,
        ic.ItemCode,
        ic.DisplayName,
        ic.IconEmoji,
        ic.RarityCode,
        ic.CategoryCode,
        ic.ExperienceGain,
        ic.Description,
        ui.Quantity,
        ui.RowVersion
    FROM game.UserItems AS ui
    JOIN game.ItemCatalog AS ic ON ic.ItemId = ui.ItemId
    WHERE ic.IsActive = 1;
GO

CREATE OR ALTER VIEW game.vw_PetCatalog
AS
    SELECT
        PetId,
        PetCode,
        DisplayName,
        IconEmoji,
        RarityCode,
        ElementCode,
        RoleCode,
        BuffText,
        DiscoveryHint
    FROM game.PetCatalog
    WHERE IsActive = 1;
GO

CREATE OR ALTER VIEW game.vw_ItemCatalog
AS
    SELECT
        ItemId,
        ItemCode,
        DisplayName,
        IconEmoji,
        RarityCode,
        CategoryCode,
        ExperienceGain,
        Description
    FROM game.ItemCatalog
    WHERE IsActive = 1;
GO

CREATE OR ALTER VIEW plant.vw_PlantCheckInHistory
AS
    SELECT
        p.UserId,
        p.PlantId,
        p.PlantName,
        ci.CheckInId,
        ci.CheckInLocalDate,
        ph.PhotoId,
        ph.CountsForStreak,
        ph.StorageObjectKey,
        ph.PublicUrl,
        ph.CaptureSourceCode,
        ph.MimeType,
        ph.WidthPixels,
        ph.HeightPixels,
        ph.FileSizeBytes,
        ph.CapturedAtUtc,
        a.AnalysisId,
        a.StatusCode AS AnalysisStatusCode,
        a.LevelCode,
        a.Title,
        a.Summary,
        a.Confidence,
        a.CreatedAtUtc AS AnalysisCreatedAtUtc,
        a.CompletedAtUtc AS AnalysisCompletedAtUtc
    FROM plant.Plants AS p
    JOIN plant.PlantCheckIns AS ci ON ci.PlantId = p.PlantId
    JOIN plant.PlantPhotos AS ph ON ph.CheckInId = ci.CheckInId AND ph.PlantId = p.PlantId
    LEFT JOIN plant.PlantAnalyses AS a ON a.PhotoId = ph.PhotoId
    WHERE p.DeletedAtUtc IS NULL AND ph.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW plant.vw_PlantAnalysisActionHistory
AS
    SELECT
        p.UserId,
        analysis.PlantId,
        analysis.PhotoId,
        analysis.AnalysisId,
        action.SortOrder,
        action.ActionText
    FROM plant.PlantAnalysisActions AS action
    JOIN plant.PlantAnalyses AS analysis ON analysis.AnalysisId = action.AnalysisId
    JOIN plant.Plants AS p ON p.PlantId = analysis.PlantId
    WHERE p.DeletedAtUtc IS NULL;
GO

CREATE OR ALTER VIEW game.vw_ArHuntHistory
AS
    SELECT
        hunt.UserId,
        hunt.ArHuntId,
        hunt.PlantId,
        plant.PlantName,
        hunt.HuntLocalDate,
        hunt.StatusCode,
        hunt.CapturedPetId,
        pet.PetCode AS CapturedPetCode,
        pet.DisplayName AS CapturedPetName,
        pet.IconEmoji AS CapturedPetIconEmoji,
        hunt.WasNewPet,
        hunt.StartedAtUtc,
        hunt.CompletedAtUtc
    FROM game.ArHunts AS hunt
    JOIN plant.Plants AS plant ON plant.PlantId = hunt.PlantId AND plant.UserId = hunt.UserId
    LEFT JOIN game.PetCatalog AS pet ON pet.PetId = hunt.CapturedPetId;
GO

