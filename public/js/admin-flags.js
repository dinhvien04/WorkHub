'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('flag-list');
  const msg = document.getElementById('flag-msg');

  async function load() {
    list.replaceChildren();
    const res = await WorkHubAPI.api('/api/admin/flags');
    const data = await res.json();
    (data.flags || []).forEach((f) => {
      const row = document.createElement('div');
      row.className = 'border-t p-3 text-sm';
      row.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-bold',
          f.Key + (f.Enabled ? ' · ON' : ' · OFF') + ' · ' + (f.Percentage ?? 100) + '%'
        )
      );
      if (f.Description) {
        row.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-500', f.Description));
      }
      list.appendChild(row);
    });
  }

  document.getElementById('flag-save').addEventListener('click', async () => {
    const res = await WorkHubAPI.api('/api/admin/flags', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: document.getElementById('flag-key').value.trim(),
        description: document.getElementById('flag-desc').value.trim(),
        enabled: document.getElementById('flag-enabled').checked,
        percentage: Number(document.getElementById('flag-pct').value) || 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    msg.textContent = res.ok ? 'Đã upsert flag.' : data.error || 'Lỗi';
    msg.className = res.ok ? 'text-sm mb-3 text-teal-700 font-bold' : 'text-sm mb-3 text-red-600';
    if (res.ok) load();
  });

  load().catch((e) => {
    msg.textContent = e.message;
  });
});
