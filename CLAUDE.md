# Quy tắc làm việc với repo này

Chủ repo (Mondiro) là artist, không phải lập trình viên. Trả lời bằng tiếng Việt, giải thích dễ hiểu.

## Phiên bản và phát hành

- **Không tự ý tăng `version` trong `package.json`.** Chỉ tăng khi Mondiro nói rõ là nâng version.
  Sửa code mà không được dặn nâng version thì chỉ commit và push, không phát hành bản mới.
- Khi nâng version, nội dung bảng thông báo cập nhật lấy từ `release-notes.md`
  (tiêu đề `# v<version>` + các dòng bên dưới). **Chỉ ghi đúng những dòng Mondiro note**,
  không tự viết thêm và không chép commit message vào.
- Nếu Mondiro dặn nâng version mà chưa đưa nội dung note, **phải hỏi lại** muốn ghi gì
  trước khi sửa `release-notes.md` và push.
- Đổi `version` (hoặc `release-notes.md`) rồi push lên `main` thì GitHub Actions sẽ tự build và phát hành.
  App đã cài sẽ tự cập nhật.

## Key

- Key dùng chung với Spine Preview: danh sách key nằm ở `access/keys.json` của repo `satthupc00/Spine_Preview`.
  Không đổi `REPO` trong `license.js` và không đổi tiền tố `spine-preview:` trong `hashKey`, nếu không key cũ sẽ hết dùng được.

## Bí mật

- Không ghi phím tắt mở bảng Admin vào bất kỳ file công khai nào (README, release notes, commit message, comment code).
  Repo đang để Public.
