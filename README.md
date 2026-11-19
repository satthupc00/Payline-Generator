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

## 2 kiểu payline

Tab ở cột phải chọn kiểu đang xem / chỉnh (cả 2 kiểu dùng chung lưới và danh sách Animations):

- **Chuỗi ảnh fbf**: 1 dải mesh dài chạy dọc đường cong, phát chuỗi ảnh frame-by-frame.
- **Dây nối điểm**: mỗi cặp điểm cạnh nhau nối bằng 1 đoạn dây (mesh) có độ võng, kèm lớp sáng
  và 1 clipping mask. Anim tự tạo giống file mẫu 9687_VFX_Payline: mask mở từ trái qua phải,
  dây rung lần lượt từng đoạn, lớp sáng tắt dần, rồi mask ẩn về bên phải. Mọi thông số (độ võng,
  chồng mép, biên độ / độ trễ / thời gian rung, ánh sáng, mask) chỉnh ở cột phải.
  - **Rung**: mỗi đoạn có 3–6 bone (Số bone mỗi đoạn) nằm dọc theo dây, rung theo hướng vuông góc với dây
    (mạnh nhất giữa đoạn, 2 đầu đứng yên), lan dần từ trái qua phải, nên mắt xích không bị giãn.
  - Ảnh dây là ảnh **thẳng**, nạp được 3 độ dài: **Ngắn / Vừa / Dài** (VD Line_1 / Line_2 / Line_3), mỗi loại
    kèm 1 **ảnh sáng** (bề dày riêng). Mỗi đoạn tự dùng ảnh có chiều dài gần với đoạn nhất. App tự uốn
    ảnh theo **Độ võng**; **Số hàng mesh** chia dọc theo dây, **Số cột mesh** chia theo bề dày.
  - Ô số: giữ chuột và kéo qua lại để đổi giá trị (bấm 1 lần để gõ số).

Phím **Space**: play / pause preview ở bất cứ đâu (trừ lúc đang gõ trong ô chữ / ô số).

Lưới: lăn chuột để zoom, giữ chuột giữa để kéo, phím **F** để về khung ban đầu.

**Export…** hỏi xuất kiểu nào (chọn được cả 2): kiểu fbf ra `<Tên skeleton>.json/.atlas/.png`,
kiểu dây ra `<Tên skeleton>_Chain.json/.atlas/.png`.

## Mở app

Mỗi lần mở app sẽ hỏi: **File trống**, **File mẫu** (có sẵn ảnh mẫu cho cả 2 kiểu payline để xem thử)
hoặc **Mở file…** (.payline đã lưu). Ảnh của file mẫu nằm trong `renderer/sample/` (ảnh tự vẽ, không phải ảnh dự án).
Trên máy đã cài app, ảnh mẫu nằm ở:
`C:\Users\<tên máy>\AppData\Local\Programs\Mondiro Payline Generator\resources\app.asar.unpacked\renderer\sample\`
(thư mục `chain` = ảnh dây, `fbf` = chuỗi ảnh). Thay ảnh ở đó sẽ bị ghi đè khi app cập nhật.

## Lưu / mở file làm việc (.payline)

Tên file đang làm hiện ngay sau tiêu đề app: "Mondiro Payline Generator - New_Payline".
Dấu `*` phía sau = có thay đổi chưa lưu. Các lệnh nằm trong menu **File** ở góc trên bên phải.

- **Save File** (Ctrl+S): lưu. Lần đầu hỏi chỗ lưu và tên file; từ lần sau lưu đè lên file đang mở.
- **Save As...** (Ctrl+Shift+S): lưu thành file khác.
- **Load file** (Ctrl+O): mở lại 1 file `.payline`.
- **File mới** (Ctrl+N): bắt đầu file trống hoàn toàn (tên New_Payline).

File lưu toàn bộ phiên làm việc: lưới, tất cả pattern (điểm, tay cầm đường cong, tension), các thông số
bên phải, thư mục output, và **đường dẫn** tới thư mục flipbook + ảnh nền (ảnh không nằm trong file,
nên đừng di chuyển/xóa chúng). Tắt app khi chưa lưu sẽ được hỏi lại.

## Kéo thả

- Kéo **thư mục flipbook** (hoặc 1 frame bất kỳ trong thư mục) thả vào khung **Preview** → nạp toàn bộ frame.
- Kéo **1 ảnh** thả vào khung **lưới** → thành ảnh nền (giữ nguyên kích thước) và bật luôn chế độ chỉnh nền
  (kéo để dời, bấm Xong khi chỉnh xong). Nút **Edit Background** và ô **Ẩn nền** nằm cạnh nút Background.

## Cập nhật

App tự kiểm tra bản mới lúc mở và mỗi 1 tiếng. Muốn kiểm tra ngay thì bấm nút **Cập nhật** trên header;
khi bản mới tải xong, nút chuyển đỏ "Cập nhật vX.Y.Z", bấm vào để khởi động lại và cài.

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
