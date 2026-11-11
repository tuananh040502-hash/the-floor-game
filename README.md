# THE FLOOR — Webgame

HTML5 + Tailwind (CDN) + JavaScript thuần (ES modules), không cần build. Realtime qua Firebase Realtime Database.

## Cấu trúc
```
index.html            Trang vào phòng (mã phòng, PIN Host)
game.html             Màn hình chính (Host / Xem)
css/style.css         Giao diện studio, sàn 3D, LED
js/app.js             UI, render, đồng hồ, phím tắt
js/engine.js          Luật chơi thuần (60s, −2s, đổi lượt, chiếm ô)
js/data.js            Ngân hàng câu đố theo chủ đề
js/transport.js       Firebase RTDB hoặc chế độ cục bộ
js/audio.js           Âm thanh WebAudio (Ding, Buzzer, còi hú…)
js/fx.js              Pháo hoa
js/firebase-config.js Cấu hình Firebase (điền vào)
vercel.json
```

## Chạy thử cục bộ
```
npx serve .
```
Mở `http://localhost:3000`. Chưa điền Firebase thì chạy chế độ cục bộ: mở Host ở một tab và Xem ở tab khác (cùng trình duyệt).

## Bật Firebase Realtime
1. Firebase Console → tạo project → Build → Realtime Database → Create database.
2. Project settings → Web app → copy config vào `js/firebase-config.js` (bắt buộc có `databaseURL`).
3. Rules (demo, mở):
```json
{ "rules": { "rooms": { "$room": { ".read": true, ".write": true } } } }
```
> PIN Host chỉ là khóa mềm ở phía client. Muốn bảo mật thật, hãy dùng Firebase Auth + rules.

## Deploy Vercel
Import repo (hoặc `vercel` trong thư mục này), Framework: Other, không cần build command.

## Cách chơi
1. Host vào `index.html` → nhập mã phòng + PIN → **HOST**. Khán giả/thí sinh vào cùng mã phòng → **XEM**.
2. Host bấm 1 ô trên sàn (chủ ô là người bị thách), chọn người thách đấu và chủ đề → **VÀO ĐẤU TRƯỜNG** → **BẮT ĐẦU**.
3. Phím tắt: `Space/Enter` = ĐÚNG · `P/↓` = BỎ LƯỢT (−2s, giữ lượt) · `T` = Tạm dừng/Tiếp tục.
4. Ai về 0.0s thua: còi hú, pháo hoa bên người thắng, toàn bộ ô của người thua chuyển sang người thắng. Bấm **VỀ SÀN** để quay lại.
5. Màn hình Xem có thanh mini góc phải dưới: nhập PIN để mở khóa điều khiển.

## Thêm câu đố
Sửa `js/data.js`: thêm item `{ type:'img', src, answer }` hoặc `{ type:'emoji', emoji, answer }`, hoặc cả chủ đề mới vào `CATEGORIES`.

## Quản lý chủ đề (Topic CMS)
- Host bấm **📚 Chủ đề** trên game (hoặc mở `topics.html`) để tạo/sửa chủ đề, tối đa 50 ảnh/chủ đề, sửa đáp án, đổi thứ tự (kéo thả hoặc ▲▼), xóa ảnh lỗi.
- Xuất/Nhập JSON để sao lưu. Chủ đề lưu trong localStorage của trình duyệt Host; khi vào trận, bộ câu hỏi được chụp vào trạng thái phòng nên các màn hình Xem hiển thị được ngay.
- Tải ảnh lên Drive: dán `apps-script/Code.gs` vào Google Apps Script, triển khai Web App (Thực thi: Tôi, Truy cập: Bất kỳ ai), nhập URL `/exec` + Folder ID trong trang Chủ đề. Nên điền `ALLOWED_FOLDER_ID` trong script để chỉ cho phép ghi vào đúng thư mục.
- Hoặc dán link ảnh online / link chia sẻ Google Drive (file phải để “Bất kỳ ai có link”).

## Firebase & đồng bộ realtime
- Bấm **⚙️ Firebase** (trang vào phòng hoặc thanh trên cùng game) để dán `firebaseConfig`, kiểm tra kết nối và lưu; có nút về chế độ cục bộ / khôi phục mặc định. Cấu hình mặc định nằm ở `js/firebase-config.js`.
- Game PIN gồm 4 số; Host và máy Xem nhập cùng PIN. Mật khẩu Host dùng để mở khóa điều khiển.
- Mỗi thao tác chỉ gửi phần thay đổi (multi-path update); đồng hồ dựa trên giờ server Firebase nên không lệch giữa 2 máy. Độ trễ một chiều hiển thị ở nhãn kết nối (⚡ ms).
- Rules tối thiểu để chạy (demo): `{ "rules": { "rooms": { "$room": { ".read": true, ".write": true } } } }`. Nên giới hạn lại và/hoặc dùng Firebase Auth khi chơi thật.
