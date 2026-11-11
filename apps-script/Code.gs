/**
 * Google Apps Script Web App — nhận ảnh từ trang Quản lý chủ đề và lưu vào Google Drive của Host.
 * Cách dùng: xem hướng dẫn trong topics.html (hoặc README.md).
 */

// Tùy chọn: điền Folder ID để chỉ cho phép ghi vào đúng thư mục này (khuyến nghị, tăng an toàn).
var ALLOWED_FOLDER_ID = '';

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkFolder(id) {
  if (!id) throw new Error('Thiếu Folder ID.');
  if (ALLOWED_FOLDER_ID && id !== ALLOWED_FOLDER_ID) throw new Error('Folder ID không được phép.');
  return DriveApp.getFolderById(id);
}

// Kiểm tra kết nối: ?folderId=...
function doGet(e) {
  try {
    var id = e && e.parameter && e.parameter.folderId;
    if (!id) return respond({ ok: true, ping: true });
    var folder = checkFolder(id);
    return respond({ ok: true, folderName: folder.getName() });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

// Tải ảnh lên: body JSON { folderId, name, mime, data(base64) }
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var folder = checkFolder(p.folderId);
    var blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', p.name || 'image.jpg');
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return respond({ ok: true, id: file.getId(), name: file.getName() });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}
