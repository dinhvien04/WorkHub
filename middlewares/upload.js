const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// 1. Cấu hình xác thực với Cloudinary bằng biến môi trường
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Cấu hình bộ lưu trữ Multer Storage kết nối đến Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Tự động gom nhóm ảnh vào các thư mục riêng trên Cloudinary dựa theo tên trường (fieldname)
    let folderName = 'coworking/misc';
    if (file.fieldname === 'customerAvatar'|| file.fieldname === 'LogoFile') folderName = 'coworking/avatars';
    if (file.fieldname === 'verificationDocument') folderName = 'coworking/licenses';
    if (file.fieldname === 'image') {
        folderName = 'coworking/branchs-and-spaces'; 
    }

    return {
      folder: folderName,
      allowed_formats: ['jpg', 'png', 'jpeg', 'pdf'], // Hỗ trợ cả PDF cho giấy phép kinh doanh
      public_id: file.originalname.split('.')[0] + '_' + Date.now(), // Tránh trùng tên file
    };
  },
});

// 3. Khởi tạo middleware upload
const uploadCloud = multer({ storage: storage });

module.exports = uploadCloud;
