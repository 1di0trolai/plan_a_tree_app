/*
 * Điểm chạy chung cho schema nền tảng PAT, đã chia theo loại đối tượng trong schema/.
 * SSMS: bật Query > SQLCMD Mode rồi chạy toàn bộ file.
 * Sửa SchemaDir bên dưới nếu project không nằm ở C:\Code\app_PAT.
 * Khi không dùng SQLCMD, chạy trực tiếp các file con theo đúng thứ tự danh sách :r.
 * Chỉ dùng cho cài đặt/cập nhật schema có chủ đích; không cần chạy lại chỉ vì tách file.
 * Không tự chạy dữ liệu mẫu hoặc smoke test, không đặt lại database hiện có.
 */
:on error exit
:setvar SchemaDir "C:\Code\app_PAT\database\schema"

:r "$(SchemaDir)/00_database.sql"
:r "$(SchemaDir)/01_tables.sql"
:r "$(SchemaDir)/constraints/01_keys.sql"
:r "$(SchemaDir)/constraints/02_defaults.sql"
:r "$(SchemaDir)/constraints/03_checks.sql"
:r "$(SchemaDir)/constraints/04_foreign_keys.sql"
:r "$(SchemaDir)/03_indexes.sql"
:r "$(SchemaDir)/04_types.sql"
:r "$(SchemaDir)/05_auth_procedures.sql"
:r "$(SchemaDir)/06_profile_procedures.sql"
:r "$(SchemaDir)/07_plant_procedures.sql"
:r "$(SchemaDir)/08_game_procedures.sql"
:r "$(SchemaDir)/09_views.sql"
:r "$(SchemaDir)/10_permissions.sql"
