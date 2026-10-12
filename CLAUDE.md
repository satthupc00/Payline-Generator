# Quy tắc làm việc với repo này

Chủ repo (Mondiro) là artist, không phải lập trình viên. Trả lời bằng tiếng Việt, giải thích dễ hiểu.

## Phiên bản và phát hành

- Được **tự do nâng `version`** trong `package.json` khi có thay đổi cần đưa tới máy khách
  (sửa lỗi nhỏ: tăng số cuối, ví dụ `2.0.4` → `2.0.5`). Không cần hỏi lại Mondiro.
- Nội dung bảng thông báo cập nhật lấy từ `release-notes.md` (tiêu đề `# v<version>` + các dòng bên dưới).
  **Tự viết** ngắn gọn bằng tiếng Việt, dễ hiểu cho người dùng (không chép commit message), hoặc ghi `- Fix bugs`.
  Nếu Mondiro có đưa nội dung note thì ghi đúng nội dung đó.
- Đổi `version` (hoặc `release-notes.md`) rồi push lên `main` thì GitHub Actions sẽ tự build và phát hành.
  App đã cài sẽ tự cập nhật.
- Nâng version bằng `npm version <x.y.z> --no-git-tag-version --ignore-scripts` (sửa cả `package-lock.json`
  cho đúng), không dùng tìm-thay thế, vì dễ đổi nhầm version của thư viện khác.

## Key

- Key dùng chung với Spine Preview: danh sách key nằm ở `access/keys.json` của repo `satthupc00/Spine_Preview`.
  Không đổi `REPO` trong `license.js` và không đổi tiền tố `spine-preview:` trong `hashKey`, nếu không key cũ sẽ hết dùng được.

## Bí mật

- Không ghi phím tắt mở bảng Admin vào bất kỳ file công khai nào (README, release notes, commit message, comment code).
  Repo đang để Public.
