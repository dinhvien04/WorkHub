const express = require("express");
const router = express.Router();
const PaymentHistory = require("../models/Payment_History");

// Note: Đảm bảo bạn import hoặc pass middleware requireHostAuth vào đây.
// Nếu requireHostAuth nằm ở server.js, bạn có thể export nó ra hoặc định nghĩa ở một file middleware riêng.
// Giả sử middleware này được import vào hoặc cấu hình từ server, tạm thời ta viết logic lấy host từ `req.currentUser`

router.get("/payments", async (req, res) => {
  try {
    // 1. Kiểm tra nếu chưa có user từ middleware requireHostAuth
    if (!req.currentUser) {
      return res.redirect("/login");
    }

    // 2. Chỉ tìm các giao dịch thuộc về Host này để bảo mật dữ liệu
    //const payments = await PaymentHistory.find({ HostID: req.currentUser._id })

    //  .populate("CustomerID", "name email") // Khớp với ref: "User" trong Schema của bạn
    //  .populate("HostID", "name email")
    //  .sort({ createdAt: -1 });

    // TRONG paymentRoutes.js
    // Thay vì: .find({ HostID: req.currentUser._id })
    // Hãy sửa tạm thành:

    const payments = await PaymentHistory.find() // Bỏ điều kiện lọc để lấy toàn bộ dữ liệu mẫu
      .populate("CustomerID", "name email")
      .populate("HostID", "name email")
      .sort({ createdAt: -1 });

    console.log(
      "✅ Lấy thành công payments cho Host:",
      req.currentUser._id,
      "Số lượng:",
      payments.length,
    );

    // 3. Render giao diện kèm dữ liệu
    return res.render("host/payments", {
      currentUser: req.currentUser,
      payments: payments,
      scripts: '<script src="/js/host-spaces.js"></script>',
    });
  } catch (err) {
    console.log("❌ ERROR Lấy Payment History:", err);

    return res.render("host/payments", {
      currentUser: req.currentUser,
      payments: [], // fallback
      scripts: '<script src="/js/host-spaces.js"></script>',
    });
  }
});

module.exports = router;
