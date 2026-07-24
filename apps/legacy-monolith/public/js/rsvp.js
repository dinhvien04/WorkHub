'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('rsvp-page');
  const token = root?.getAttribute('data-token') || '';
  const errEl = document.getElementById('rsvp-error');
  if (!token) {
    errEl.textContent = 'Thiếu token.';
    errEl.classList.remove('hidden');
    return;
  }

  async function load() {
    const res = await fetch(`/api/rsvp/${encodeURIComponent(token)}`, { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Không tải được lời mời';
      errEl.classList.remove('hidden');
      return null;
    }
    const info = document.getElementById('rsvp-info');
    DomSafe.clearElement(info);
    const b = data.booking || {};
    [
      `Khách: ${data.invite?.name || data.invite?.email || '—'}`,
      `Email: ${data.invite?.email || '—'}`,
      `Sự kiện: ${b.spaceName || b.snapshot?.SpaceName || '—'}`,
      `Địa chỉ: ${b.address || b.snapshot?.Address || '—'}`,
      `Bắt đầu: ${b.startTime ? new Date(b.startTime).toLocaleString('vi-VN') : '—'}`,
      `Kết thúc: ${b.endTime ? new Date(b.endTime).toLocaleString('vi-VN') : '—'}`,
    ].forEach((t) => info.appendChild(DomSafe.createTextElement('p', '', t)));
    document.getElementById('rsvp-status').textContent = data.invite?.rsvpStatus
      ? `Trạng thái: ${data.invite.rsvpStatus}`
      : '';

    const cal = document.getElementById('rsvp-cal');
    DomSafe.clearElement(cal);
    const links = data.calendarLinks || {};
    if (links.google || links.outlook) {
      cal.classList.remove('hidden');
      if (links.google) {
        const a = document.createElement('a');
        a.href = links.google;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'text-xs font-black uppercase bg-slate-800 text-white px-3 py-2 rounded-xl';
        a.textContent = 'Google Calendar';
        cal.appendChild(a);
      }
      if (links.outlook) {
        const a = document.createElement('a');
        a.href = links.outlook;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = 'text-xs font-black uppercase border px-3 py-2 rounded-xl';
        a.textContent = 'Outlook';
        cal.appendChild(a);
      }
    }
    return data;
  }

  async function send(status) {
    errEl.classList.add('hidden');
    // CSRF for POST
    const res = await WorkHubAPI.api(`/api/rsvp/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { status },
      redirectOn401: false,
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'RSVP thất bại';
      errEl.classList.remove('hidden');
      return;
    }
    document.getElementById('rsvp-status').textContent = `Trạng thái: ${data.invite?.rsvpStatus}`;
  }

  await load();
  document.getElementById('rsvp-yes')?.addEventListener('click', () => send('accepted'));
  document.getElementById('rsvp-no')?.addEventListener('click', () => send('declined'));
});
