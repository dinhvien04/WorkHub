'use strict';

const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const env = require('../config/env');

if (env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOC_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function folderFor(fieldname) {
  if (fieldname === 'customerAvatar' || fieldname === 'LogoFile') return 'coworking/avatars';
  if (fieldname === 'verificationDocument') return 'coworking/licenses';
  if (fieldname === 'image') return 'coworking/branchs-and-spaces';
  return 'coworking/misc';
}

function fileFilter(req, file, cb) {
  const field = file.fieldname;
  const mime = file.mimetype;

  if (field === 'verificationDocument') {
    if (!DOC_MIMES.has(mime)) {
      return cb(new Error('Giấy tờ chỉ chấp nhận JPEG, PNG, WebP hoặc PDF.'));
    }
    return cb(null, true);
  }

  // avatar / logo / branch-space images: no PDF, no SVG
  if (!IMAGE_MIMES.has(mime)) {
    return cb(new Error('Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.'));
  }
  return cb(null, true);
}

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const folderName = folderFor(file.fieldname);
    const publicId = `${crypto.randomUUID()}`;
    const formats =
      file.fieldname === 'verificationDocument'
        ? ['jpg', 'png', 'jpeg', 'webp', 'pdf']
        : ['jpg', 'png', 'jpeg', 'webp'];

    return {
      folder: folderName,
      allowed_formats: formats,
      public_id: publicId,
      resource_type: 'auto',
    };
  },
});

// Memory storage fallback for tests without Cloudinary
const memoryStorage = multer.memoryStorage();

const useCloud = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY);

const uploadCloud = multer({
  storage: useCloud ? storage : memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10,
  },
  fileFilter,
});

module.exports = uploadCloud;
module.exports.cloudinary = cloudinary;
module.exports.IMAGE_MIMES = IMAGE_MIMES;
