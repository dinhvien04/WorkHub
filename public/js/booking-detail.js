'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  const bookingId = params.get('id') || params.get('bookingId');
  const errEl = document.getElementById('bd-error');
  if (!bookingId) {
    errEl.textContent = 'Thiếu booking id.';
    errEl.classList.remove('hidden');
    return;
  }
  document.getElementById('bd-id').textContent = bookingId;

  try {
    const [detailRes, tlRes] = await Promise.all([
      WorkHubAPI.api(`/api/customers/me/bookings/${bookingId}`),
      WorkHubAPI.api(`/api/bookings/${bookingId}/timeline`),
    ]);
    const detail = await detailRes.json();
    const tl = await tlRes.json();
    if (!detailRes.ok) throw new Error(detail.error || 'Không tải được booking');

    const b = detail.booking || {};
    const sum = document.getElementById('bd-summary');
    sum.replaceChildren();
    [
      `Trạng thái: ${b.Status || b.status}`,
      `Phòng: ${b.Snapshot?.SpaceName || b.snapshot?.SpaceName || '—'}`,
      `Địa chỉ: ${b.Snapshot?.Address || b.snapshot?.Address || '—'}`,
      `Bắt đầu: ${b.StartTime ? new Date(b.StartTime).toLocaleString('vi-VN') : '—'}`,
      `Kết thúc: ${b.EndTime ? new Date(b.EndTime).toLocaleString('vi-VN') : '—'}`,
      `Tổng: ${Number(b.TotalAmount || b.totalAmount || 0).toLocaleString('vi-VN')}đ`,
      `Cọc: ${Number(b.DepositAmount || b.depositAmount || 0).toLocaleString('vi-VN')}đ`,
    ].forEach((t) => sum.appendChild(DomSafe.createTextElement('p', '', t)));

    const pol = b.CancellationPolicy || detail.cancelPreview?.policy;
    document.getElementById('bd-policy').textContent =
      pol?.summary || detail.cancelPreview?.processingNote || '';

    document.getElementById('bd-pay').textContent =
      'UI: ' +
      (detail.paymentUiStatus || '—') +
      ' · Đã trả: ' +
      Number(detail.paymentProgress?.paidAmount || 0).toLocaleString('vi-VN') +
      'đ';

    const receipt = document.getElementById('bd-receipt');
    receipt.href = `/api/bookings/${bookingId}/receipt`;
    receipt.classList.remove('hidden');

    const ol = document.getElementById('bd-timeline');
    ol.replaceChildren();
    (tl.events || []).forEach((ev) => {
      const li = document.createElement('li');
      li.className = 'border-l-2 border-teal-400 pl-3';
      li.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-semibold',
          ev.label || ev.type
        )
      );
      if (ev.at) {
        li.appendChild(
          DomSafe.createTextElement(
            'p',
            'text-xs text-slate-400',
            new Date(ev.at).toLocaleString('vi-VN')
          )
        );
      }
      ol.appendChild(li);
    });

    const links = detail.calendarLinks || {};
    if (links.google) document.getElementById('bd-gcal').href = links.google;
    if (links.outlook) document.getElementById('bd-outlook').href = links.outlook;
    document.getElementById('bd-ics').href = links.icsPath || `/api/me/bookings/${bookingId}/ics`;

    const cp = detail.cancelPreview || tl.cancelPreview;
    if (cp) {
      document.getElementById('bd-cancel-preview').textContent =
        (cp.withinFreeWindow ? 'Trong cửa sổ hủy miễn phí. ' : 'Ngoài cửa sổ miễn phí. ') +
        `Hoàn ước tính ${Number(cp.refundAmount || 0).toLocaleString('vi-VN')}đ (${cp.refundPercent}%). ` +
        (cp.processingNote || '');
    }

    const cancelBtn = document.getElementById('bd-cancel-btn');
    if (!cp?.canCancel) {
      cancelBtn.disabled = true;
      cancelBtn.classList.add('opacity-50');
    }
    cancelBtn.addEventListener('click', async () => {
      if (!confirm('Xác nhận hủy booking?')) return;
      const res = await WorkHubAPI.api(`/api/customers/me/bookings/${bookingId}/cancel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'customer_request' }),
      });
      const data = await res.json().catch(() => ({}));
      const msg = document.getElementById('bd-cancel-msg');
      if (!res.ok) {
        msg.textContent = data.error || 'Hủy thất bại';
        msg.className = 'text-sm mt-2 text-red-600';
        return;
      }
      msg.textContent = data.message || 'Đã hủy.';
      msg.className = 'text-sm mt-2 text-teal-700 font-bold';
      setTimeout(() => location.reload(), 800);
    });
  } catch (e) {
    errEl.textContent = e.message || 'Lỗi';
    errEl.classList.remove('hidden');
  }
});
