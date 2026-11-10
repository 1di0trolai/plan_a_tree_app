/*
 * Định nghĩa thủ tục tài khoản, phiên đăng nhập và khôi phục mật khẩu trong schema auth.
 * Thuộc bộ schema nền tảng; chạy theo thứ tự trong 01_pat_schema.sql.
 */

USE [PAT];
GO

CREATE OR ALTER PROCEDURE auth.usp_RegisterLocalUser
    @Email               NVARCHAR(320),
    @PasswordHash        NVARCHAR(500),
    @PasswordHashVersion SMALLINT,
    @DisplayName         NVARCHAR(80),
    @TimeZoneId          SYSNAME = N'SE Asia Standard Time',
    @UserId              UNIQUEIDENTIFIER OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NormalizedEmail NVARCHAR(320) = UPPER(LTRIM(RTRIM(@Email)));
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    IF LEN(@NormalizedEmail) < 3 OR CHARINDEX(N'@', @NormalizedEmail) <= 1
        THROW 50901, 'INVALID_EMAIL', 1;
    IF LEN(LTRIM(RTRIM(@PasswordHash))) = 0
        THROW 50902, 'INVALID_PASSWORD_HASH', 1;
    IF LEN(LTRIM(RTRIM(@DisplayName))) < 2
        THROW 50903, 'INVALID_DISPLAY_NAME', 1;
    IF NOT EXISTS (SELECT 1 FROM sys.time_zone_info WHERE name = @TimeZoneId)
        THROW 50904, 'INVALID_TIME_ZONE', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION RegisterLocalUserSave;

        IF EXISTS
        (
            SELECT 1
            FROM auth.Users WITH (UPDLOCK, HOLDLOCK)
            WHERE NormalizedEmail = @NormalizedEmail AND DeletedAtUtc IS NULL
        )
            THROW 50905, 'EMAIL_ALREADY_EXISTS', 1;

        DECLARE @NewUser TABLE (UserId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.Users
        (
            Email, NormalizedEmail, PasswordHash, PasswordHashVersion,
            AuthProviderCode, IsActive
        )
            OUTPUT inserted.UserId INTO @NewUser
        VALUES
        (
            LTRIM(RTRIM(@Email)), @NormalizedEmail, @PasswordHash,
            @PasswordHashVersion, 'LOCAL', 1
        );
        SELECT @UserId = UserId FROM @NewUser;

        INSERT app.UserProfiles (UserId, DisplayName)
        VALUES (@UserId, LTRIM(RTRIM(@DisplayName)));

        INSERT app.UserSettings (UserId, TimeZoneId)
        VALUES (@UserId, @TimeZoneId);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'USER_REGISTERED' AS ResultCode, @UserId AS UserId;
    END TRY
    BEGIN CATCH
        DECLARE @ErrorNumber INT = ERROR_NUMBER();
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION RegisterLocalUserSave;

        IF @ErrorNumber IN (2601, 2627)
            THROW 50905, 'EMAIL_ALREADY_EXISTS', 1;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_GetLoginCredential
    @Identity NVARCHAR(320)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @NormalizedIdentity NVARCHAR(320) = UPPER(LTRIM(RTRIM(@Identity)));

    SELECT TOP (1)
        UserId,
        Email,
        PhoneE164,
        PasswordHash,
        PasswordHashVersion,
        EmailConfirmedAtUtc,
        LastLoginAtUtc,
        RowVersion
    FROM auth.Users
    WHERE IsActive = 1
      AND DeletedAtUtc IS NULL
      AND AuthProviderCode = 'LOCAL'
      AND
      (
          NormalizedEmail = @NormalizedIdentity
          OR PhoneE164 = CONVERT(VARCHAR(20), LTRIM(RTRIM(@Identity)))
      );
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_IssueRefreshToken
    @UserId      UNIQUEIDENTIFIER,
    @TokenHash   BINARY(32),
    @ExpiresAtUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    IF @ExpiresAtUtc <= @NowUtc OR @ExpiresAtUtc > DATEADD(DAY, 90, @NowUtc)
        THROW 50908, 'INVALID_REFRESH_TOKEN_EXPIRY', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION IssueRefreshTokenSave;

        IF NOT EXISTS
        (
            SELECT 1 FROM auth.Users WITH (UPDLOCK, HOLDLOCK)
            WHERE UserId = @UserId AND IsActive = 1 AND DeletedAtUtc IS NULL
        )
            THROW 50924, 'USER_NOT_FOUND', 1;

        DECLARE @NewToken TABLE (RefreshTokenId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.RefreshTokens (UserId, TokenHash, ExpiresAtUtc)
            OUTPUT inserted.RefreshTokenId INTO @NewToken
        VALUES (@UserId, @TokenHash, @ExpiresAtUtc);

        UPDATE auth.Users
        SET LastLoginAtUtc = @NowUtc,
            UpdatedAtUtc = @NowUtc
        WHERE UserId = @UserId;

        DECLARE @RefreshTokenId UNIQUEIDENTIFIER = (SELECT RefreshTokenId FROM @NewToken);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'REFRESH_TOKEN_ISSUED' AS ResultCode, @RefreshTokenId AS RefreshTokenId,
               @UserId AS UserId, @ExpiresAtUtc AS ExpiresAtUtc;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION IssueRefreshTokenSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_RotateRefreshToken
    @CurrentTokenHash BINARY(32),
    @NewTokenHash     BINARY(32),
    @NewExpiresAtUtc  DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @StartTranCount INT = @@TRANCOUNT;
    DECLARE @UserId UNIQUEIDENTIFIER;
    DECLARE @CurrentRefreshTokenId UNIQUEIDENTIFIER;

    IF @NewExpiresAtUtc <= @NowUtc OR @NewExpiresAtUtc > DATEADD(DAY, 90, @NowUtc)
        THROW 50908, 'INVALID_REFRESH_TOKEN_EXPIRY', 1;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION RotateRefreshTokenSave;

        SELECT
            @CurrentRefreshTokenId = token.RefreshTokenId,
            @UserId = token.UserId
        FROM auth.RefreshTokens AS token WITH (UPDLOCK, HOLDLOCK)
        JOIN auth.Users AS userAccount ON userAccount.UserId = token.UserId
        WHERE token.TokenHash = @CurrentTokenHash
          AND token.ExpiresAtUtc > @NowUtc
          AND token.RevokedAtUtc IS NULL
          AND userAccount.IsActive = 1
          AND userAccount.DeletedAtUtc IS NULL;

        IF @CurrentRefreshTokenId IS NULL
            THROW 50909, 'REFRESH_TOKEN_INVALID_OR_EXPIRED', 1;

        UPDATE auth.RefreshTokens
        SET RevokedAtUtc = @NowUtc,
            ReplacedByHash = @NewTokenHash
        WHERE RefreshTokenId = @CurrentRefreshTokenId;

        DECLARE @NewToken TABLE (RefreshTokenId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.RefreshTokens (UserId, TokenHash, ExpiresAtUtc)
            OUTPUT inserted.RefreshTokenId INTO @NewToken
        VALUES (@UserId, @NewTokenHash, @NewExpiresAtUtc);

        DECLARE @NewRefreshTokenId UNIQUEIDENTIFIER = (SELECT RefreshTokenId FROM @NewToken);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'REFRESH_TOKEN_ROTATED' AS ResultCode,
               @NewRefreshTokenId AS RefreshTokenId,
               @UserId AS UserId,
               @NewExpiresAtUtc AS ExpiresAtUtc;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION RotateRefreshTokenSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_RevokeRefreshToken
    @UserId    UNIQUEIDENTIFIER,
    @TokenHash BINARY(32)
AS
BEGIN
    SET NOCOUNT ON;

    UPDATE auth.RefreshTokens
    SET RevokedAtUtc = SYSUTCDATETIME()
    WHERE UserId = @UserId
      AND TokenHash = @TokenHash
      AND RevokedAtUtc IS NULL;

    SELECT 'REFRESH_TOKEN_REVOKED' AS ResultCode;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_CreatePasswordResetToken
    @Identity     NVARCHAR(320),
    @TokenHash    BINARY(32),
    @ExpiresAtUtc DATETIME2(3)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @UserId UNIQUEIDENTIFIER;
    DECLARE @Email NVARCHAR(320);
    DECLARE @StartTranCount INT = @@TRANCOUNT;
    DECLARE @NormalizedIdentity NVARCHAR(320) = UPPER(LTRIM(RTRIM(@Identity)));

    IF @ExpiresAtUtc <= @NowUtc OR @ExpiresAtUtc > DATEADD(DAY, 1, @NowUtc)
        THROW 50906, 'INVALID_TOKEN_EXPIRY', 1;

    SELECT TOP (1)
        @UserId = UserId,
        @Email = Email
    FROM auth.Users
    WHERE IsActive = 1
      AND DeletedAtUtc IS NULL
      AND AuthProviderCode = 'LOCAL'
      AND
      (
          NormalizedEmail = @NormalizedIdentity
          OR PhoneE164 = CONVERT(VARCHAR(20), LTRIM(RTRIM(@Identity)))
      );

    /* The API must always return the same public message, including this case. */
    IF @UserId IS NULL
    BEGIN
        SELECT 'RESET_REQUEST_ACCEPTED' AS ResultCode, CAST(0 AS BIT) AS ShouldSend,
               CAST(NULL AS UNIQUEIDENTIFIER) AS UserActionTokenId,
               CAST(NULL AS NVARCHAR(320)) AS RecoveryEmail;
        RETURN;
    END;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION CreatePasswordResetSave;

        UPDATE auth.UserActionTokens
        SET RevokedAtUtc = @NowUtc
        WHERE UserId = @UserId
          AND PurposeCode = 'RESET_PASSWORD'
          AND ConsumedAtUtc IS NULL
          AND RevokedAtUtc IS NULL;

        DECLARE @NewToken TABLE (UserActionTokenId UNIQUEIDENTIFIER NOT NULL);
        INSERT auth.UserActionTokens (UserId, PurposeCode, TokenHash, ExpiresAtUtc)
            OUTPUT inserted.UserActionTokenId INTO @NewToken
        VALUES (@UserId, 'RESET_PASSWORD', @TokenHash, @ExpiresAtUtc);

        DECLARE @UserActionTokenId UNIQUEIDENTIFIER = (SELECT UserActionTokenId FROM @NewToken);

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'RESET_REQUEST_ACCEPTED' AS ResultCode, CAST(1 AS BIT) AS ShouldSend,
               @UserActionTokenId AS UserActionTokenId, @Email AS RecoveryEmail;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION CreatePasswordResetSave;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE auth.usp_ResetPassword
    @TokenHash              BINARY(32),
    @NewPasswordHash        NVARCHAR(500),
    @PasswordHashVersion    SMALLINT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF LEN(LTRIM(RTRIM(@NewPasswordHash))) = 0
        THROW 50902, 'INVALID_PASSWORD_HASH', 1;

    DECLARE @NowUtc DATETIME2(3) = SYSUTCDATETIME();
    DECLARE @UserId UNIQUEIDENTIFIER;
    DECLARE @UserActionTokenId UNIQUEIDENTIFIER;
    DECLARE @StartTranCount INT = @@TRANCOUNT;

    BEGIN TRY
        IF @StartTranCount = 0
            BEGIN TRANSACTION;
        ELSE
            SAVE TRANSACTION ResetPasswordSave;

        SELECT
            @UserActionTokenId = token.UserActionTokenId,
            @UserId = token.UserId
        FROM auth.UserActionTokens AS token WITH (UPDLOCK, HOLDLOCK)
        JOIN auth.Users AS userAccount ON userAccount.UserId = token.UserId
        WHERE token.TokenHash = @TokenHash
          AND token.PurposeCode = 'RESET_PASSWORD'
          AND token.ConsumedAtUtc IS NULL
          AND token.RevokedAtUtc IS NULL
          AND token.ExpiresAtUtc > @NowUtc
          AND userAccount.IsActive = 1
          AND userAccount.DeletedAtUtc IS NULL;

        IF @UserActionTokenId IS NULL
            THROW 50907, 'RESET_TOKEN_INVALID_OR_EXPIRED', 1;

        UPDATE auth.Users
        SET PasswordHash = @NewPasswordHash,
            PasswordHashVersion = @PasswordHashVersion,
            UpdatedAtUtc = @NowUtc
        WHERE UserId = @UserId;

        UPDATE auth.UserActionTokens
        SET ConsumedAtUtc = @NowUtc
        WHERE UserActionTokenId = @UserActionTokenId;

        UPDATE auth.UserActionTokens
        SET RevokedAtUtc = @NowUtc
        WHERE UserId = @UserId
          AND PurposeCode = 'RESET_PASSWORD'
          AND UserActionTokenId <> @UserActionTokenId
          AND ConsumedAtUtc IS NULL
          AND RevokedAtUtc IS NULL;

        UPDATE auth.RefreshTokens
        SET RevokedAtUtc = @NowUtc
        WHERE UserId = @UserId AND RevokedAtUtc IS NULL;

        IF @StartTranCount = 0 COMMIT TRANSACTION;

        SELECT 'PASSWORD_RESET' AS ResultCode, @UserId AS UserId;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 AND @StartTranCount = 0
            ROLLBACK TRANSACTION;
        ELSE IF XACT_STATE() = 1
            ROLLBACK TRANSACTION ResetPasswordSave;
        THROW;
    END CATCH;
END;
GO

