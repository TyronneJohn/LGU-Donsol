-- Server-side upload limit for the project-documents bucket (Engineering's
-- Program of Works and technical documents, Admin edits). The app checks
-- file type and size before uploading (apps/staff/src/utils/
-- documentUpload.js); this makes Storage itself refuse anything over 20 MB
-- even if that check is bypassed.
--
-- File *type* stays an app-side check on the extension: browsers report
-- MIME types inconsistently for Office files (an empty type for .docx is
-- common on Windows), so a bucket-level allowed_mime_types list would
-- reject legitimate uploads.

update storage.buckets
set file_size_limit = 20 * 1024 * 1024
where id = 'project-documents';
