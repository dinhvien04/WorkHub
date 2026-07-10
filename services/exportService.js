'use strict';

/**
 * CSV / simple receipt helpers (no card data).
 */
function escapeCsv(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function ledgerToCsv(entries) {
  const header = ['Date', 'Type', 'Direction', 'Amount', 'Description', 'IdempotencyKey'];
  const rows = [header.join(',')];
  for (const e of entries || []) {
    rows.push(
      [
        e.createdAt ? new Date(e.createdAt).toISOString() : '',
        e.Type,
        e.Direction,
        e.Amount,
        e.Description || '',
        e.IdempotencyKey || '',
      ]
        .map(escapeCsv)
        .join(',')
    );
  }
  return rows.join('\n') + '\n';
}

function bookingReceiptHtml(booking, payments = []) {
  const snap = booking.Snapshot || {};
  const addOns = (booking.AddOns || [])
    .map(
      (a) =>
        `<tr><td>${escapeHtml(a.Name)}</td><td>${a.Quantity}</td><td>${Number(a.LineTotal || 0).toLocaleString('vi-VN')}đ</td></tr>`
    )
    .join('');
  const payRows = payments
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.Status)}</td><td>${Number(p.Amount || 0).toLocaleString('vi-VN')}đ</td><td>${escapeHtml(p.TransactionCode || '')}</td></tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"><title>Receipt ${booking._id}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;color:#0f172a}
h1{font-size:1.25rem}table{width:100%;border-collapse:collapse;margin:1rem 0}
td,th{border:1px solid #e2e8f0;padding:.5rem;text-align:left;font-size:.875rem}
.muted{color:#64748b;font-size:.8rem}
</style></head><body>
<h1>WorkHub — Biên lai / Receipt</h1>
<p class="muted">Booking ID: ${booking._id}</p>
<p><strong>${escapeHtml(snap.SpaceName || '')}</strong><br>${escapeHtml(snap.BranchName || '')}<br>${escapeHtml(snap.Address || '')}</p>
<p>${new Date(booking.StartTime).toLocaleString('vi-VN')} → ${new Date(booking.EndTime).toLocaleString('vi-VN')}</p>
<p>Trạng thái: <strong>${escapeHtml(booking.Status)}</strong></p>
<table>
<tr><th>Hạng mục</th><th>SL</th><th>Thành tiền</th></tr>
<tr><td>Phí thuê (base)</td><td>1</td><td>${Number(booking.BaseAmount || booking.TotalAmount || 0).toLocaleString('vi-VN')}đ</td></tr>
${addOns}
${booking.DiscountAmount ? `<tr><td>Giảm giá ${escapeHtml(booking.CouponCode || '')}</td><td></td><td>-${Number(booking.DiscountAmount).toLocaleString('vi-VN')}đ</td></tr>` : ''}
<tr><th colspan="2">Tổng</th><th>${Number(booking.TotalAmount || 0).toLocaleString('vi-VN')}đ</th></tr>
<tr><td colspan="2">Cọc</td><td>${Number(booking.DepositAmount || 0).toLocaleString('vi-VN')}đ</td></tr>
</table>
${payments.length ? `<h2>Thanh toán</h2><table><tr><th>TT</th><th>Số tiền</th><th>Mã</th></tr>${payRows}</table>` : ''}
<p class="muted">In hoặc lưu PDF từ trình duyệt. Không chứa dữ liệu thẻ.</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { ledgerToCsv, bookingReceiptHtml, escapeCsv };
