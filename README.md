# PAT — Plant Adventure Tracker

PAT là ứng dụng mobile Android/iOS, kết hợp **chăm sóc cây thật ngoài đời** với hành trình sưu tầm pet. Người dùng chụp/chọn ảnh cây hằng ngày để lưu nhật ký và giữ streak riêng cho từng cây. Cây nằm ở màn hình Vườn, có thể vuốt ngang để chuyển cây.

## Về dự án

- **Mobile:** React Native, TypeScript, Expo SDK 57, Expo Router; dữ liệu demo lưu cục bộ bằng SQLite.
- Camera check-in riêng, hỗ trợ chụp ảnh và chọn từ thư viện; ảnh được sao chép vào bộ nhớ riêng của ứng dụng sau khi xác nhận. Hồ sơ cây, ảnh thật, phân tích và đại diện chibi tách biệt.
- Kho gồm pet và vật phẩm dành cho pet; cho pet ăn để tăng EXP/lên cấp, không dùng vật phẩm lên cây.
- Camera săn thú theo cây, một lượt chung mỗi ngày trong bản demo. Battle đang là Coming Soon.
- Giao diện đăng nhập/đăng ký/quên mật khẩu mẫu, hồ sơ và cài đặt.
- **Database:** SQL Server, quản trị bằng SSMS; có schema, danh mục hệ thống, dữ liệu mẫu và smoke test.

**Trạng thái:** app chạy độc lập bằng dữ liệu giả. Chưa có HTTP API, xác thực máy chủ, đồng bộ, AI phân tích/tạo chibi, thông báo hệ thống hoặc tích hợp Unity AR. Săn thú hiện mô phỏng kết quả, chưa xác minh danh tính cây hay nhận diện không gian. `database/db.js` chỉ là công cụ kết nối SQL local, không phải backend API. Mobile không kết nối trực tiếp SQL Server.

Mã ứng dụng nằm trong `mobile/`; script và công cụ SQL nằm trong `database/`. Project chỉ phát triển mobile, không có bản web.

## Chạy ứng dụng mobile

Yêu cầu: Node.js 24, npm và điện thoại có Expo Go tương thích SDK 57. Không cần SQL Server để chạy demo.

Tại thư mục gốc `app_PAT`:

```powershell
npm ci --prefix mobile
npm start
```

Máy tính và điện thoại cần cùng mạng Wi-Fi. Quét QR bằng Expo Go trên Android hoặc Camera trên iOS. Cho phép quyền camera khi được hỏi; dùng nút **Thư viện** nếu muốn chọn ảnh để kiểm thử.

Nếu LAN không kết nối được:

```powershell
npm start -- --tunnel
```

Expo có thể hỏi cài công cụ tunnel lần đầu. Mở Android emulator đã cấu hình trong Android Studio bằng `npm run android`. iOS Simulator cần macOS và Xcode (`npm run ios`). Nên kiểm thử camera trên điện thoại thật.

Đăng nhập mẫu: `demo@pat.vn` / `123456`. Đây không phải tài khoản backend: đăng nhập chỉ kiểm tra định dạng email/số điện thoại và mật khẩu ít nhất 6 ký tự. Các danh tính demo dùng chung dữ liệu trên thiết bị, chưa phân tách tài khoản. Quên mật khẩu không gửi email thật.

**Hồ sơ → Khôi phục dữ liệu mẫu** để reset demo. Gỡ app hoặc xóa dữ liệu ứng dụng sẽ mất dữ liệu local.

Kiểm tra mã nguồn tại thư mục gốc:

```powershell
npm run check
```

Lệnh này chạy lint, TypeScript và test logic demo. Kiểm tra cấu hình Expo riêng bằng `npm --prefix mobile run doctor`.

## Khởi tạo database bằng SSMS (tùy chọn)

Yêu cầu SQL Server 2019+ và SSMS. SSMS là công cụ quản trị, không thay thế SQL Server.

Kết nối SQL Server trong SSMS, mở và chạy từng file theo thứ tự:

1. `database/01_pat_schema.sql`: tạo database **PAT**, bảng, index, view và stored procedure. Cần quyền tạo database, hoặc nhờ admin tạo `PAT` trước.
2. `database/02_reference_data.sql`: nạp luật level, danh mục pet và vật phẩm bắt buộc.
3. `database/03_seed_demo.sql`: tùy chọn, nạp dữ liệu mẫu. Ảnh `demo/...` chỉ là placeholder; tài khoản seed không có mật khẩu đăng nhập thật.
4. `database/04_smoke_test.sql`: kiểm tra nghiệp vụ; kết quả cuối là `SMOKE_TEST_OK`, dữ liệu kiểm thử được rollback. Chỉ chạy trên database phát triển/kiểm thử.

Các script đều dùng tên `PAT`. Muốn đổi tên database phải sửa nhất quán trong cả bốn script và `.env`, không chỉ đổi `DB_NAME`.

### Kiểm tra kết nối từ Node.js trên Windows

Công cụ hiện dùng Windows Authentication và **Microsoft ODBC Driver 18 for SQL Server**. Cài driver, bật dịch vụ SQL Server và bảo đảm tài khoản Windows hiện tại có quyền truy cập database.

```powershell
npm ci
```

Nếu chưa có `.env`, tạo từ file mẫu (không ghi đè `.env` đang dùng):

```powershell
Copy-Item .env.example .env
```

Kiểm tra/sửa cấu hình trong `.env`:

```dotenv
DB_SERVER=localhost
DB_NAME=PAT
```

Với SQL Express, dùng tên instance đúng, ví dụ `DB_SERVER=localhost\SQLEXPRESS`. Sau đó:

```powershell
npm run db:check
```

Thành công khi thấy `DB_CHECK_OK`. Nếu kết nối được nhưng thiếu bảng, kiểm tra tên database và thứ tự chạy SQL. Lệnh này chỉ đọc, không tạo hay sửa schema.

Kết nối local cho phép chứng chỉ tự ký để phát triển; khi triển khai thật cần chứng chỉ tin cậy và tài khoản backend có quyền tối thiểu. Không commit `.env` hay đưa biến database vào mobile/`EXPO_PUBLIC_*`. Khởi tạo SQL thành công chưa làm app đồng bộ: cần backend API riêng.
