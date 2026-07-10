'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('dispute-list');
  const res = await WorkHubAPI.api('/api/disputes');
  const data = await res.json();
  (data.disputes || []).forEach((d) => {
    const card = document.createElement('div');
    card.className = 'bg-white border rounded-2xl p-4';
    card.appendChild(DomSafe.createTextElement('p', 'font-bold text-sm', d.Status));
    card.appendChild(DomSafe.createTextElement('p', 'text-sm text-slate-600 mt-1', d.Reason || ''));
    if (['open', 'under_review', 'appealed'].includes(d.Status)) {
      const btn = document.createElement('button');
      btn.className = 'mt-3 text-xs bg-teal-600 text-white px-3 py-2 rounded-lg font-bold';
      btn.textContent = 'Resolve (no refund)';
      btn.addEventListener('click', async () => {
        await WorkHubAPI.api(`/api/admin/disputes/${d._id}/resolve`, {
          method: 'PUT',
          body: { resolution: 'Resolved by admin', refundAmount: 0 },
        });
        location.reload();
      });
      card.appendChild(btn);
    }
    list.appendChild(card);
  });
});
