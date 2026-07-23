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

## Tường lửa Windows

Nếu máy lễ tân không mở được Kas, cho phép cổng của máy chủ (ví dụ 3001) qua
**Windows Defender Firewall** → *Inbound Rules* → *New Rule* → *Port* → TCP 3001
→ Allow (Private network).

## Sao lưu (khuyến nghị)

- Sao lưu định kỳ file `data.db` của máy chủ (ví dụ hằng ngày sang ổ khác/USB).
- Nên sao lưu khi không có thao tác ghi (ví dụ cuối ngày) để tránh chép giữa lúc
  đang ghi. Có thể sao lưu cả các file `data.db-wal` / `data.db-shm` nếu tồn tại.

## Không dùng Docker

Không bắt buộc Docker. Kas chạy trực tiếp bằng Node.js trên máy Windows.
