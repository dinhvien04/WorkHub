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
  loadTickets();
});
