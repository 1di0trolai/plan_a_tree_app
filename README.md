<p align="center">
  <img src="mobile/assets/logo/pat-logo.png" alt="Logo PAT" width="160">
</p>

# PAT — Plant Adventure Tracker

*Một chút chăm sóc. Một vườn xanh.*

## Giới thiệu

PAT là ứng dụng giúp bạn theo dõi và chăm sóc cây thật mỗi ngày, kết hợp nhật ký hình ảnh, trợ lý AI và hoạt động sưu tầm thú nuôi.

Mỗi cây có một hồ sơ riêng để lưu quá trình phát triển, những việc đã làm và cuộc trò chuyện với trợ lý. Khi duy trì việc chăm cây, bạn có thể nhận quà, nuôi thú và mua vật phẩm bằng vàng trong ứng dụng.

Dự án gồm ứng dụng di động, API và cơ sở dữ liệu trên máy chủ riêng, cùng trang quản trị web để gửi thư và quà tới người dùng. Bản cài đang sử dụng là **APK Android**; mã nguồn di động được xây dựng theo hướng đa nền tảng.

## Mục lục

- [Giới thiệu](#giới-thiệu)
- [Công nghệ và thư viện sử dụng](#công-nghệ-và-thư-viện-sử-dụng)
- [Tính năng](#tính-năng)
- [Hướng dẫn và yêu cầu sử dụng](#hướng-dẫn-và-yêu-cầu-sử-dụng)
- [Cấu trúc project](#cấu-trúc-project)
- [Hạn chế hiện tại](#hạn-chế-hiện-tại)
- [Hướng phát triển](#hướng-phát-triển)
- [Trạng thái dự án](#trạng-thái-dự-án)
- [Lời cảm ơn](#lời-cảm-ơn)

## Công nghệ và thư viện sử dụng

Các phiên bản dưới đây là phiên bản khai báo trong cấu hình dự án, không phải cam kết hỗ trợ mọi thiết bị.

| Thành phần | Công nghệ / thư viện | Vai trò |
| --- | --- | --- |
| Ứng dụng di động | Expo SDK 58, React Native 0.88, React 19.3, TypeScript 6 | Nền tảng phát triển ứng dụng |
| Điều hướng | `expo-router`, `react-native-screens`, `react-native-safe-area-context` | Điều hướng màn hình và xử lý vùng hiển thị an toàn |
| Lưu trữ trên thiết bị | `expo-sqlite`, `expo-secure-store` | Lưu tiến trình cục bộ và thông tin đăng nhập nhạy cảm |
| Camera và ảnh | `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system` | Chụp, chọn, xử lý và quản lý ảnh cây |
| Giao diện và hiệu ứng | `react-native-reanimated`, `react-native-worklets`, `react-native-svg`, `expo-linear-gradient`, `@expo/vector-icons` | Chuyển động, hình vẽ, màu chuyển và biểu tượng |
| Âm thanh và lời nhắc | `expo-audio`, `expo-notifications` | Nhạc nền và thông báo chăm cây cục bộ |
| Tích hợp thiết bị | `expo-constants`, `expo-linking`, `expo-font`, `expo-splash-screen`, `expo-status-bar` | Cấu hình chạy, liên kết, phông chữ và màn hình khởi động |
| Đăng nhập mạng xã hội | `@react-native-google-signin/google-signin`, `react-native-fbsdk-next` | Đăng nhập và liên kết Google/Facebook trên bản cài có mô-đun native |
| Máy chủ API | Node.js, JavaScript, HTTP API, `dotenv` | Xử lý tài khoản, yêu cầu AI, đồng bộ và quản trị |
| Cơ sở dữ liệu | Microsoft SQL Server, `mssql`, `msnodesqlv8` | Lưu tài khoản, bản chụp tiến trình, ảnh riêng và thư |
| Trợ lý AI | Google Gemini API | Nhận diện, phân tích ảnh và tư vấn dựa trên ngữ cảnh từng cây |
| Email và xác minh danh tính | `nodemailer`, `jose` | Gửi mã khôi phục mật khẩu qua SMTP và xác minh danh tính nhà cung cấp |
| Kết nối và đóng gói | Tailscale, HTTPS/Serve, Expo EAS Build | Truy cập máy chủ riêng và tạo bản cài |
| Công cụ phát triển | ESLint, TypeScript, Node.js test runner, `tsx` | Kiểm tra mã, kiểu dữ liệu và kiểm thử |

Danh sách dependency và lệnh dự án nằm trong [package.json](package.json) và [mobile/package.json](mobile/package.json).

## Tính năng

### Quản lý khu vườn

- Thêm cây bằng hồ sơ nhập tay; có thể chụp hoặc chọn ảnh để AI gợi ý thông tin.
- Theo dõi cùng một cây qua các giai đoạn: chuẩn bị trồng, ươm hạt, phát triển và ra hoa/quả.
- Lưu điều kiện trồng, ảnh, ghi chú và lịch sử chăm sóc.
- Lưu trữ cây khỏi khu vườn và khôi phục khi cần mà vẫn giữ hồ sơ.

### Chăm cây cùng trợ lý AI

- Nhận diện ứng viên từ ảnh, để người dùng xác nhận đúng cây trước khi phân tích.
- Trò chuyện riêng với từng cây; trợ lý sử dụng hồ sơ, ảnh và những việc đã ghi làm ngữ cảnh.
- Ghi nhanh việc đã làm ngay trong màn hình trò chuyện qua mục **Hôm nay đã làm gì?**
- Nhật ký chăm cây chỉ ghi nhận công việc thực tế, không coi câu trả lời AI là việc người dùng đã làm.

Một lượt chăm sóc được tính qua luồng kiểm tra bằng camera sau khi xác nhận, phân tích và lưu thành công. Chỉ nhắn tin, ghi chú hoặc thêm ảnh tham chiếu không cấp lượt chăm sóc, chuỗi ngày hay vàng. Cây đang chuẩn bị trồng chưa tham gia nhiệm vụ chăm sóc.

### Quà chăm vườn và quà đăng nhập

- Theo dõi tiến trình chăm cây trong ngày; danh sách được chốt ở lần kiểm tra đầu ngày theo UTC+7. Cây thêm sau đó tham gia từ ngày hôm sau.
- Hoàn thành danh sách chăm sóc để mở thẻ thú nuôi, có cơ hội nhận thêm thức ăn.
- Theo dõi chuỗi chăm sóc hiện tại và nhận quà mốc riêng cho từng cây.
- Tích quà đăng nhập theo chu kỳ **7 ngày thực sự ghé ứng dụng**, không bắt buộc liên tiếp và không bù ngày vắng; ngày thứ 7 có tỷ lệ quà tốt hơn.
- Di chuyển hộp quà nổi và chạm trực tiếp vào hộp đủ điều kiện để nhận.
- Quà đăng nhập chưa nhận của chu kỳ cũ được chuyển vào hòm thư khi bắt đầu chu kỳ mới, không tự cộng vào kho.

### Thú nuôi và cửa hàng

- Sưu tầm thú nuôi thuộc 5 phẩm chất, hiển thị riêng từng cá thể với cấp độ và số sao.
- Cho ăn từng món hoặc cho ăn nhanh; thức ăn cấp thấp được ưu tiên khi tính lượng cần cho cấp tiếp theo.
- Nâng ngoại hình từ **1 đến 3 sao**, chọn bản sao cùng loài làm nguyên liệu.
- Bán thú nuôi hoặc bán nhanh theo bộ lọc; giữ lại ít nhất một cá thể mỗi loài và hoàn tài nguyên theo lịch sử đầu tư được ghi nhận.
- Mua thức ăn bằng vàng trong cửa hàng, nhập số lượng hoặc dùng nút tăng/giảm trước khi xác nhận.

Kho thú nuôi có tối đa **30 cá thể**. Khi đầy, hộp quà thú nuôi được giữ lại để bạn dọn kho rồi nhận, không tự làm mất quà.

Điều kiện nâng sao:

| Nâng cấp | Cấp tối thiểu | Bản sao nguyên liệu | Vàng | Thức ăn |
| --- | ---: | --- | ---: | --- |
| 1 → 2 sao | 18 | 2 cá thể 1 sao cùng loài | 200 | Mỗi loại 1 gói |
| 2 → 3 sao | 36 | 3 cá thể 1 sao cùng loài | 500 | Mỗi loại 2 gói |

Các quy tắc và tỷ lệ quà được quản lý tại [economy.ts](mobile/src/data/economy.ts) và [petProgression.ts](mobile/src/data/petProgression.ts).

### Tài khoản, dữ liệu và cá nhân hóa

- Đăng ký, đăng nhập bằng email/mật khẩu; đăng nhập hoặc liên kết Google/Facebook.
- Ghi nhớ thông tin đăng nhập trên thiết bị khi người dùng chọn.
- Đổi mật khẩu trong ứng dụng và khôi phục mật khẩu bằng mã gửi qua email.
- Tự lưu cục bộ và đồng bộ tiến trình theo tài khoản lên máy chủ; đăng nhập cùng tài khoản để tải dữ liệu trên thiết bị khác.
- Chọn **Tiếng Việt, English hoặc 日本語**, bật/tắt nhạc nền và lời nhắc chăm cây.
- Hòm thư nhận thông báo và quà; dấu chấm đỏ báo thư chưa đọc, hỗ trợ đọc hoặc xóa hàng loạt theo điều kiện của thư.

### Trang quản trị

- Đăng nhập bằng tài khoản quản trị riêng, tách khỏi tài khoản người dùng.
- Tìm người nhận và gửi thư tới từng tài khoản hoặc tất cả người dùng.
- Đính kèm vàng, thức ăn và xem lại nội dung trước khi gửi.
- Xem lịch sử gửi và đổi mật khẩu quản trị.

Thư quản trị được gửi vào **hòm thư trong ứng dụng**, không đồng nghĩa với email hay thông báo đẩy.

## Hướng dẫn và yêu cầu sử dụng

### Tải ứng dụng

[**Tải PAT cho Android — APK, khoảng 171 MB**](https://expo.dev/artifacts/eas/9FLySOi4VjbBoNM_LZRT0lMATjSYiJPCcpMFRtLI7IM.apk)

Đây là bản build ngày 08/11/2026. Sau khi cài, tiếp tục các bước tham gia mạng PAT bên dưới; ứng dụng vẫn cần Tailscale để kết nối máy chủ riêng. Link tải cần được cập nhật khi có bản APK mới.

### Yêu cầu

- Điện thoại Android có thể cài bản APK do chủ dự án cung cấp.
- Có kết nối Internet, ứng dụng Tailscale và quyền tham gia mạng riêng của dự án.
- Cho phép truy cập camera/ảnh khi sử dụng các chức năng tương ứng; cho phép thông báo nếu muốn nhận lời nhắc.
- Máy chủ của chủ dự án đang bật và có API, SQL Server, Tailscale hoạt động.

Người dùng **không cần tự dựng máy chủ, cài SQL Server hay cung cấp khóa Gemini**.

### Tham gia máy chủ PAT

1. [Tải APK Android](#tải-ứng-dụng) và cài vào điện thoại.
2. Cài Tailscale, mở [lời mời tham gia mạng PAT](https://login.tailscale.com/admin/invite/TXWQaGFSb2cXizTcnL6121), đăng nhập tài khoản Tailscale của mình và làm theo hướng dẫn.
3. Bật kết nối Tailscale, xác nhận yêu cầu VPN của Android và **giữ kết nối khi sử dụng các chức năng trực tuyến của PAT**.
4. Mở [trang kiểm tra máy chủ](https://desktop-3g2rq9e.tail94b3e5.ts.net/api/health). Nếu thấy JSON có `"status":"ok"`, điện thoại đã truy cập được API; kết quả này chưa kiểm chứng SQL đăng nhập hay một lượt gọi Gemini thật.
5. Mở PAT, tạo tài khoản hoặc đăng nhập bằng phương thức đã liên kết.
6. Thêm cây đầu tiên tại **Vườn**, hoàn thiện hồ sơ và bắt đầu theo dõi.

Lời mời có thể hết hiệu lực, bị thu hồi hoặc cần chủ mạng phê duyệt. Nếu không tham gia được, liên hệ chủ dự án để kiểm tra quyền truy cập hoặc nhận lời mời mới. Quyền vào Tailscale **không phải** tài khoản PAT hay quyền quản trị.

APK chạy độc lập, không cần Expo Go hoặc Metro. Tailscale không phải kết nối một lần rồi tắt; đây là đường truy cập API trong mạng riêng.

### Cập nhật ứng dụng và chuyển thiết bị

- Khi có APK mới cùng tên gói và khóa ký, cài đè bản cũ để cập nhật; tránh gỡ ứng dụng trước khi dữ liệu đã đồng bộ.
- Khi chuyển máy, mở PAT trên máy cũ với Internet/Tailscale để gửi dữ liệu, sau đó đăng nhập **cùng tài khoản** trên máy mới.
- Kiểm tra đủ khu vườn, kho đồ và ảnh trên máy mới trước khi xóa dữ liệu máy cũ.
- Nên tránh sửa tiến trình đồng thời trên hai máy. Nếu có xung đột, ứng dụng không tự gộp ví/kho mà giữ bản dự phòng và yêu cầu tải bản mới.

### Truy cập trang quản trị và vận hành máy chủ

Chỉ người có tài khoản quản trị riêng mới sử dụng [PAT Admin](https://desktop-3g2rq9e.tail94b3e5.ts.net/admin). Cần bật Tailscale; không dùng mật khẩu Gmail hoặc tài khoản người chơi để đăng nhập trang này.

Máy chủ hiện tại: `https://desktop-3g2rq9e.tail94b3e5.ts.net`.

### Dữ liệu và quyền riêng tư

Ảnh, hồ sơ cây, ghi chú và lịch sử liên quan được gửi qua API tới Gemini khi bạn chủ động nhận diện, phân tích hoặc trò chuyện. Ảnh và tiến trình đồng bộ được lưu theo tài khoản trong SQL Server trên máy chủ.

## Cấu trúc project

```text
app_PAT/
├── README.md                    # Giới thiệu và hướng dẫn sử dụng
├── package.json                 # Dependency máy chủ và lệnh chung
├── .env.example                 # Mẫu biến môi trường máy chủ
├── .easignore                   # Phạm vi tệp gửi lên EAS Build
├── backend/
│   ├── server.js                # Khởi động HTTP API
│   ├── app.js                   # Điều phối yêu cầu AI
│   ├── gemini.js                # Kết nối Google Gemini
│   ├── imageValidation.js       # Kiểm tra JPEG/PNG dùng chung cho AI và đồng bộ
│   ├── schemaMigrations.js      # Phiên bản, checksum và giao dịch cập nhật SQL
│   ├── auth*.js                 # Tài khoản, phiên và lưu trữ xác thực
│   ├── socialIdentity.js        # Xác minh Google/Facebook
│   ├── passwordResetMail.js     # Gửi email khôi phục mật khẩu
│   ├── cloud*.js                # Đồng bộ dữ liệu và ảnh riêng
│   ├── mailbox.js               # Nghiệp vụ hòm thư
│   ├── admin*.js                # Xác thực, API và dữ liệu quản trị
│   ├── admin-web/               # Giao diện quản trị HTML/CSS/JavaScript
│   └── tests/                   # Kiểm thử máy chủ
├── database/
│   ├── 01_pat_schema.sql        # Đầu mối SQLCMD chạy schema theo đúng thứ tự
│   ├── schema/
│   │   ├── 00_database.sql     # Database, schema và tùy chọn phiên
│   │   ├── 01_tables.sql       # Định nghĩa bảng và cột
│   │   ├── constraints/
│   │   │   ├── 01_keys.sql     # Khóa chính và khóa duy nhất
│   │   │   ├── 02_defaults.sql # Giá trị mặc định
│   │   │   ├── 03_checks.sql   # Kiểm tra tính hợp lệ
│   │   │   └── 04_foreign_keys.sql
│   │   ├── 03_indexes.sql      # Chỉ mục
│   │   ├── 04_types.sql        # Kiểu bảng dùng chung
│   │   ├── 05_auth_procedures.sql
│   │   ├── 06_profile_procedures.sql
│   │   ├── 07_plant_procedures.sql
│   │   ├── 08_game_procedures.sql
│   │   ├── 09_views.sql        # View đọc dữ liệu
│   │   └── 10_permissions.sql  # Vai trò và quyền SQL
│   ├── 02_reference_data.sql    # Danh mục và quy tắc cơ sở
│   ├── 05_plant_journeys.sql    # Hợp đồng SQL hành trình cây
│   ├── 07_external_identities.sql
│   ├── 08_cloud_sync.sql        # Bản chụp tiến trình, ảnh và thư
│   ├── 09_admin_accounts.sql    # Tài khoản quản trị riêng
│   ├── tests/                  # Kiểm thử SQL chạy thủ công, hoàn tác dữ liệu giả
│   │   ├── 04_smoke_test.sql
│   │   └── 06_journey_smoke_test.sql
│   └── db.js                   # Kết nối SQL Server dùng chung
└── mobile/
    ├── app.json                 # Cấu hình ứng dụng
    ├── app.config.js            # Kiểm tra cấu hình bản cài
    ├── eas.json                 # Profile EAS Build
    ├── build/personalConfig.js  # Mã kiểm tra build, không phải đầu ra APK
    ├── assets/                  # Logo, thú nuôi, thức ăn, tiền, trang phục, nhạc
    ├── src/
    │   ├── app/                 # Màn hình và điều hướng Expo Router
    │   ├── components/          # Thành phần giao diện dùng chung
    │   ├── screens/             # Thành phần riêng của từng màn hình
    │   ├── services/            # AI, tài khoản, đồng bộ và tích hợp thiết bị
    │   ├── store/               # Trạng thái và nghiệp vụ ứng dụng
    │   ├── data/                # Danh mục và quy tắc trò chơi
    │   ├── i18n/                # Nội dung Việt / Anh / Nhật
    │   ├── hooks/               # Hook dùng chung
    │   ├── utils/               # Hàm hỗ trợ
    │   ├── types/               # Kiểu dữ liệu
    │   └── theme.ts             # Màu sắc, chữ, khoảng cách và quy chuẩn giao diện
    └── tests/                   # Kiểm thử ứng dụng và dữ liệu giả lập
```

### Schema và kiểm thử SQL

Schema nền tảng được tách thành 14 file theo loại đối tượng để dễ đọc và bảo trì. `01_pat_schema.sql` chỉ giữ danh sách chạy theo thứ tự; không chứa bản sao thứ hai của các định nghĩa.

**Database đang sử dụng không cần chạy lại khi chỉ sắp xếp file.** Chỉ chạy schema/migration khi cài đặt hoặc chủ động cập nhật cấu trúc; không dùng chúng để đặt lại dữ liệu.

Khi cần cài schema nền tảng: mở [01_pat_schema.sql](database/01_pat_schema.sql) trong SSMS, bật **Query → SQLCMD Mode**, kiểm tra dòng `SchemaDir` trỏ đúng thư mục `database/schema` trên máy rồi chạy toàn bộ. Mặc định là `C:\Code\app_PAT\database\schema`; đổi dòng này nếu chuyển project sang nơi khác. Nếu không dùng SQLCMD, mở và chạy từng file con theo đúng thứ tự các dòng `:r`. Xem [hướng dẫn SQLCMD Mode của Microsoft](https://learn.microsoft.com/en-us/ssms/scripting/sqlcmd-scripts-query-editor).

- `02_reference_data.sql`: danh mục và quy tắc cơ sở cần nạp sau schema khi cài database đầy đủ; **không phải dữ liệu mẫu**.
- Script SQL nạp tài khoản/cây/kho minh họa đã được loại bỏ; không cần dữ liệu minh họa để ứng dụng hoạt động.
- [tests/04_smoke_test.sql](database/tests/04_smoke_test.sql), [tests/06_journey_smoke_test.sql](database/tests/06_journey_smoke_test.sql): tùy chọn, kiểm tra các luồng SQL bằng dữ liệu giả trong giao dịch rồi hoàn tác. Chỉ chạy thủ công để kiểm tra/bảo trì, không phải bước khởi động ứng dụng; file `06` cần có cấu trúc ở `05_plant_journeys.sql` trước.
- Các file `05`, `07`, `08`, `09` vẫn là các bản mở rộng riêng. Lệnh `npm run server:setup` tiếp tục chỉ áp dụng `08_cloud_sync.sql` và `09_admin_accounts.sql`, không tự chạy schema nền tảng hoặc các file kiểm thử trong `database/tests/`.

Khi cài database mới, thứ tự là `01` → `02` → `05` → `07`, sau đó chạy `npm run server:setup -- --backup` để áp dụng `08` và `09`. Với database đang dùng, chỉ chạy lệnh cập nhật khi cần; việc khởi động API không tự chạy migration.

Runner lưu phiên bản, tên file, SHA-256 và thời điểm áp dụng trong `dbo.PatSchemaMigrations`. Lần đầu trên database hiện có, `08`/`09` được chạy lại an toàn rồi ghi lịch sử; các lần sau được bỏ qua nếu checksum khớp. Lịch sử này chỉ theo dõi các migration do runner quản lý, chưa ghi nhận hồi tố `01`/`02`/`05`/`07`. Runner khóa cập nhật đồng thời và đặt SQL cùng lịch sử trong một giao dịch: lỗi thì hoàn tác cả đợt.

Đã kiểm chứng trên máy chủ PAT ngày 11/11/2026: sao lưu được xác minh, hai migration `008`/`009` áp dụng thành công và được bỏ qua khi chạy lại; đối chiếu dữ liệu 36 bảng hiện có giữ nguyên. Đây là xác nhận cho đợt cập nhật này, không thay thế việc sao lưu trước các lần cập nhật sau.

File đã được ghi lịch sử cần giữ nguyên, kể cả chú thích; chỉ BOM và kiểu xuống dòng được chuẩn hóa khi tính checksum. Thay đổi cấu trúc tiếp theo bằng file/phiên bản mới và thêm vào danh sách trong `backend/setupServerData.js`. Nếu phát hiện checksum sai hoặc lịch sử không tương thích, runner dừng; không xóa bảng lịch sử để bỏ qua lỗi.

### Kiểm tra khi phát triển

Các thư mục `backend/tests`, `mobile/tests` (bao gồm fixtures) và `database/tests` là mã nguồn được đưa cùng project vào Git. Chúng được tách khỏi tài nguyên đóng gói APK qua `.easignore`.

Tại thư mục gốc:

```powershell
npm run lint
npm run typecheck
npm run test:critical
```

`test:critical` chạy nhóm tài khoản, migration, ảnh, giao dịch cửa hàng/thú nuôi/quà, đồng bộ, âm nhạc và hội thoại. Các bài này dùng dữ liệu giả, không gửi email, gọi Gemini hay sửa SQL thật. Khi sửa phần khác, chạy thêm file kiểm thử tương ứng; `npm run check` dành cho lần kiểm tra toàn bộ mã nguồn.

Kiểm thử SQL tích hợp chỉ chạy khi chủ động bật `PAT_AUTH_SQL_SMOKE=1`, `PAT_AUTH_SOCIAL_SQL_SMOKE=1` hoặc `PAT_CLOUD_SQL_SMOKE=1` cho bài tương ứng. Dùng database kiểm thử riêng; không đưa các biến này vào `.env` đang chạy ứng dụng. Chúng được bỏ qua trong lệnh kiểm tra mặc định.

Kiểm thử giao diện hiện mô phỏng native, không xác nhận được vị trí bàn phím, âm thanh hay hiển thị trên thiết bị. Trước khi phát hành APK, cần kiểm tra trên máy thật:

| Tình huống | Kết quả cần kiểm tra |
| --- | --- |
| Đăng nhập, đóng rồi mở lại ứng dụng | Ghi nhớ theo lựa chọn; đúng tài khoản và tiến trình |
| Mua đồ, cho ăn, bán/nâng sao, nhận quà; thử lại sau lỗi mạng | Tài nguyên thay đổi đúng một lần; thao tác đang chờ không bị cộng/trừ trùng |
| Quét cây → chat khi bật bàn phím → mở thẻ → quay về Vườn | Bàn phím không che ô nhập; âm nhạc phục hồi theo cài đặt |
| Mất mạng trong lúc thay đổi tiến trình, mở lại khi có mạng | Kiểm tra phần đã lưu và việc gửi lại; chưa coi đây là bảo đảm an toàn khi đóng cưỡng bức ngay sau thao tác |
| Đăng nhập cùng tài khoản trên máy khác | Kiểm tra cây, ảnh, kho và thư trước khi xóa dữ liệu máy cũ |

Phần điều phối giao dịch nằm ở `mobile/src/store/economyTransactions.ts`; `AppStore.tsx` giữ trạng thái, phiên tài khoản và vòng đời lưu/đồng bộ. Giới hạn ngữ cảnh chat và nội dung giải thích trên màn hình cùng dùng `CHAT_CONTEXT_LIMITS` để tránh mô tả lệch logic.

## Hạn chế hiện tại

- **Phụ thuộc máy chủ riêng:** cần Tailscale và máy chủ đang hoạt động để đăng nhập, đồng bộ và dùng AI. Đây chưa phải hạ tầng phục vụ công khai quy mô lớn.
- **AI không thay thế quan sát thực tế:** nhận diện và tư vấn có thể sai, bị chậm hoặc gián đoạn do kết nối/hạn mức. Ứng dụng không trực tiếp đo độ ẩm, rễ hay điều kiện ánh sáng thực.
- **Đồng bộ không tức thì tuyệt đối:** thay đổi đang chờ gửi có thể mất nếu xóa dữ liệu hoặc gỡ ứng dụng trước khi đồng bộ xong; không bảo đảm an toàn khi tắt mạng ngay sau thao tác.
- **Một số nội dung chưa mở:** Đấu trường, kim cương và thanh toán thật chưa được triển khai. Bản cài iOS cho người dùng cuối chưa được hoàn thiện/phát hành.
- **Chưa có thông báo đẩy từ máy chủ:** lời nhắc chăm cây hiện chạy cục bộ; thư quản trị xuất hiện qua hòm thư khi ứng dụng kết nối. Cơ chế tiết kiệm pin của thiết bị có thể làm chậm lời nhắc.

Nghiệp vụ chăm cây và cửa hàng hiện còn được xử lý ở phía ứng dụng. Nếu phát hành rộng, cần tăng kiểm soát phía máy chủ trước khi coi đây là hệ thống kinh tế có khả năng chống gian lận.

## Hướng phát triển

Những mục dưới đây là định hướng, chưa phải tính năng đã có hoặc cam kết thời gian phát hành:

- Hoàn thiện Đấu trường và mở rộng nội dung thú nuôi, vật phẩm.
- Cải thiện khả năng nhận diện cây, chất lượng ngữ cảnh và hướng dẫn theo từng giai đoạn phát triển.
- Nâng độ ổn định của đồng bộ đa thiết bị, xử lý xung đột và khôi phục dữ liệu.
- Hoàn thiện bản cài iOS.
- Khi mở rộng số lượng người dùng: cải thiện hạ tầng, sao lưu và chuyển thêm nghiệp vụ phần thưởng/cửa hàng quan trọng lên máy chủ.

## Trạng thái dự án

**Đang phát triển — đã có APK Android và sử dụng qua máy chủ riêng.**

- Bản cài hiện tại: [Tải APK Android](#tải-ứng-dụng).
- Phiên bản khai báo trong project: `0.1.0`.
- Đã triển khai các nhóm chức năng chăm cây, AI, tài khoản, thú nuôi, cửa hàng, đồng bộ và quản trị.
- Tiếp tục hoàn thiện độ ổn định, trải nghiệm và các nội dung được nêu ở phần hướng phát triển.
- Chưa phát hành công khai trên Google Play hoặc App Store; không tuyên bố đã hỗ trợ đầy đủ mọi thiết bị.

## Lời cảm ơn

Cảm ơn những người đã sử dụng, góp ý và giúp phát hiện vấn đề trong quá trình phát triển PAT.

Cảm ơn cộng đồng React, React Native, Expo và các tác giả thư viện mã nguồn mở mà dự án sử dụng; cùng các nền tảng Google Gemini, Tailscale và Microsoft SQL Server đã cung cấp công cụ để xây dựng ứng dụng.

*Mong PAT giúp việc chăm một cái cây trở thành một thói quen nhỏ đáng mong đợi mỗi ngày.*
