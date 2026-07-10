'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('seo-list');
  const msg = document.getElementById('seo-msg');

  async function load() {
    list.replaceChildren();
    const res = await WorkHubAPI.api('/api/admin/seo/redirects');
    const data = await res.json();
    (data.redirects || []).forEach((r) => {
      const row = document.createElement('div');
      row.className = 'flex justify-between gap-2 border-t p-3 text-sm';
      row.appendChild(DomSafe.createTextElement('span', 'font-mono', r.FromPath + ' → ' + r.ToPath));
      row.appendChild(DomSafe.createTextElement('span', 'text-xs font-black text-slate-500', String(r.StatusCode)));
      list.appendChild(row);
    });
  }

  document.getElementById('seo-save').addEventListener('click', async () => {
    const res = await WorkHubAPI.api('/api/admin/seo/redirects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromPath: document.getElementById('seo-from').value.trim(),
        toPath: document.getElementById('seo-to').value.trim(),
        statusCode: Number(document.getElementById('seo-code').value),
      }),
    });
    const data = await res.json().catch(() => ({}));
    msg.textContent = res.ok ? 'Đã lưu redirect.' : data.error || data.message || 'Lỗi';
    msg.className = res.ok ? 'text-sm mb-3 text-teal-700 font-bold' : 'text-sm mb-3 text-red-600';
    if (res.ok) load();
  });

  load().catch((e) => {
    msg.textContent = e.message;
  });
});
