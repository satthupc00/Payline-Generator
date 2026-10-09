# Payline Generator

Standalone Electron app: click cells on a slot-game grid to draw a payline,
auto-generates a smooth curve, deforms a flipbook mesh along it (hose-rig
skinning), and exports a Spine 3.7.94 json/atlas/png bundle with one
animation per pattern.

## Chạy thử (cần máy có Node.js + internet)

```
npm install
npm start
```

## File cài đặt cho khách hàng

Khách hàng tải file **`Mondiro-Payline-Generator-Setup-<version>.exe`** ở mục
**Releases** của repo này (cột bên phải trang GitHub), chạy là cài xong, có
shortcut ngoài Desktop và Start Menu.

Lần đầu mở app sẽ hiện màn hình **nhập key**. Key **dùng chung với Spine
Preview**: ai đã có key Spine Preview thì nhập đúng key đó là dùng được. Thu
hồi/xóa key trong bảng Admin (ở Spine Preview hoặc ở app này đều được) thì
máy đó bị khóa cả 2 app trong khoảng 15–20 phút. Mất mạng thì máy đã kích
hoạt vẫn dùng được thêm 7 ngày.

Bảng Admin mở bằng phím tắt riêng (giống Spine Preview). Đăng nhập Admin bằng
GitHub token có quyền ghi vào repo **Spine_Preview** (cách tạo token: xem
README của Spine Preview). Token được lưu riêng cho từng app, nên ở app này
cần đăng nhập Admin một lần nữa.

## Lưu / mở file làm việc (.payline)

Khung **File** ở góc dưới bên trái hiện tên file đang làm (dấu ● màu vàng = có thay đổi chưa lưu).

- **⇪ Xuất file** (Ctrl+S): lưu. Lần đầu sẽ hỏi chỗ lưu và tên file; từ lần sau lưu đè lên file đang mở.
  Giữ Shift khi bấm (hoặc Ctrl+Shift+S) để lưu thành file khác.
- **⇩ Nhập file**: mở lại 1 file `.payline`.
- **＋ File mới**: bắt đầu file trống hoàn toàn.

File lưu toàn bộ phiên làm việc: lưới, tất cả pattern (điểm, tay cầm đường cong, tension), các thông số
bên phải, thư mục output, và **đường dẫn** tới thư mục flipbook + ảnh nền (ảnh không nằm trong file,
nên đừng di chuyển/xóa chúng). Tắt app khi chưa lưu sẽ được hỏi lại.

## Phát hành bản mới (tự động cập nhật)

1. Sửa code, đổi `"version"` trong `package.json` (ví dụ `2.0.0` → `2.0.1`).
2. Ghi nội dung bảng thông báo cập nhật vào `release-notes.md`:
   ```
   # v2.0.1
   - Thêm tính năng ...
   ```
   Tiêu đề phải trùng version, nếu không GitHub sẽ không build.
3. Push lên nhánh `main`.

GitHub Actions tự build file Setup .exe và đăng lên **Releases** (khoảng 5–10
phút, xem ở tab **Actions**). App đã cài trên máy khách kiểm tra bản mới lúc
mở app và mỗi 1 tiếng, tự tải về rồi hỏi "Cập nhật ngay / Để sau". Chọn "Để
sau" thì lần tắt app tới sẽ tự cài.

> **Lưu ý:** repo phải để **Public** thì app mới tải được bản cập nhật.

Build thử trên máy Windows (không phát hành): `npm run dist` → file nằm trong `dist/`.

## Cấu trúc

- `main.js` / `preload.js` — Electron main process, file dialogs, ghi file export
- `license.js` / `renderer/license-ui.js` — khóa key (dùng chung key Spine Preview), bảng Admin
- `updater.js` — tự cập nhật từ GitHub Releases
- `release-notes.md` — nội dung bảng thông báo cập nhật
- `.github/workflows/release.yml` — tự build file cài và phát hành khi đổi version
- `renderer/` — UI (HTML/CSS/JS thuần, không framework)
  - `modules/grid.js` — layout lưới (thẳng hàng / so le)
  - `modules/spline.js` — Catmull-Rom spline + resample theo arc-length + phát hiện góc gắt
  - `modules/mesh.js` — sinh mesh ribbon + skin weight theo kiểu hose-rig
  - `modules/atlasPacker.js` — đóng gói flipbook frames vào 1 atlas PNG
  - `modules/spineExport.js` — build file Spine 3.7.94 JSON hoàn chỉnh

## Trạng thái

Đây là bản v1 đầu tiên theo đúng spec đã chốt — mọi chức năng đều đã nối
dây (grid config, pattern list add/clone/delete, preset lưu/load, import
flipbook PNG rời, background reference ảnh có edit/lock, tension +
mesh density slider, cảnh báo khúc cong gắt, preview trong app, export
hàng loạt). Nên test kỹ trong Spine Editor và báo lại các lỗi/deform
chưa đúng ý để chỉnh tiếp — phần preview trong app dùng kỹ thuật vẽ
canvas riêng (không phải renderer Spine thật) nên có thể lệch nhẹ so
với khi import vào Spine, file JSON export mới là nguồn chính xác.
