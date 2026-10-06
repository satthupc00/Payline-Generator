# Payline Generator

Standalone Electron app: click cells on a slot-game grid to draw a payline,
auto-generates a smooth curve, deforms a flipbook mesh along it (hose-rig
skinning), and exports a Spine 3.7.94 json/atlas/png bundle with one
animation per pattern.

## Chạy thử (cần máy có Node.js + internet để tải Electron lần đầu)

```
npm install
npm start
```

## Build bản portable (thư mục, không cần cài đặt)

```
npm install
npm run dist:win
```

Kết quả nằm ở `dist/win-unpacked/` — đây là **cả một thư mục portable**:
gửi/copy nguyên thư mục này cho người khác, họ chỉ cần chạy file
`Payline Generator.exe` bên trong, không cần cài Node/Electron gì cả.
Vì cấu hình `win.target` đã set là `dir` (unpacked folder) thay vì
installer (nsis) nên electron-builder không tạo file cài đặt, chỉ đóng
gói thẳng ra thư mục chạy được.

Pin lên taskbar: mở thư mục `win-unpacked`, chuột phải vào
`Payline Generator.exe` → **Pin to taskbar**. Lưu ý không tách rời file
.exe khỏi thư mục — nó cần các file `.dll`/`resources` đi kèm ngay cạnh
để chạy được, nên khi gửi cho người khác phải gửi **nguyên cả thư mục**
(có thể nén .zip để gửi, người nhận giải nén ra rồi chạy tại chỗ).

Cấu hình lưu preset / vị trí cửa sổ vẫn ghi vào thư mục AppData của
Windows (không ghi vào chính thư mục app), nên thư mục portable này copy
sang máy khác chạy vẫn bình thường, không bị lỗi quyền ghi.

## Cấu trúc

- `main.js` / `preload.js` — Electron main process, file dialogs, ghi file export
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
