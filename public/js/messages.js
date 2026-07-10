'use strict';
let currentBookingId = '';
async function loadMessages() {
  currentBookingId = document.getElementById('msg-booking')?.value?.trim();
  const list = document.getElementById('msg-list');
  if (!currentBookingId || !list) return;
  DomSafe.clearElement(list);
  const res = await WorkHubAPI.api(`/api/me/bookings/${currentBookingId}/messages`);
  const data = await res.json();
  if (!res.ok) {
    list.appendChild(DomSafe.createTextElement('p', 'error-state', data.error || 'Lỗi'));
    return;
  }
  (data.messages || []).forEach((m) => {
    const row = document.createElement('div');
    row.className = 'border-b border-slate-50 py-2';
    row.appendChild(DomSafe.createTextElement('p', 'text-sm', m.body));
    row.appendChild(
      DomSafe.createTextElement(
        'p',
        'text-[10px] text-slate-400',
        m.createdAt ? new Date(m.createdAt).toLocaleString('vi-VN') : ''
      )
    );
    list.appendChild(row);
  });
}
document.addEventListener('DOMContentLoaded', () => {
  const q = new URLSearchParams(location.search);
  if (q.get('bookingId')) document.getElementById('msg-booking').value = q.get('bookingId');
  document.getElementById('msg-load')?.addEventListener('click', loadMessages);
  document.getElementById('msg-send')?.addEventListener('click', async () => {
    const body = document.getElementById('msg-body').value.trim();
    if (!body || !currentBookingId) return;
    await WorkHubAPI.api(`/api/me/bookings/${currentBookingId}/messages`, {
      method: 'POST',
      body: { body },
    });
    document.getElementById('msg-body').value = '';
    loadMessages();
  });
  if (document.getElementById('msg-booking')?.value) loadMessages();
});
