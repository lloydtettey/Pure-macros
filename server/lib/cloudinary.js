const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const BASE64_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function isBase64Image(value) {
  return typeof value === 'string' && BASE64_IMAGE_RE.test(value);
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

// Resolves whatever the client sent for an image field into a stable URL:
//  - a base64 data URL gets uploaded to Cloudinary and its secure_url returned
//  - an https URL (the client already uploaded directly to Cloudinary) is
//    passed through unchanged, so this is never a double-upload
//  - null/undefined passes through as null
// folder namespaces uploads per user + feature (e.g. `pure-macros/<userId>/weight-logs`).
async function resolveImageUrl(value, folder) {
  if (!value) return null;
  if (isHttpUrl(value)) return value;
  if (!isBase64Image(value)) {
    throw new Error('image must be a base64 image data URL or an https URL');
  }
  const result = await cloudinary.uploader.upload(value, { folder, resource_type: 'image' });
  return result.secure_url;
}

module.exports = { cloudinary, isBase64Image, isHttpUrl, resolveImageUrl };
