'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const modal = document.getElementById('dash-qr-modal');
  const qrImg = document.getElementById('dash-qr-img');
  const qrCode = document.getElementById('dash-qr-code');
  const qrExp = document.getElementById('dash-qr-exp');
  const qrTitle = document.getElementById('dash-qr-title');
  let lastToken = '';

  function openQrModal() {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  function closeQrModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  document.getElementById('dash-qr-close')?.addEventListener('click', closeQrModal);
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeQrModal();
  });
  document.getElementById('dash-qr-copy')?.addEventListener('click', async () => {
    if (!lastToken) return;
    try {
      await navigator.clipboard.writeText(lastToken);
      alert('Đã copy token check-in.');
    } catch {
      window.prompt('Copy token:', lastToken);
    }
  });

  async function mintAndShow(bookingId, spaceName) {
    const res = await WorkHubAPI.api(`/api/bookings/${bookingId}/check-in-token`, {
      method: 'POST',
      body: {},
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Không tạo được mã QR');
      return;
    }
    lastToken = data.token || '';
    const payload = data.token || data.code || '';
    // External QR image (img-src allows https)
    const src =
      'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' +
      encodeURIComponent(payload);
    if (qrImg) {
      qrImg.src = src;
      qrImg.alt = 'QR ' + (data.code || '');
    }
    if (qrCode) qrCode.textContent = data.code || '';
    if (qrExp)
      qrExp.textContent = data.expiresAt
        ? 'Hết hạn: ' + new Date(data.expiresAt).toLocaleString('vi-VN')
        : '';
    if (qrTitle) qrTitle.textContent = spaceName || 'Booking';
    openQrModal();
  }

  try {
    const res = await WorkHubAPI.api('/api/me/dashboard');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi');

    const counts = document.getElementById('dash-counts');
    counts.replaceChildren();
    [
      ['Sắp tới', data.counts?.upcoming],
      ['Cần làm', data.counts?.actionRequired],
      ['Check-in', data.counts?.checkInReady],
      ['Chờ TT', data.counts?.paymentPending],
      ['Yêu thích', data.counts?.favorites],
    ].forEach(([label, n]) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-2xl p-3 text-center';
      card.appendChild(
        DomSafe.createTextElement('p', 'text-xl font-black text-teal-700', String(n || 0))
      );
      card.appendChild(
        DomSafe.createTextElement('p', 'text-[10px] font-black uppercase text-slate-400', label)
      );
      counts.appendChild(card);
    });

    function fillList(el, items, mapFn) {
      el.replaceChildren();
      if (!items || !items.length) {
        el.appendChild(DomSafe.createTextElement('p', 'text-slate-400', 'Không có mục nào.'));
        return;
      }
      items.forEach((item) => el.appendChild(mapFn(item)));
    }

    fillList(document.getElementById('dash-checkin'), data.checkInReady, (b) => {
      const row = document.createElement('div');
      row.className = 'border rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2';
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement('p', 'font-bold', b.Snapshot?.SpaceName || 'Booking')
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          (b.Status || '') +
            ' · ' +
            (b.StartTime ? new Date(b.StartTime).toLocaleString('vi-VN') : '') +
            ' · ' +
            (b.bookingCode || '')
        )
      );
      row.appendChild(left);
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      const qrBtn = document.createElement('button');
      qrBtn.type = 'button';
      qrBtn.className =
        'text-[10px] font-black uppercase bg-teal-600 text-white px-3 py-2 rounded-xl';
      qrBtn.textContent = 'Hiện QR';
      qrBtn.addEventListener('click', () =>
        mintAndShow(b._id, b.Snapshot?.SpaceName || 'Booking')
      );
      const pay = document.createElement('a');
      pay.href = '/booking/detail?id=' + b._id;
      pay.className =
        'text-[10px] font-black uppercase border px-3 py-2 rounded-xl text-slate-700 no-underline';
      pay.textContent = 'Chi tiết';
      actions.appendChild(qrBtn);
      actions.appendChild(pay);
      row.appendChild(actions);
      return row;
    });

    fillList(document.getElementById('dash-action'), data.actionRequired, (b) => {
      const wrap = document.createElement('div');
      wrap.className = 'border rounded-xl p-3 flex flex-col sm:flex-row sm:justify-between gap-2';
      const a = document.createElement('a');
      a.href = '/booking/detail?id=' + b._id;
      a.className = 'no-underline text-inherit flex-1';
      a.appendChild(
        DomSafe.createTextElement('p', 'font-bold', b.Snapshot?.SpaceName || 'Booking')
      );
      a.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          (b.Status || '') +
            (b.HoldExpiresAt
              ? ' · hết hạn ' + new Date(b.HoldExpiresAt).toLocaleString('vi-VN')
              : '')
        )
      );
      wrap.appendChild(a);
      if (['hold', 'pending', 'awaiting_payment'].includes(b.Status)) {
        const payBtn = document.createElement('a');
        payBtn.href = '/payment?bookingId=' + b._id;
        payBtn.className =
          'text-[10px] font-black uppercase bg-amber-500 text-white px-3 py-2 rounded-xl no-underline self-start';
        payBtn.textContent = 'Thanh toán';
        wrap.appendChild(payBtn);
      }
      return wrap;
    });

    fillList(document.getElementById('dash-upcoming'), data.upcoming, (b) => {
      const a = document.createElement('a');
      a.href = '/booking/detail?id=' + b._id;
      a.className = 'block border rounded-xl p-3 hover:border-teal-400 no-underline text-inherit';
      a.appendChild(
        DomSafe.createTextElement('p', 'font-bold', b.Snapshot?.SpaceName || 'Booking')
      );
      a.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          new Date(b.StartTime).toLocaleString('vi-VN') + ' · ' + (b.Status || '')
        )
      );
      return a;
    });

    fillList(document.getElementById('dash-pay'), data.paymentPending, (p) => {
      const row = document.createElement('div');
      row.className = 'border rounded-xl p-3';
      row.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-bold',
          Number(p.Amount || 0).toLocaleString('vi-VN') + 'đ · ' + (p.Status || '')
        )
      );
      row.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          'Booking ' + String(p.BookingID || '').slice(-6)
        )
      );
      return row;
    });

    // Apply i18n if available
    if (window.WorkHubI18n && WorkHubI18n.apply) WorkHubI18n.apply();
  } catch (e) {
    document.getElementById('dash-action').textContent = e.message || 'Lỗi tải dashboard';
  }
});
