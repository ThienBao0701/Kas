# Triển khai Kas trong mạng nội bộ (LAN)

Kas chạy trên **một máy chủ trung tâm** (máy của Admin). Các máy lễ tân chỉ mở
trình duyệt trỏ tới máy chủ đó. Tất cả dùng chung **một** cơ sở dữ liệu SQLite
nằm trên máy chủ.

## Cài đặt trên máy chủ (máy Admin)

```bash
npm install
npm run db:migrate
npm run db:seed
npm run build      # build cả server và client
npm start          # chạy backend (mặc định cổng 3001), phục vụ luôn giao diện đã build
```

Trong lúc phát triển có thể dùng:

```bash
npm run dev        # backend :3001 + client dev :5173 (client proxy /api sang backend)
```

- Backend đã lắng nghe trên `0.0.0.0`, nên các máy khác trong LAN truy cập được.
- Cấu hình `.env`: đặt `SESSION_SECRET` và tài khoản Admin ban đầu
  (`INITIAL_ADMIN_*`). Ở môi trường nội bộ HTTP, để `SESSION_COOKIE_SECURE=false`.

## Máy lễ tân

1. Tìm địa chỉ IP LAN của máy chủ (ví dụ `ipconfig` → `192.168.1.10`).
2. Trên máy lễ tân, mở Chrome/Edge tới `http://192.168.1.10:3001`.
3. Đăng nhập bằng tài khoản lễ tân do Admin tạo.
4. (Tùy chọn) Cài đặt Kas như một ứng dụng — xem `pwa-install.md`.

## Cơ sở dữ liệu dùng chung

- Chỉ có **một** file SQLite trên máy chủ (theo `DATABASE_URL`, ví dụ
  `file:./data.db`).
- **Không** sao chép file `.db` sang từng máy lễ tân — như vậy dữ liệu sẽ bị tách
  rời. Mọi máy phải cùng gọi API tới máy chủ.

## Ảnh chứng minh (proof screenshots)

- Ảnh lễ tân gửi để Admin kiểm tra được lưu trên **ổ đĩa của máy chủ**, không lưu
  trong SQLite (SQLite chỉ giữ metadata + đường dẫn an toàn do máy chủ tự sinh).
- Thư mục lưu ảnh do biến môi trường `PROOF_UPLOAD_DIR` quyết định (mặc định
  `server/uploads/booking-proofs`, đã được `.gitignore`). Đường dẫn tương đối được
  tính từ thư mục gốc của repo; có thể đặt đường dẫn tuyệt đối (ví dụ một ổ dữ
  liệu riêng) nếu muốn.
- Thư mục này phải **cùng nằm trên máy chủ** với file `.db` để dữ liệu và ảnh luôn
  đồng bộ. Cấp quyền ghi cho tài khoản chạy Kas.

## OCR ảnh chứng minh (tùy chọn, chỉ để đọc thông tin)

- OCR **chỉ đọc** thông tin từ ảnh (mã booking, ngày, tổng tiền, thanh toán…) để
  hỗ trợ Admin. Nó **không** tự duyệt/từ chối và **không** so sánh với đơn gốc.
  Admin vẫn luôn tự kiểm tra ảnh.
- Mặc định **tắt**: `PROOF_OCR_ENABLED=false`. Khi tắt, nộp ảnh vẫn hoạt động bình
  thường, mỗi lần phân tích được ghi trạng thái `DISABLED`, Admin xem ảnh thủ công.
- Khi bật (`PROOF_OCR_ENABLED=true`, ngôn ngữ `PROOF_OCR_LANGUAGE=eng+vie`) cần cài
  gói **tùy chọn** `tesseract.js`:

  ```bash
  npm install tesseract.js -w server
  ```

  Nếu OCR lỗi hoặc chưa cài gói, việc nộp ảnh **vẫn thành công** — lần phân tích chỉ
  được ghi là `FAILED` (thông báo đã được làm sạch, không lộ đường dẫn máy chủ).
- Chỉ **Admin** đọc được dữ liệu OCR; lễ tân không thấy. Kết quả OCR (văn bản + các
  trường) lưu trong SQLite dưới dạng **chữ** (không lưu ảnh trong DB), nên đã được
  sao lưu cùng `data.db`. Không lưu byte ảnh hay đường dẫn hệ thống tệp trong DB.

## Đối chiếu ảnh với đơn (compare — chỉ hỗ trợ)

- Sau khi OCR xong, hệ thống **tự đối chiếu** dữ liệu OCR với đơn Admin đã gửi và
  lưu một bản kết quả (KHỚP / CẦN KIỂM TRA / CÓ SAI KHÁC / CHƯA CÓ KẾT QUẢ). Đây là
  **logic cục bộ, xác định** — không dùng AI, không gọi dịch vụ ngoài.
- Kết quả **chỉ mang tính hỗ trợ**: hệ thống **không** tự duyệt/từ chối và **không**
  đổi trạng thái đơn/ảnh. Admin vẫn là người quyết định cuối cùng.
- Mỗi lần phân tích OCR mới tạo một bản đối chiếu mới; các bản cũ được giữ lại. Kết
  quả lưu dưới dạng **chữ (JSON)** trong SQLite, sao lưu cùng `data.db`. Chỉ Admin
  đọc được; lễ tân không thấy.

## Tường lửa Windows

Nếu máy lễ tân không mở được Kas, cho phép cổng của máy chủ (ví dụ 3001) qua
**Windows Defender Firewall** → *Inbound Rules* → *New Rule* → *Port* → TCP 3001
→ Allow (Private network).

## Sao lưu (khuyến nghị)

- Sao lưu định kỳ file `data.db` của máy chủ (ví dụ hằng ngày sang ổ khác/USB).
- Nên sao lưu khi không có thao tác ghi (ví dụ cuối ngày) để tránh chép giữa lúc
  đang ghi. Có thể sao lưu cả các file `data.db-wal` / `data.db-shm` nếu tồn tại.
- Sao lưu **kèm** thư mục `PROOF_UPLOAD_DIR` cùng lúc với `data.db` — nếu thiếu
  ảnh, phần kiểm tra chứng minh sẽ mất bằng chứng dù metadata vẫn còn.

## Không dùng Docker

Không bắt buộc Docker. Kas chạy trực tiếp bằng Node.js trên máy Windows.
