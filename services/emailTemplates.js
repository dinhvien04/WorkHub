'use strict';

/**
 * Transactional email templates (text + simple HTML).
 * No secrets; amounts as display strings only.
 */

const BRAND = 'WorkHub';
const FROM_NAME = 'WorkHub';

function baseHtml({ title, bodyHtml, ctaLabel, ctaUrl }) {
  const cta = ctaUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(ctaUrl)}" style="background:#0d9488;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">${escapeHtml(ctaLabel || 'Mở WorkHub')}</a></p>`
    : '';
  return `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;background:#f8fafc;padding:24px;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px">
    <div style="font-weight:800;color:#0d9488;font-size:18px;margin-bottom:8px">${BRAND}</div>
    <h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>
    <div style="font-size:14px;line-height:1.55;color:#334155">${bodyHtml}</div>
    ${cta}
    <p style="font-size:11px;color:#94a3b8;margin-top:28px">Email tự động từ ${BRAND}. Không trả lời nếu không yêu cầu.</p>
  </div></body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(n) {
  return `${Number(n || 0).toLocaleString('vi-VN')}đ`;
}

function formatWhen(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('vi-VN');
  } catch {
    return String(d);
  }
}

const templates = {
  password_reset({ otp }) {
    const subject = `${BRAND}: mã đặt lại mật khẩu`;
    const text = `Mã đặt lại mật khẩu của bạn là: ${otp}\nMã có hiệu lực trong vài phút. Không chia sẻ mã này.`;
    const html = baseHtml({
      title: 'Đặt lại mật khẩu',
      bodyHtml: `<p>Mã OTP của bạn:</p><p style="font-size:28px;font-weight:800;letter-spacing:4px;color:#0d9488">${escapeHtml(otp)}</p><p>Không chia sẻ mã này với bất kỳ ai.</p>`,
    });
    return { subject, text, html };
  },

  booking_created({ customerName, spaceName, startTime, endTime, totalAmount, bookingId, baseUrl }) {
    const subject = `${BRAND}: đã tạo đơn đặt chỗ`;
    const text = `Xin chào ${customerName || 'bạn'},\nĐơn đặt "${spaceName}" đã được tạo.\nThời gian: ${formatWhen(startTime)} → ${formatWhen(endTime)}\nTổng: ${formatMoney(totalAmount)}\nMã: ${bookingId}`;
    const html = baseHtml({
      title: 'Đã tạo đơn đặt chỗ',
      bodyHtml: `<p>Xin chào <strong>${escapeHtml(customerName || 'bạn')}</strong>,</p>
        <p>Đơn <strong>${escapeHtml(spaceName || 'không gian')}</strong> đã được tạo.</p>
        <ul><li>Bắt đầu: ${escapeHtml(formatWhen(startTime))}</li>
        <li>Kết thúc: ${escapeHtml(formatWhen(endTime))}</li>
        <li>Tổng: <strong>${escapeHtml(formatMoney(totalAmount))}</strong></li></ul>`,
      ctaLabel: 'Xem đơn',
      ctaUrl: baseUrl ? `${baseUrl}/booking/detail?id=${bookingId}` : undefined,
    });
    return { subject, text, html };
  },

  booking_confirmed({ customerName, spaceName, startTime, endTime, bookingId, baseUrl }) {
    const subject = `${BRAND}: host đã xác nhận đơn`;
    const text = `Xin chào ${customerName || 'bạn'},\nHost đã xác nhận đơn "${spaceName}".\nThời gian: ${formatWhen(startTime)} → ${formatWhen(endTime)}\nBạn có thể dùng mã check-in trên dashboard khi đến nơi.`;
    const html = baseHtml({
      title: 'Đơn đã được xác nhận',
      bodyHtml: `<p>Xin chào <strong>${escapeHtml(customerName || 'bạn')}</strong>,</p>
        <p>Host đã <strong>xác nhận</strong> đơn <strong>${escapeHtml(spaceName || '')}</strong>.</p>
        <p>${escapeHtml(formatWhen(startTime))} → ${escapeHtml(formatWhen(endTime))}</p>
        <p>Mở dashboard để lấy mã check-in QR khi đến nơi.</p>`,
      ctaLabel: 'Mở dashboard',
      ctaUrl: baseUrl ? `${baseUrl}/dashboard` : undefined,
    });
    return { subject, text, html };
  },

  booking_cancelled({ customerName, spaceName, startTime, reason, bookingId, baseUrl }) {
    const subject = `${BRAND}: đơn đã hủy`;
    const text = `Đơn "${spaceName}" (${formatWhen(startTime)}) đã bị hủy.\nLý do: ${reason || '—'}`;
    const html = baseHtml({
      title: 'Đơn đặt chỗ đã hủy',
      bodyHtml: `<p>Xin chào <strong>${escapeHtml(customerName || 'bạn')}</strong>,</p>
        <p>Đơn <strong>${escapeHtml(spaceName || '')}</strong> lúc ${escapeHtml(formatWhen(startTime))} đã bị hủy.</p>
        <p>Lý do: ${escapeHtml(reason || '—')}</p>`,
      ctaLabel: 'Xem lịch sử',
      ctaUrl: baseUrl ? `${baseUrl}/history` : undefined,
    });
    return { subject, text, html };
  },

  host_new_booking({ hostName, spaceName, startTime, endTime, totalAmount, bookingId, baseUrl }) {
    const subject = `${BRAND}: đơn mới cần xử lý`;
    const text = `Host ${hostName || ''},\nCó đơn mới cho ${spaceName}.\n${formatWhen(startTime)} → ${formatWhen(endTime)}\nTổng ${formatMoney(totalAmount)}`;
    const html = baseHtml({
      title: 'Đơn đặt chỗ mới',
      bodyHtml: `<p>Có đơn mới cho <strong>${escapeHtml(spaceName || '')}</strong>.</p>
        <ul><li>${escapeHtml(formatWhen(startTime))} → ${escapeHtml(formatWhen(endTime))}</li>
        <li>Tổng: ${escapeHtml(formatMoney(totalAmount))}</li></ul>`,
      ctaLabel: 'Mở inbox host',
      ctaUrl: baseUrl ? `${baseUrl}/host/bookings` : undefined,
    });
    return { subject, text, html };
  },

  payment_received({ toName, amount, bookingId, baseUrl }) {
    const subject = `${BRAND}: đã ghi nhận thanh toán (chờ xác minh)`;
    const text = `Thanh toán ${formatMoney(amount)} cho booking ${bookingId} đã được ghi nhận, chờ host xác minh.`;
    const html = baseHtml({
      title: 'Thanh toán đã gửi',
      bodyHtml: `<p>Xin chào <strong>${escapeHtml(toName || 'bạn')}</strong>,</p>
        <p>Khoản <strong>${escapeHtml(formatMoney(amount))}</strong> đã được ghi nhận ở trạng thái chờ host xác minh.</p>`,
      ctaLabel: 'Chi tiết booking',
      ctaUrl: baseUrl ? `${baseUrl}/booking/detail?id=${bookingId}` : undefined,
    });
    return { subject, text, html };
  },

  generic({ subject, title, body, ctaLabel, ctaUrl }) {
    const text = body || subject || BRAND;
    const html = baseHtml({
      title: title || subject || BRAND,
      bodyHtml: `<p>${escapeHtml(body || '')}</p>`,
      ctaLabel,
      ctaUrl,
    });
    return { subject: subject || BRAND, text, html };
  },
};

function render(templateName, data = {}) {
  const fn = templates[templateName];
  if (!fn) {
    return templates.generic({
      subject: data.subject || BRAND,
      title: data.title || templateName,
      body: data.body || data.text || '',
      ctaUrl: data.ctaUrl,
      ctaLabel: data.ctaLabel,
    });
  }
  return fn(data);
}

function listTemplates() {
  return Object.keys(templates);
}

module.exports = {
  render,
  listTemplates,
  templates,
  FROM_NAME,
  BRAND,
};
