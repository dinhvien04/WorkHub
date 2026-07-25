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

  let holdTimer = null;
  function startHold(expiresAt) {
    const el = document.getElementById('bd-hold');
    if (!el || !expiresAt) return;
    if (holdTimer) clearInterval(holdTimer);
    function tick() {
      const ms = new Date(expiresAt) - Date.now();
      if (ms <= 0) {
        el.textContent = 'Hết thời gian giữ chỗ — booking có thể hết hạn.';
        el.classList.remove('hidden');
        el.classList.add('text-red-700', 'bg-red-50', 'border-red-100');
        clearInterval(holdTimer);
        return;
      }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      el.textContent = `Giữ chỗ còn ${m}:${String(s).padStart(2, '0')} — thanh toán trước khi hết hạn.`;
      el.classList.remove('hidden');
    }
    tick();
    holdTimer = setInterval(tick, 1000);
  }

  function toLocalInputValue(d) {
    if (!d) return '';
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
  }

  function fromLocalInput(val) {
    if (!val) return null;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

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

    const holdAt = b.HoldExpiresAt || b.holdExpiresAt;
    if (holdAt && ['pending', 'hold', 'awaiting_payment'].includes(b.Status || b.status)) {
      startHold(holdAt);
    }

    // Check-in QR for confirmed / in-use
    const st = b.Status || b.status;
    const checkSec = document.getElementById('bd-checkin-section');
    if (checkSec && ['confirmed', 'in-use'].includes(st) && !(b.CheckInAt || b.checkInAt)) {
      checkSec.classList.remove('hidden');
      document.getElementById('bd-qr-btn')?.addEventListener('click', async () => {
        const res = await WorkHubAPI.api(`/api/bookings/${bookingId}/check-in-token`, {
          method: 'POST',
          body: {},
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Không tạo được QR');
          return;
        }
        const codeEl = document.getElementById('bd-qr-code');
        const img = document.getElementById('bd-qr-img');
        const exp = document.getElementById('bd-qr-exp');
        if (codeEl) codeEl.textContent = data.code || '';
        if (img) {
          img.src =
            'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' +
            encodeURIComponent(data.token || data.code || '');
          img.classList.remove('hidden');
        }
        if (exp && data.expiresAt) {
          exp.textContent = 'Hết hạn: ' + new Date(data.expiresAt).toLocaleString('vi-VN');
        }
      });
    }

    const pol = b.CancellationPolicy || b.cancellationPolicy || detail.cancelPreview?.policy;
    document.getElementById('bd-policy').textContent =
      pol?.summary || detail.cancelPreview?.processingNote || '';

    document.getElementById('bd-pay').textContent =
      'UI: ' +
      (detail.paymentUiStatus || '—') +
      ' · Đã trả: ' +
      Number(detail.paymentProgress?.paidAmount || 0).toLocaleString('vi-VN') +
      'đ';

    const payLink = document.getElementById('bd-pay-link');
    if (
      payLink &&
      ['pending', 'hold', 'awaiting_payment', 'payment_under_review'].includes(b.Status || b.status) &&
      detail.paymentUiStatus !== 'paid_in_full'
    ) {
      payLink.href = `/payment?bookingId=${bookingId}`;
      payLink.classList.remove('hidden');
    }

    const receipt = document.getElementById('bd-receipt');
    receipt.href = `/api/bookings/${bookingId}/receipt`;
    receipt.classList.remove('hidden');

    const ol = document.getElementById('bd-timeline');
    ol.replaceChildren();
    (tl.events || []).forEach((ev) => {
      const li = document.createElement('li');
      li.className = 'border-l-2 border-teal-400 pl-3';
      li.appendChild(DomSafe.createTextElement('p', 'font-semibold', ev.label || ev.type));
      if (ev.at) {
        li.appendChild(
          DomSafe.createTextElement('p', 'text-xs text-slate-400', new Date(ev.at).toLocaleString('vi-VN'))
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
        body: { reason: 'customer_request' },
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

    // Messages deep-link
    const msgLink = document.getElementById('bd-messages');
    if (msgLink) msgLink.href = '/messages?bookingId=' + encodeURIComponent(bookingId);

    // Refunds from timeline events
    const refundList = document.getElementById('bd-refund-list');
    if (refundList) {
      DomSafe.clearElement(refundList);
      const refundEv = (tl.events || []).filter((e) => e.type === 'refund');
      if (refundEv.length) {
        refundEv.forEach((ev) => {
          refundList.appendChild(
            DomSafe.createTextElement(
              'li',
              '',
              `${ev.label || 'Hoàn'} · ${Number(ev.meta?.amount || 0).toLocaleString('vi-VN')}đ` +
                (ev.at ? ' · ' + new Date(ev.at).toLocaleString('vi-VN') : '')
            )
          );
        });
      } else {
        refundList.appendChild(
          DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có yêu cầu hoàn.')
        );
      }
    }

    document.getElementById('bd-refund-btn')?.addEventListener('click', async () => {
      const msg = document.getElementById('bd-refund-msg');
      const amount = Number(document.getElementById('bd-refund-amount')?.value || 0);
      const reason = (document.getElementById('bd-refund-reason')?.value || '').trim();
      if (!amount || amount <= 0) {
        msg.textContent = 'Nhập số tiền hoàn hợp lệ.';
        msg.className = 'text-sm mt-2 text-red-600';
        return;
      }
      const idem = 'refund-ui-' + bookingId + '-' + Date.now();
      const res = await WorkHubAPI.api(`/api/bookings/${bookingId}/refunds`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idem },
        body: { amount, reason: reason || undefined },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || 'Yêu cầu hoàn thất bại';
        msg.className = 'text-sm mt-2 text-red-600';
        return;
      }
      msg.textContent =
        'Đã tạo hoàn ' +
        Number(data.refund?.Amount || amount).toLocaleString('vi-VN') +
        'đ · ' +
        (data.refund?.Status || 'requested');
      msg.className = 'text-sm mt-2 text-teal-700 font-bold';
      setTimeout(() => location.reload(), 900);
    });

    document.getElementById('bd-dispute-btn')?.addEventListener('click', async () => {
      const msg = document.getElementById('bd-dispute-msg');
      const reason = (document.getElementById('bd-dispute-reason')?.value || '').trim();
      if (reason.length < 5) {
        msg.textContent = 'Lý do tối thiểu 5 ký tự.';
        msg.className = 'text-sm mt-2 text-red-600';
        return;
      }
      const res = await WorkHubAPI.api(`/api/bookings/${bookingId}/disputes`, {
        method: 'POST',
        body: { reason },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msg.textContent = data.error || 'Mở dispute thất bại';
        msg.className = 'text-sm mt-2 text-red-600';
        return;
      }
      msg.textContent = 'Đã mở dispute · ' + (data.dispute?.Status || 'open');
      msg.className = 'text-sm mt-2 text-teal-700 font-bold';
    });

    // —— Reschedule ——
    if (detail.canReschedule) {
      const section = document.getElementById('bd-reschedule-section');
      section.classList.remove('hidden');
      const startEl = document.getElementById('bd-rs-start');
      const endEl = document.getElementById('bd-rs-end');
      startEl.value = toLocalInputValue(b.StartTime);
      endEl.value = toLocalInputValue(b.EndTime);
      const applyBtn = document.getElementById('bd-rs-apply');
      const box = document.getElementById('bd-rs-preview-box');
      const rsMsg = document.getElementById('bd-rs-msg');
      let lastPreview = null;

      document.getElementById('bd-rs-preview').addEventListener('click', async () => {
        rsMsg.textContent = '';
        DomSafe.clearElement(box);
        applyBtn.disabled = true;
        const startTime = fromLocalInput(startEl.value);
        const endTime = fromLocalInput(endEl.value);
        if (!startTime || !endTime) {
          rsMsg.textContent = 'Chọn thời gian hợp lệ.';
          rsMsg.className = 'text-sm mt-2 text-red-600';
          return;
        }
        const res = await WorkHubAPI.api(
          `/api/bookings/${bookingId}/reschedule-preview`,
          {
            method: 'POST',
            body: { startTime, endTime },
          }
        );
        const data = await res.json();
        if (!res.ok) {
          rsMsg.textContent = data.error || 'Không xem trước được';
          rsMsg.className = 'text-sm mt-2 text-red-600';
          return;
        }
        lastPreview = data.preview;
        box.appendChild(
          DomSafe.createTextElement(
            'p',
            lastPreview.available ? 'text-teal-700 font-bold' : 'text-red-600 font-bold',
            lastPreview.note
          )
        );
        if (lastPreview.quote) {
          box.appendChild(
            DomSafe.createTextElement(
              'p',
              '',
              `Giá mới ước tính: ${Number(lastPreview.quote.totalAmount).toLocaleString('vi-VN')}đ (Δ ${Number(lastPreview.quote.priceDelta).toLocaleString('vi-VN')}đ)`
            )
          );
          box.appendChild(
            DomSafe.createTextElement(
              'p',
              'text-xs text-slate-500',
              `Cọc: ${Number(lastPreview.quote.depositAmount).toLocaleString('vi-VN')}đ · ${lastPreview.quote.hours}h`
            )
          );
        }
        applyBtn.disabled = !lastPreview.canApply;
      });

      applyBtn.addEventListener('click', async () => {
        if (!lastPreview?.canApply) return;
        if (!confirm('Xác nhận đổi lịch booking?')) return;
        const startTime = fromLocalInput(startEl.value);
        const endTime = fromLocalInput(endEl.value);
        const res = await WorkHubAPI.api(`/api/bookings/${bookingId}/reschedule`, {
          method: 'PUT',
          body: { startTime, endTime },
        });
        const data = await res.json();
        if (!res.ok) {
          rsMsg.textContent = data.error || 'Đổi lịch thất bại';
          rsMsg.className = 'text-sm mt-2 text-red-600';
          return;
        }
        rsMsg.textContent = data.message || 'Đã đổi lịch.';
        rsMsg.className = 'text-sm mt-2 text-teal-700 font-bold';
        setTimeout(() => location.reload(), 900);
      });
    }
  } catch (e) {
    errEl.textContent = e.message || 'Lỗi';
    errEl.classList.remove('hidden');
  }
});
