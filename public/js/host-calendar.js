'use strict';

async function loadCalendar() {
  const from = document.getElementById('cal-from')?.value;
  const to = document.getElementById('cal-to')?.value;
  const err = document.getElementById('cal-error');
  const body = document.getElementById('cal-body');
  if (!from || !to || !body) return;
  err?.classList.add('hidden');
  DomSafe.clearElement(body);

  const params = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString() });
  try {
    const res = await WorkHubAPI.api(`/api/me/host/calendar?${params}`);
    const data = await res.json();
    if (!res.ok) {
      if (err) {
        err.textContent = data.error || 'Lỗi tải lịch';
        err.classList.remove('hidden');
      }
      return;
    }
    const events = data.events || [];
    if (!events.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'p-8 text-center text-slate-400';
      td.textContent = 'Không có booking trong khoảng này.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    events.forEach((ev) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t border-slate-50';
      [
        new Date(ev.start).toLocaleString('vi-VN'),
        new Date(ev.end).toLocaleString('vi-VN'),
        ev.title || '—',
        ev.customerName || '—',
        ev.status || '—',
        Number(ev.totalAmount || 0).toLocaleString('vi-VN') + 'đ',
      ].forEach((t) => {
        const td = document.createElement('td');
        td.className = 'p-4 text-sm';
        td.textContent = t;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  } catch {
    if (err) {
      err.textContent = 'Lỗi kết nối';
      err.classList.remove('hidden');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const from = document.getElementById('cal-from');
  const to = document.getElementById('cal-to');
  const today = new Date();
  const week = new Date(Date.now() + 7 * 86400000);
  if (from) from.value = today.toISOString().slice(0, 10);
  if (to) to.value = week.toISOString().slice(0, 10);
  document.getElementById('cal-load')?.addEventListener('click', loadCalendar);
  loadCalendar();
});
