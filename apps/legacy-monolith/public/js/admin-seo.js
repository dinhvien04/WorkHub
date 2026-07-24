'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('seo-list');
  const msg = document.getElementById('seo-msg');

  function setMsg(text, ok) {
    if (!msg) return;
    msg.textContent = text;
    msg.className = ok
      ? 'text-sm mb-3 text-teal-700 font-bold'
      : 'text-sm mb-3 text-red-600';
  }

  async function load() {
    list.replaceChildren();
    const res = await WorkHubAPI.api('/api/admin/seo/redirects');
    const data = await res.json();
    const items = data.redirects || [];
    if (!items.length) {
      list.appendChild(
        DomSafe.createTextElement('p', 'text-sm text-slate-400 p-4', 'Chưa có redirect.')
      );
      return;
    }
    items.forEach((r) => {
      const row = document.createElement('div');
      row.className =
        'flex flex-wrap justify-between gap-2 border-t p-3 text-sm items-center ' +
        (r.Active === false ? 'opacity-50 bg-slate-50' : '');
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'span',
          'font-mono text-xs sm:text-sm',
          r.FromPath + ' → ' + r.ToPath
        )
      );
      if (r.Note) {
        left.appendChild(DomSafe.createTextElement('p', 'text-[10px] text-slate-400', r.Note));
      }
      row.appendChild(left);
      const right = document.createElement('div');
      right.className = 'flex items-center gap-2';
      right.appendChild(
        DomSafe.createTextElement(
          'span',
          'text-xs font-black text-slate-500',
          String(r.StatusCode) + (r.Active === false ? ' · off' : '')
        )
      );
      const tog = document.createElement('button');
      tog.type = 'button';
      tog.className = 'text-[10px] font-black uppercase px-2 py-1 rounded-lg border';
      tog.textContent = r.Active === false ? 'Bật' : 'Tắt';
      tog.addEventListener('click', async () => {
        await WorkHubAPI.api(`/api/admin/seo/redirects/${r._id}`, {
          method: 'PATCH',
          body: { active: r.Active === false },
        });
        load();
      });
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'text-[10px] font-black uppercase px-2 py-1 rounded-lg border text-red-600';
      del.textContent = 'Xóa';
      del.addEventListener('click', async () => {
        if (!confirm('Xóa redirect ' + r.FromPath + '?')) return;
        await WorkHubAPI.api(`/api/admin/seo/redirects/${r._id}`, { method: 'DELETE' });
        load();
      });
      right.appendChild(tog);
      right.appendChild(del);
      row.appendChild(right);
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
        note: document.getElementById('seo-note')?.value?.trim() || '',
        active: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setMsg(res.ok ? 'Đã lưu redirect.' : data.error || data.message || 'Lỗi', res.ok);
    if (res.ok) {
      document.getElementById('seo-from').value = '';
      document.getElementById('seo-to').value = '';
      if (document.getElementById('seo-note')) document.getElementById('seo-note').value = '';
      load();
    }
  });

  load().catch((e) => setMsg(e.message, false));
});
