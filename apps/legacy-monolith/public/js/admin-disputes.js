'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('dispute-list');
  if (!list) return;
  DomSafe.clearElement(list);
  const res = await WorkHubAPI.api('/api/disputes');
  const data = await res.json();
  const items = data.disputes || [];
  if (!items.length) {
    list.appendChild(DomSafe.createTextElement('p', 'text-slate-400 text-sm', 'Không có dispute.'));
    return;
  }
  items.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'bg-white border rounded-2xl p-4';
    card.appendChild(
      DomSafe.createTextElement(
        'p',
        'font-bold text-sm',
        (d.Status || '') + ' · booking ' + String(d.BookingID || d.bookingId || '')
      )
    );
    card.appendChild(DomSafe.createTextElement('p', 'text-sm text-slate-600 mt-1', d.Reason || ''));
    card.appendChild(
      DomSafe.createTextElement('p', 'text-xs text-slate-400 font-mono mt-1', String(d._id || ''))
    );
    if (['open', 'under_review', 'appealed'].includes(d.Status)) {
      const row = document.createElement('div');
      row.className = 'mt-3 flex flex-wrap gap-2 items-end';
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '0';
      amount.placeholder = 'Refund VND (0 = none)';
      amount.className = 'border rounded-xl px-3 py-2 text-sm w-40';
      amount.value = '0';
      const note = document.createElement('input');
      note.type = 'text';
      note.placeholder = 'Resolution note';
      note.className = 'border rounded-xl px-3 py-2 text-sm flex-1 min-w-[160px]';
      note.value = 'Resolved by admin';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'text-xs bg-teal-600 text-white px-3 py-2 rounded-lg font-bold';
      ok.textContent = 'Resolve';
      ok.addEventListener('click', async () => {
        const r = await WorkHubAPI.api(`/api/admin/disputes/${d._id}/resolve`, {
          method: 'PUT',
          body: {
            resolution: note.value.trim() || 'Resolved by admin',
            refundAmount: Number(amount.value) || 0,
          },
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          alert(body.error || 'Resolve thất bại');
          return;
        }
        location.reload();
      });
      const rej = document.createElement('button');
      rej.type = 'button';
      rej.className = 'text-xs border border-red-300 text-red-700 px-3 py-2 rounded-lg font-bold';
      rej.textContent = 'Reject';
      rej.addEventListener('click', async () => {
        const r = await WorkHubAPI.api(`/api/admin/disputes/${d._id}/resolve`, {
          method: 'PUT',
          body: {
            resolution: note.value.trim() || 'Rejected by admin',
            refundAmount: 0,
            reject: true,
          },
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) {
          alert(body.error || 'Reject thất bại');
          return;
        }
        location.reload();
      });
      row.appendChild(amount);
      row.appendChild(note);
      row.appendChild(ok);
      row.appendChild(rej);
      card.appendChild(row);
    }
    list.appendChild(card);
  });
});
