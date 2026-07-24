"use strict";

function baseHtml({ title, bodyHtml, ctaLabel, ctaUrl }) {
  const ctaButton = (ctaLabel && ctaUrl)
    ? `<div style="margin: 24px 0; text-align: center;">
         <a href="${ctaUrl}" style="background-color: #0d9488; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">${ctaLabel}</a>
       </div>`
    : "";

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 16px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
          <div style="background-color: #0d9488; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.025em;">WorkHub</h1>
          </div>
          <div style="padding: 24px; color: #27272a; line-height: 1.6; font-size: 15px;">
            ${bodyHtml}
            ${ctaButton}
          </div>
          <div style="background-color: #fafafa; padding: 16px; text-align: center; font-size: 12px; color: #71717a; border-top: 1px solid #f4f4f5;">
            <p style="margin: 0;">&copy; 2026 WorkHub. Tất cả quyền được bảo lưu.</p>
          </div>
        </div>
      </body>
    </html>
  `.trim();
}

const templates = {
  password_reset: ({ otp }) => {
    const title = "Đặt lại mật khẩu của bạn";
    const bodyHtml = `
      <p style="margin-top: 0;">Chào bạn,</p>
      <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản WorkHub của bạn. Vui lòng sử dụng mã OTP bên dưới để tiếp tục:</p>
      <div style="background-color: #f4f4f5; padding: 16px; border-radius: 8px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 0.25em; color: #0d9488; margin: 16px 0;">
        ${otp}
      </div>
      <p>Mã OTP này có hiệu lực trong vòng 15 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, bạn có thể bỏ qua email này.</p>
    `;
    return {
      subject: "Mã OTP đặt lại mật khẩu - WorkHub",
      text: `Mã OTP đặt lại mật khẩu của bạn là: ${otp}. Mã này có hiệu lực trong 15 phút.`,
      html: baseHtml({ title, bodyHtml }),
    };
  },

  booking_created: ({ spaceName, startTime, endTime, totalAmount, bookingId }) => {
    const title = "Đơn đặt chỗ đang chờ xác nhận";
    const formattedAmount = Number(totalAmount).toLocaleString("vi-VN") + "đ";
    const bodyHtml = `
      <p style="margin-top: 0;">Chào bạn,</p>
      <p>Cảm ơn bạn đã sử dụng WorkHub. Đơn đặt chỗ của bạn đã được tiếp nhận và đang chờ Chủ cơ sở xác nhận:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Mã đơn:</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Không gian:</td>
          <td style="padding: 8px 0; text-align: right;">${spaceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Thời gian:</td>
          <td style="padding: 8px 0; text-align: right;">${new Date(startTime).toLocaleString("vi-VN")} - ${new Date(endTime).toLocaleString("vi-VN")}</td>
        </tr>
        <tr style="border-top: 1px solid #f4f4f5;">
          <td style="padding: 12px 0; font-weight: bold; font-size: 16px;">Tổng tiền:</td>
          <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #0d9488; font-size: 16px;">${formattedAmount}</td>
        </tr>
      </table>
      <p>Chúng tôi sẽ gửi email thông báo ngay khi Chủ cơ sở cập nhật trạng thái đơn đặt chỗ.</p>
    `;
    return {
      subject: "Yêu cầu đặt chỗ đang chờ xác nhận - WorkHub",
      text: `Đơn đặt chỗ ${bookingId} tại ${spaceName} trị giá ${formattedAmount} đang chờ xác nhận.`,
      html: baseHtml({ title, bodyHtml, ctaLabel: "Xem chi tiết", ctaUrl: `http://localhost:3000/booking/detail?id=${bookingId}` }),
    };
  },

  booking_confirmed: ({ spaceName, startTime, endTime, bookingId }) => {
    const title = "Đơn đặt chỗ đã được xác nhận";
    const bodyHtml = `
      <p style="margin-top: 0;">Chào bạn,</p>
      <p style="color: #0d9488; font-weight: bold;">Tin vui! Yêu cầu đặt chỗ của bạn đã được Chủ cơ sở xác nhận thành công:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Mã đơn:</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Không gian:</td>
          <td style="padding: 8px 0; text-align: right;">${spaceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Thời gian:</td>
          <td style="padding: 8px 0; text-align: right;">${new Date(startTime).toLocaleString("vi-VN")} - ${new Date(endTime).toLocaleString("vi-VN")}</td>
        </tr>
      </table>
      <p>Vui lòng đến đúng giờ đã đăng ký và xuất trình mã đơn đặt chỗ khi làm thủ tục check-in.</p>
    `;
    return {
      subject: "Đơn đặt chỗ đã được xác nhận - WorkHub",
      text: `Đơn đặt chỗ ${bookingId} tại ${spaceName} đã được xác nhận thành công!`,
      html: baseHtml({ title, bodyHtml, ctaLabel: "Xem chi tiết", ctaUrl: `http://localhost:3000/booking/detail?id=${bookingId}` }),
    };
  },

  booking_cancelled: ({ spaceName, startTime, reason, bookingId }) => {
    const title = "Đơn đặt chỗ đã bị hủy";
    const bodyHtml = `
      <p style="margin-top: 0;">Chào bạn,</p>
      <p>Chúng tôi rất tiếc phải thông báo rằng đơn đặt chỗ sau đã bị hủy:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Mã đơn:</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Không gian:</td>
          <td style="padding: 8px 0; text-align: right;">${spaceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Bắt đầu:</td>
          <td style="padding: 8px 0; text-align: right;">${new Date(startTime).toLocaleString("vi-VN")}</td>
        </tr>
        ${reason ? `
        <tr style="border-top: 1px solid #f4f4f5;">
          <td style="padding: 12px 0; font-weight: bold; color: #e11d48;" colspan="2">Lý do hủy:</td>
        </tr>
        <tr>
          <td style="padding: 0 0 12px 0; color: #71717a;" colspan="2">${reason}</td>
        </tr>` : ""}
      </table>
      <p>Số tiền đã thanh toán (nếu có) sẽ được hoàn trả theo chính sách của hệ thống. Liên hệ hỗ trợ nếu cần thêm chi tiết.</p>
    `;
    return {
      subject: "Đơn đặt chỗ đã bị hủy - WorkHub",
      text: `Đơn đặt chỗ ${bookingId} tại ${spaceName} đã bị hủy.${reason ? ` Lý do: ${reason}` : ""}`,
      html: baseHtml({ title, bodyHtml, ctaLabel: "Hỗ trợ khách hàng", ctaUrl: "http://localhost:3000/support" }),
    };
  },

  host_new_booking: ({ spaceName, startTime, endTime, totalAmount, bookingId }) => {
    const title = "Đơn đặt chỗ mới cần phê duyệt";
    const formattedAmount = Number(totalAmount).toLocaleString("vi-VN") + "đ";
    const bodyHtml = `
      <p style="margin-top: 0;">Chào bạn,</p>
      <p>Hệ thống WorkHub vừa ghi nhận một đơn đặt chỗ mới tại cơ sở của bạn đang chờ bạn duyệt:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Mã đơn:</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Không gian:</td>
          <td style="padding: 8px 0; text-align: right;">${spaceName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Thời gian:</td>
          <td style="padding: 8px 0; text-align: right;">${new Date(startTime).toLocaleString("vi-VN")} - ${new Date(endTime).toLocaleString("vi-VN")}</td>
        </tr>
        <tr style="border-top: 1px solid #f4f4f5;">
          <td style="padding: 12px 0; font-weight: bold; font-size: 16px;">Doanh thu dự kiến:</td>
          <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #0d9488; font-size: 16px;">${formattedAmount}</td>
        </tr>
      </table>
      <p>Vui lòng đăng nhập vào trang chủ cơ sở của bạn trên WorkHub để xem và xử lý đơn đặt chỗ này.</p>
    `;
    return {
      subject: "Yêu cầu đặt chỗ mới đang chờ duyệt - WorkHub",
      text: `Yêu cầu đặt chỗ ${bookingId} tại ${spaceName} đang chờ xác nhận.`,
      html: baseHtml({ title, bodyHtml, ctaLabel: "Trang quản trị", ctaUrl: "http://localhost:3000/host/bookings" }),
    };
  },

  payment_received: ({ spaceName, amount, bookingId }) => {
    const title = "Thanh toán đã được tiếp nhận";
    const formattedAmount = Number(amount).toLocaleString("vi-VN") + "đ";
    const bodyHtml = `
      <p style="margin-top: 0;">Chào bạn,</p>
      <p>Chúng tôi đã nhận được thông tin thanh toán của bạn cho đơn đặt chỗ sau:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Mã đơn:</td>
          <td style="padding: 8px 0; text-align: right; font-family: monospace;">${bookingId}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: bold; color: #71717a;">Không gian:</td>
          <td style="padding: 8px 0; text-align: right;">${spaceName}</td>
        </tr>
        <tr style="border-top: 1px solid #f4f4f5;">
          <td style="padding: 12px 0; font-weight: bold; font-size: 16px;">Số tiền tiếp nhận:</td>
          <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #0d9488; font-size: 16px;">${formattedAmount}</td>
        </tr>
      </table>
      <p>Giao dịch của bạn đang được hệ thống đối soát và xác minh. Trạng thái sẽ được cập nhật trong ít phút.</p>
    `;
    return {
      subject: "Tiếp nhận thông tin thanh toán - WorkHub",
      text: `Đã tiếp nhận thanh toán ${formattedAmount} cho đơn đặt chỗ ${bookingId}.`,
      html: baseHtml({ title, bodyHtml, ctaLabel: "Xem chi tiết", ctaUrl: `http://localhost:3000/booking/detail?id=${bookingId}` }),
    };
  },

  generic: ({ subject = "Thông báo từ WorkHub", text, htmlBody }) => {
    const title = subject;
    const bodyHtml = htmlBody || `<p style="margin-top: 0; white-space: pre-wrap;">${text}</p>`;
    return {
      subject,
      text: text || "Bạn có thông báo mới từ hệ thống WorkHub.",
      html: baseHtml({ title, bodyHtml }),
    };
  },
};

function render(templateName, data) {
  const tmpl = templates[templateName] || templates.generic;
  return tmpl(data);
}

module.exports = {
  render,
};
