# PAT Mobile

Ứng dụng React Native + Expo chạy trên Android và iOS. Đây là bản prototype native: dữ liệu được lưu cục bộ bằng SQLite, ảnh check-in được chọn từ thư viện thiết bị, còn phân tích cây và quét AR đang dùng dữ liệu mô phỏng.

## Chạy trên điện thoại

1. Cài ứng dụng **Expo Go** trên Android hoặc iOS.
2. Mở terminal tại thư mục này:

```powershell
cd C:\Code\app_PAT\mobile
npm install
npx expo start
```

3. Đảm bảo máy tính và điện thoại dùng cùng mạng Wi-Fi.
4. Quét QR bằng Expo Go trên Android hoặc Camera trên iOS.

Nếu mạng LAN không kết nối được, thử:

```powershell
npx expo start --tunnel
```

Tài khoản demo:

```text
Email: demo@pat.vn
Mật khẩu: 123456
```

## Kiểm tra mã nguồn

```powershell
npm run lint
npm run typecheck
npx expo-doctor
```

## Phạm vi hiện tại

- Đăng nhập, đăng ký và quên mật khẩu mô phỏng.
- Nhiều cây, vuốt ngang, streak và nhật ký riêng từng cây.
- Nút Camera ở giữa thanh điều hướng; check-in bằng camera thật hoặc ảnh từ thư viện.
- Dữ liệu hồ sơ cây, ảnh check-in, kết quả phân tích và đại diện chibi được lưu tách biệt.
- Màn hình camera AR riêng theo từng cây, với một lượt săn chung cho toàn tài khoản mỗi ngày.
- Kho chung gồm thú và đồ chăm sóc pet; có thể cho pet ăn để tăng EXP và lên cấp.
- Battle Coming Soon.
- Hồ sơ, cài đặt và lưu dữ liệu cục bộ.

Chưa có backend, AI nhận diện cây, nhận diện không gian ARCore/ARKit hoặc thông báo hệ thống thật.
