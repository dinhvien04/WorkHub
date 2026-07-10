'use strict';

function bookingCodeOf(id) {
  return 'WH-' + String(id).slice(-6).toUpperCase();
}

async function loadReception() {
  const body = document.getElementById('rx-body');
  const err = document.getElementById('rx-error');
  if (!body) return;
  DomSafe.clearElement(body);
  if (err) err.classList.add('hidden');
  try {
    const res = await WorkHubAPI.api('/api/host/reception/today');
    const data = await res.json();
    if (!res.ok) {
      if (err) {
        err.textContent = data.error || 'Lỗi';
        err.classList.remove('hidden');
      }
      return;
    }
    const bookings = data.bookings || [];
    const countEl = document.getElementById('rx-count');
    if (countEl) countEl.textContent = bookings.length + ' booking hôm nay';

    if (!bookings.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'p-6 text-center text-slate-400 text-sm';
      td.textContent = 'Không có booking trong ngày.';
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    bookings.forEach((b) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t';
      tr.dataset.bookingId = String(b._id);
      [
        new Date(b.StartTime).toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        b.SpaceID?.SpaceCode || b.SpaceID?.Name || '—',
        b.CustomerID?.FullName || '—',
        bookingCodeOf(b._id),
        b.Status,
      ].forEach((t) => {
        const td = document.createElement('td');
        td.className = 'p-3';
        td.textContent = t;
        tr.appendChild(td);
      });
      const act = document.createElement('td');
      act.className = 'p-3 text-right space-x-1 whitespace-nowrap';

      if (b.Status === 'confirmed') {
        const bi = document.createElement('button');
        bi.className = 'text-xs bg-teal-600 text-white px-2 py-1 rounded-lg font-bold';
        bi.textContent = 'Check-in';
        bi.addEventListener('click', async () => {
          const r = await WorkHubAPI.api(`/api/hosts/bookings/${b._id}/checkin`, {
            method: 'PUT',
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            alert(d.error || 'Check-in thất bại');
            return;
          }
          loadReception();
        });
        act.appendChild(bi);

        const ns = document.createElement('button');
        ns.className = 'text-xs border border-amber-300 text-amber-800 px-2 py-1 rounded-lg font-bold';
        ns.textContent = 'No-show';
        ns.addEventListener('click', async () => {
          if (!confirm('Đánh dấu no-show?')) return;
          const r = await WorkHubAPI.api(`/api/host/bookings/${b._id}/no-show`, {
            method: 'POST',
            body: { reason: 'no_show_reception' },
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            alert(d.error || 'Thất bại');
            return;
          }
          loadReception();
        });
        act.appendChild(ns);
      }
      if (b.Status === 'in-use') {
        const bo = document.createElement('button');
        bo.className = 'text-xs bg-slate-800 text-white px-2 py-1 rounded-lg font-bold';
        bo.textContent = 'Check-out';
        bo.addEventListener('click', async () => {
          const r = await WorkHubAPI.api(`/api/host/bookings/${b._id}/checkout`, {
            method: 'PUT',
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            alert(d.error || 'Check-out thất bại');
            return;
          }
          loadReception();
        });
        act.appendChild(bo);
      }
      // Fill scan box with code
      const fill = document.createElement('button');
      fill.type = 'button';
      fill.className = 'text-xs text-teal-700 font-bold underline';
      fill.textContent = 'Dùng mã';
      fill.addEventListener('click', () => {
        const input = document.getElementById('rx-code');
        if (input) {
          input.value = bookingCodeOf(b._id);
          input.focus();
        }
      });
      act.appendChild(fill);

      tr.appendChild(act);
      body.appendChild(tr);
    });
  } catch {
    if (err) {
      err.textContent = 'Lỗi kết nối';
      err.classList.remove('hidden');
    }
  }
}

async function doScan() {
  const codeInput = document.getElementById('rx-code');
  const scanMsg = document.getElementById('rx-scan-msg');
  const raw = ((codeInput && codeInput.value) || '').trim();
  if (!raw) {
    if (scanMsg) {
      scanMsg.textContent = 'Nhập mã WH-xxxxxx hoặc dán token QR.';
      scanMsg.className = 'text-sm w-full text-amber-700';
    }
    return;
  }
  const body = raw.includes('.') ? { token: raw } : { code: raw };
  try {
    const res = await WorkHubAPI.api('/api/host/check-in/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || 'Check-in thất bại');
    if (scanMsg) {
      scanMsg.textContent =
        (data.message || 'Check-in OK') +
        (data.booking?._id ? ' · ' + bookingCodeOf(data.booking._id) : '');
      scanMsg.className = 'text-sm w-full text-teal-700 font-bold';
    }
    if (codeInput) codeInput.value = '';
    loadReception();
  } catch (e) {
    if (scanMsg) {
      scanMsg.textContent = e.message || 'Lỗi';
      scanMsg.className = 'text-sm w-full text-red-600';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadReception();
  document.getElementById('rx-scan-btn')?.addEventListener('click', doScan);
  document.getElementById('rx-code')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doScan();
    }
  });
  document.getElementById('rx-paste')?.addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      const input = document.getElementById('rx-code');
      if (input && t) input.value = t.trim();
    } catch {
      alert('Không đọc được clipboard — dán thủ công (Ctrl+V).');
    }
  });
  document.getElementById('rx-refresh')?.addEventListener('click', loadReception);
  // Prefill from ?code= or ?token=
  const q = new URLSearchParams(location.search);
  const pre = q.get('token') || q.get('code');
  if (pre) {
    const input = document.getElementById('rx-code');
    if (input) input.value = pre;
    doScan();
  }
});
