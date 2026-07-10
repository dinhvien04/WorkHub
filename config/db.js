const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  try {
    await mongoose.connect(uri);
    console.log('✅ Kết nối MongoDB thành công');
  } catch (err) {
    console.error('❌ Lỗi kết nối MongoDB:', err);
    process.exit(1);
  }
}

module.exports = { connectDB };