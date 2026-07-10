'use strict';
async function loadReception() {
  const body = document.getElementById('rx-body');
  const err = document.getElementById('rx-error');
  if (!body) return;
  DomSafe.clearElement(body);
  try {
    const res = await WorkHubAPI.api('/api/host/reception/today');
    const data = await res.json();
    if (!res.ok) {
      if (err) { err.textContent = data.error || 'Lỗi'; err.classList.remove('hidden'); }
      return;
    }
    (data.bookings || []).forEach((b) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t';
      [
        new Date(b.StartTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        b.SpaceID?.SpaceCode || b.SpaceID?.Name || '—',
        b.CustomerID?.FullName || '—',
        b.Status,
      ].forEach((t) => {
        const td = document.createElement('td');
        td.className = 'p-3';
        td.textContent = t;
        tr.appendChild(td);
      });
      const act = document.createElement('td');
      act.className = 'p-3 text-right space-x-1';
      if (b.Status === 'confirmed') {
        const bi = document.createElement('button');
        bi.className = 'text-xs bg-teal-600 text-white px-2 py-1 rounded-lg font-bold';
        bi.textContent = 'Check-in';
        bi.addEventListener('click', async () => {
          await WorkHubAPI.api(`/api/hosts/bookings/${b._id}/checkin`, { method: 'PUT' });
          loadReception();
        });
        act.appendChild(bi);
      }
      if (b.Status === 'in-use') {
        const bo = document.createElement('button');
        bo.className = 'text-xs bg-slate-800 text-white px-2 py-1 rounded-lg font-bold';
        bo.textContent = 'Check-out';
        bo.addEventListener('click', async () => {
          await WorkHubAPI.api(`/api/host/bookings/${b._id}/checkout`, { method: 'PUT' });
          loadReception();
        });
        act.appendChild(bo);
      }
      tr.appendChild(act);
      body.appendChild(tr);
    });
  } catch {
    if (err) { err.textContent = 'Lỗi kết nối'; err.classList.remove('hidden'); }
  }
}
document.addEventListener('DOMContentLoaded', loadReception);
