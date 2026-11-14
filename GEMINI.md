# Quy tắc làm việc tự động cho dự án The Floor Game
1. LUỒNG XỬ LÝ TỰ ĐỘNG (1-PROMPT WORKFLOW):
   - Với tác vụ nhỏ (sửa CSS, đổi chữ, chỉnh bố cục): Sửa trực tiếp ngay lập tức, không cần hỏi lại.
   - Với tác vụ logic (JS, Firebase, Audio, Engine): Liệt kê nhanh kế hoạch 3 gạch đầu dòng ở đầu câu trả lời rồi thực hiện sửa code luôn trong cùng một lượt.
2. TIẾT KIỆM TOKEN TỐI ĐA:
   - Chỉ đọc đúng các file liên quan trực tiếp đến yêu cầu, không quét toàn bộ thư mục nếu không cần thiết.
   - Trả lời cực kỳ ngắn gọn, không giải thích dài dòng trước và sau khi sửa.
3. TỰ ĐỘNG KIỂM TRA LỖI BẰNG NODE:
   - Sau khi chỉnh sửa bất kỳ file `.js` nào, BẮT BUỘC tự chạy lệnh `node --check <tên_file>` trong terminal nội bộ để đảm bảo không có lỗi cú pháp trước khi báo hoàn thành.

6. ÁP DỤNG DESIGN.MD:
- Đọc @DESIGN.md trước khi sửa HTML/CSS. Áp dụng bảng màu, font chữ, bo góc và phân tầng giao diện Apple từ @DESIGN.md, nhưng ưu tiên nền tối bán trong suốt phân tầng thay cho `backdrop-filter: blur` dày đặc để giữ 60fps trên iPad và Smart TV. Giữ nguyên bố cục @index.html trừ khi được yêu cầu.
