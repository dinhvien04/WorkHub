'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const bal = document.getElementById('fin-balance');
  const led = document.getElementById('fin-ledger');
  try {
    const bRes = await WorkHubAPI.api('/api/host/balance');
    const bData = await bRes.json();
    const b = bData.balance || {};
    [
      ['Available', b.available],
      ['Pending', b.pending],
      ['Paid out', b.paidOut],
    ].forEach(([label, val]) => {
      const card = document.createElement('div');
      card.className = 'bg-white border rounded-2xl p-4';
      card.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-400 font-bold uppercase', label));
      card.appendChild(
        DomSafe.createTextElement('p', 'text-xl font-black text-teal-700', Number(val || 0).toLocaleString('vi-VN') + 'đ')
      );
      bal.appendChild(card);
    });

    const lRes = await WorkHubAPI.api('/api/host/ledger?limit=50');
    const lData = await lRes.json();
    (lData.items || []).forEach((e) => {
      const tr = document.createElement('tr');
      tr.className = 'border-t';
      [e.Type, e.Direction, Number(e.Amount || 0).toLocaleString('vi-VN') + 'đ', e.Description || ''].forEach((t, i) => {
        const td = document.createElement('td');
        td.className = i === 2 ? 'p-3 text-right font-bold' : 'p-3';
        td.textContent = t;
        tr.appendChild(td);
      });
      led.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
});
