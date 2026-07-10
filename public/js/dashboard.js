'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await WorkHubAPI.api('/api/me/dashboard');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi');

    const counts = document.getElementById('dash-counts');
    counts.replaceChildren();
    [
      ['Sắp tới', data.counts?.upcoming],
      ['Cần làm', data.counts?.actionRequired],
      ['Chờ TT', data.counts?.paymentPending],
      ['Yêu thích', data.counts?.favorites],
    ].forEach(([label, n]) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-2xl p-3 text-center';
      card.appendChild(DomSafe.createTextElement('p', 'text-xl font-black text-teal-700', String(n || 0)));
      card.appendChild(DomSafe.createTextElement('p', 'text-[10px] font-black uppercase text-slate-400', label));
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

    fillList(document.getElementById('dash-action'), data.actionRequired, (b) => {
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
          (b.Status || '') +
            (b.HoldExpiresAt
              ? ' · hết hạn ' + new Date(b.HoldExpiresAt).toLocaleString('vi-VN')
              : '')
        )
      );
      return a;
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
  } catch (e) {
    document.getElementById('dash-action').textContent = e.message || 'Lỗi tải dashboard';
  }
});
