-- The avatars bucket was created without a size limit, and the schema file's
-- 5 MB only applied on a fresh insert (its ON CONFLICT updated the MIME types
-- alone). Uploads go straight to Storage with a signed token, and the size the
-- app checks is the one the browser reports -- so nothing on the server bounded
-- a file in this public bucket. 5 MB is the largest the app accepts here
-- (customer photos, MAX_AVATAR_BYTES); logos are held to 2 MB in the app.

update storage.buckets
set file_size_limit = 5242880
where id = 'avatars';
