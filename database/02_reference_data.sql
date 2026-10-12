/*
    PAT required reference data
    Prerequisite: run 01_pat_schema.sql first.

    Run this in every environment. It contains only level rules and catalogs,
    never demo accounts or user progress.
*/

USE [PAT];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    /* The mobile formula is: EXP to next level = 100 + (level - 1) * 25. */
    ;WITH Levels AS
    (
        SELECT CAST(1 AS SMALLINT) AS LevelNumber
        UNION ALL
        SELECT CAST(LevelNumber + 1 AS SMALLINT)
        FROM Levels
        WHERE LevelNumber < 100
    )
    INSERT game.PetLevelThresholds (LevelNumber, MinTotalExperience)
    SELECT
        LevelNumber,
        CAST(LevelNumber - 1 AS BIGINT) * 100
            + CAST(25 AS BIGINT) * (LevelNumber - 1) * (LevelNumber - 2) / 2
    FROM Levels AS source
    WHERE NOT EXISTS
    (
        SELECT 1
        FROM game.PetLevelThresholds AS target
        WHERE target.LevelNumber = source.LevelNumber
    )
    OPTION (MAXRECURSION 100);

    INSERT game.PetCatalog
    (
        PetCode, DisplayName, IconEmoji, RarityCode, ElementCode,
        RoleCode, BuffText, DiscoveryHint
    )
    SELECT
        source.PetCode, source.DisplayName, source.IconEmoji, source.RarityCode,
        source.ElementCode, source.RoleCode, source.BuffText, source.DiscoveryHint
    FROM
    (
        VALUES
            ('ladybug',     N'Bọ Rùa Lửa',          N'🐞', 'RARE',      'FIRE',     'BATTLE',  N'+12% sức mạnh',   N'Xuất hiện quanh cây khỏe mạnh'),
            ('caterpillar',  N'Sâu Phàm Ăn',         N'🐛', 'COMMON',    'LEAF',     'SUPPORT', N'+5% tăng trưởng', N'Thích những tán lá xanh'),
            ('hunter-bee',   N'Ong Thợ Săn',         N'🐝', 'RARE',      'ELECTRIC', 'BATTLE',  N'+5% tốc độ',      N'Dễ gặp vào buổi sáng'),
            ('moon-moth',    N'Bướm Đêm Ánh Trăng', N'🦋', 'EPIC',      'WIND',     'SUPPORT', N'+15% may mắn',    N'Hãy quét AR cạnh cây vào chiều tối'),
            ('dew-snail',    N'Ốc Sên Giọt Sương',  N'🐌', 'COMMON',    'WATER',    'SUPPORT', N'+8% hồi phục',    N'Có thể xuất hiện khi cây vừa được tưới'),
            ('mantis',       N'Bọ Ngựa Hộ Vệ',       N'🦗', 'LEGENDARY', 'LEAF',     'BATTLE',  N'+20% phòng thủ',  N'Một sinh vật cực kỳ hiếm')
    ) AS source(PetCode, DisplayName, IconEmoji, RarityCode, ElementCode, RoleCode, BuffText, DiscoveryHint)
    WHERE NOT EXISTS
    (
        SELECT 1 FROM game.PetCatalog AS target WHERE target.PetCode = source.PetCode
    );

    INSERT game.ItemCatalog
    (
        ItemCode, DisplayName, IconEmoji, RarityCode, CategoryCode,
        ExperienceGain, Description
    )
    SELECT
        source.ItemCode, source.DisplayName, source.IconEmoji, source.RarityCode,
        source.CategoryCode, source.ExperienceGain, source.Description
    FROM
    (
        VALUES
            ('berry-bites',  N'Kẹo Quả Mọng',  N'🍓', 'COMMON', 'FOOD',  25, N'Một phần ăn nhẹ thơm ngọt, phù hợp với mọi pet.'),
            ('honey-cookie', N'Bánh Mật Ong',   N'🍯', 'RARE',   'FOOD',  60, N'Món bánh giàu năng lượng giúp pet lớn nhanh hơn.'),
            ('forest-milk',  N'Sữa Mầm Rừng',   N'🥛', 'RARE',   'FOOD',  90, N'Sữa dinh dưỡng đặc biệt dành cho những chuyến phiêu lưu dài.'),
            ('star-snack',   N'Bánh Sao',       N'⭐', 'EVENT',  'FOOD', 150, N'Món ăn giới hạn tỏa sáng, mang lại lượng lớn EXP cho pet.')
    ) AS source(ItemCode, DisplayName, IconEmoji, RarityCode, CategoryCode, ExperienceGain, Description)
    WHERE NOT EXISTS
    (
        SELECT 1 FROM game.ItemCatalog AS target WHERE target.ItemCode = source.ItemCode
    );

    COMMIT TRANSACTION;

    SELECT
        'REFERENCE_DATA_OK' AS ResultCode,
        (SELECT COUNT(*) FROM game.PetLevelThresholds) AS LevelRuleCount,
        (SELECT COUNT(*) FROM game.PetCatalog WHERE IsActive = 1) AS ActivePetCount,
        (SELECT COUNT(*) FROM game.ItemCatalog WHERE IsActive = 1) AS ActiveItemCount;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
