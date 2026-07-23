# Cài đặt Kas như một ứng dụng (PWA) trên Windows

Kas có thể cài như một ứng dụng độc lập trên Windows bằng Chrome hoặc Edge.

## Cài đặt

1. Mở Kas trong **Chrome** hoặc **Edge** (địa chỉ máy chủ Admin, ví dụ
   `http://192.168.1.10:3001`).
2. Đăng nhập một lần để chắc chắn trang tải đúng.
3. Cài đặt:
   - **Chrome:** biểu tượng **Cài đặt** (màn hình có mũi tên) ở cuối thanh địa
     chỉ → **Cài đặt**. Hoặc menu ⋮ → **Cài Kas…**
   - **Edge:** menu **⋯** → **Ứng dụng** → **Cài đặt trang này dưới dạng ứng dụng**.
   - Nếu nút **“Cài ứng dụng”** hiện trong Kas (góc dưới bên trái), bạn có thể bấm
     trực tiếp.
4. Xác nhận. Kas mở trong cửa sổ riêng, không có thanh địa chỉ (chế độ
   `standalone`).

## Ghim vào thanh tác vụ (Taskbar)

- Sau khi cài, chuột phải vào biểu tượng Kas trên thanh tác vụ → **Ghim vào thanh
  tác vụ** (Pin to taskbar).
- Hoặc trong Chrome/Edge: menu ứng dụng → **Tạo lối tắt** / **Ghim vào Start**.

## Cập nhật

Khi có bản mới, Kas hiển thị **“Có phiên bản mới”** ở góc dưới bên trái. Bấm
**Cập nhật** để tải lại phiên bản mới. Không cần gỡ cài đặt.

## Lưu ý về dữ liệu

- Service worker chỉ lưu **giao diện tĩnh** (JS/CSS/hình ảnh) để mở nhanh và
  chịu được mất mạng tạm thời.
- **Không** có dữ liệu đặt phòng hay phiên đăng nhập nào được lưu trong cache của
  service worker — mọi dữ liệu vận hành luôn được lấy trực tiếp từ máy chủ.
- Khi mất mạng, Kas hiển thị cảnh báo “Mất kết nối mạng” và giữ nguyên dữ liệu
  đang xem thay vì hiển thị danh sách trống.
