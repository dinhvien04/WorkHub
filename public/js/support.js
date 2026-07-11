'use strict';
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('support-form');
  const list = document.getElementById('support-list');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const res = await WorkHubAPI.api('/api/support/tickets', {
      method: 'POST',
      body: {
        subject: fd.get('subject'),
        body: fd.get('body'),
        bookingId: fd.get('bookingId') || undefined,
      },
    });
    const data = await res.json();
    document.getElementById('support-msg').textContent = res.ok
      ? 'Đã gửi ticket'
      : data.error || 'Lỗi';
    if (res.ok) loadTickets();
  });
  async function loadTickets() {
    if (!list) return;
    DomSafe.clearElement(list);
    const res = await WorkHubAPI.api('/api/support/tickets');
    if (!res.ok) return;
    const data = await res.json();
    (data.tickets || []).forEach((t) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-2xl p-4';
      card.appendChild(DomSafe.createTextElement('p', 'font-bold text-sm', t.Subject));
      card.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-500', t.Status));
      list.appendChild(card);
    });
  }

  async function loadDisputes() {
    const box = document.getElementById('dispute-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/disputes', { redirectOn401: false });
    if (!res.ok) {
      box.appendChild(
        DomSafe.createTextElement('p', 'text-xs text-slate-400', 'Đăng nhập để xem dispute.')
      );
      return;
    }
    const data = await res.json();
    const items = data.disputes || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400', 'Chưa có dispute.'));
      return;
    }
    items.forEach((d) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-2xl p-4';
      card.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-bold text-sm',
          (d.Status || d.status || '') + ' · ' + (d.Reason || d.reason || '').slice(0, 80)
        )
      );
      card.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500 font-mono',
          String(d.BookingID || d.bookingId || d._id || '')
        )
      );
      box.appendChild(card);
    });
  }

  async function loadMyRefunds() {
    const box = document.getElementById('my-refund-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/refunds?limit=20', { redirectOn401: false });
    if (!res.ok) return;
    const data = await res.json();
    const items = data.refunds || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400', 'Chưa có hoàn tiền.'));
      return;
    }
    items.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'bg-white border rounded-2xl p-3';
      row.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-semibold',
          `${Number(r.Amount || 0).toLocaleString('vi-VN')}đ · ${r.Status}`
        )
      );
      row.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          'booking ' + String(r.BookingID || '') + (r.Reason ? ' · ' + r.Reason : '')
        )
      );
      box.appendChild(row);
    });
  }

  loadTickets();
  loadDisputes();
  loadMyRefunds();
});
