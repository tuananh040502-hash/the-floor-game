/**
 * Google Apps Script Web App — Lưu trữ ảnh câu hỏi, nhạc nền và Thư viện Theme (thefloor_themes.json) trên Google Drive của Host.
 * Hỗ trợ:
 *  - doGet(?folderId=...): Kiểm tra kết nối thư mục
 *  - doGet(?folderId=...&action=loadThemes): Đọc file thefloor_themes.json
 *  - doPost({ action: 'loadThemes', folderId }): Đọc file thefloor_themes.json
 *  - doPost({ action: 'saveThemes', folderId, data }): Lưu/cập nhật file thefloor_themes.json
 *  - doPost({ action: 'deleteTopicFolder', folderId, topicFolderId, fileIds }): Xóa file ảnh/chủ đề vào thùng rác Drive
 *  - doPost({ folderId, name, mime, data }): Tải file (ảnh/âm thanh) Base64 lên Drive
 */

// Tùy chọn: điền Folder ID để chỉ cho phép ghi vào đúng thư mục này (khuyến nghị, tăng an toàn).
var ALLOWED_FOLDER_ID = '';
var THEMES_FILENAME = 'thefloor_themes.json';

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkFolder(id) {
  if (!id) throw new Error('Thiếu Folder ID.');
  if (ALLOWED_FOLDER_ID && id !== ALLOWED_FOLDER_ID) throw new Error('Folder ID không được phép.');
  return DriveApp.getFolderById(id);
}

function findThemesFile(folder) {
  var files = folder.getFilesByName(THEMES_FILENAME);
  if (files.hasNext()) return files.next();
  return null;
}

function handleLoadThemes(folder) {
  var file = findThemesFile(folder);
  if (!file) return respond({ ok: true, found: false, data: null });
  var text = file.getBlob().getDataAsString('UTF-8');
  return respond({ ok: true, found: true, id: file.getId(), data: text });
}

function handleSaveThemes(folder, rawData) {
  var content = typeof rawData === 'string' ? rawData : JSON.stringify(rawData || {});
  var file = findThemesFile(folder);
  if (file) {
    file.setContent(content);
  } else {
    file = folder.createFile(THEMES_FILENAME, content, MimeType.PLAIN_TEXT);
  }
  return respond({ ok: true, id: file.getId(), name: file.getName(), saved: true });
}

function handleDeleteFiles(p) {
  var deletedCount = 0;
  var ids = Array.isArray(p.fileIds) ? p.fileIds : [];
  for (var i = 0; i < ids.length; i++) {
    var fid = String(ids[i] || '').trim();
    if (!fid) continue;
    try {
      DriveApp.getFileById(fid).setTrashed(true);
      deletedCount += 1;
    } catch (_) {}
  }
  if (p.topicFolderId) {
    try {
      DriveApp.getFolderById(String(p.topicFolderId).trim()).setTrashed(true);
      deletedCount += 1;
    } catch (_) {}
  }
  return respond({ ok: true, deletedCount: deletedCount });
}

// Kiểm tra kết nối: ?folderId=... (hoặc ?folderId=...&action=loadThemes)
function doGet(e) {
  try {
    var id = e && e.parameter && e.parameter.folderId;
    var action = e && e.parameter && e.parameter.action;
    if (!id) return respond({ ok: true, ping: true });
    var folder = checkFolder(id);
    if (action === 'loadThemes') return handleLoadThemes(folder);
    return respond({ ok: true, folderName: folder.getName() });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}

// Tải file / Lưu & Đọc Thư viện Theme / Xóa file trên Drive
function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    var folder = checkFolder(p.folderId);
    if (p.action === 'saveThemes') {
      return handleSaveThemes(folder, p.data);
    }
    if (p.action === 'loadThemes') {
      return handleLoadThemes(folder);
    }
    if (p.action === 'deleteTopicFolder') {
      return handleDeleteFiles(p);
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.mime || 'image/jpeg', p.name || 'image.jpg');
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return respond({ ok: true, id: file.getId(), name: file.getName() });
  } catch (err) {
    return respond({ ok: false, error: String(err) });
  }
}
