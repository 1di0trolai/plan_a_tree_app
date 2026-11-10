/*
 * Định nghĩa thủ tục cập nhật hồ sơ và thiết lập người dùng trong schema app.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

CREATE OR ALTER PROCEDURE app.usp_UpdateUserProfile
    @UserId            UNIQUEIDENTIFIER,
    @DisplayName       NVARCHAR(80),
    @ProfileTitle      NVARCHAR(120),
    @AvatarEmoji       NVARCHAR(16),
    @AvatarStorageKey  NVARCHAR(512) = NULL,
    @AvatarPublicUrl   NVARCHAR(2048) = NULL,
    @ExpectedRowVersion BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF LEN(LTRIM(RTRIM(@DisplayName))) < 2
        THROW 50910, 'INVALID_DISPLAY_NAME', 1;
    IF @AvatarStorageKey LIKE N'file://%' OR @AvatarStorageKey LIKE N'data:%'
        THROW 50911, 'LOCAL_IMAGE_URI_NOT_ALLOWED', 1;

    UPDATE app.UserProfiles
    SET DisplayName = LTRIM(RTRIM(@DisplayName)),
        ProfileTitle = @ProfileTitle,
        AvatarEmoji = @AvatarEmoji,
        AvatarStorageKey = @AvatarStorageKey,
        AvatarPublicUrl = @AvatarPublicUrl,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND (@ExpectedRowVersion IS NULL OR RowVersion = @ExpectedRowVersion);

    IF @@ROWCOUNT = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM app.UserProfiles WHERE UserId = @UserId)
            THROW 50912, 'PROFILE_CONCURRENCY_CONFLICT', 1;
        THROW 50913, 'PROFILE_NOT_FOUND', 1;
    END;

    SELECT 'PROFILE_UPDATED' AS ResultCode, UserId, RowVersion
    FROM app.UserProfiles WHERE UserId = @UserId;
END;
GO

CREATE OR ALTER PROCEDURE app.usp_UpdateUserSettings
    @UserId                UNIQUEIDENTIFIER,
    @NotificationsEnabled BIT,
    @ReminderLocalTime     TIME(0),
    @TimeZoneId            SYSNAME,
    @LightArEnabled        BIT,
    @MusicEnabled          BIT,
    @AiToneCode            VARCHAR(16),
    @BattleNotifyEnabled   BIT,
    @ExpectedRowVersion    BINARY(8) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @AiToneCode NOT IN ('FUNNY', 'GENTLE', 'EXPERT', 'MINIMAL')
        THROW 50914, 'INVALID_AI_TONE', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.time_zone_info WHERE name = @TimeZoneId)
        THROW 50904, 'INVALID_TIME_ZONE', 1;

    UPDATE app.UserSettings
    SET NotificationsEnabled = @NotificationsEnabled,
        ReminderLocalTime = @ReminderLocalTime,
        TimeZoneId = @TimeZoneId,
        LightArEnabled = @LightArEnabled,
        MusicEnabled = @MusicEnabled,
        AiToneCode = @AiToneCode,
        BattleNotifyEnabled = @BattleNotifyEnabled,
        UpdatedAtUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND (@ExpectedRowVersion IS NULL OR RowVersion = @ExpectedRowVersion);

    IF @@ROWCOUNT = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM app.UserSettings WHERE UserId = @UserId)
            THROW 50915, 'SETTINGS_CONCURRENCY_CONFLICT', 1;
        THROW 50916, 'SETTINGS_NOT_FOUND', 1;
    END;

    SELECT 'SETTINGS_UPDATED' AS ResultCode, UserId, RowVersion
    FROM app.UserSettings WHERE UserId = @UserId;
END;
GO

