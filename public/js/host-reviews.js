'use strict';

(function () {
  let filter = '';

  function msg(text, ok) {
    const el = document.getElementById('rv-msg');
    if (!el) return;
    el.textContent = text;
    el.className =
      'mb-3 text-sm p-3 rounded-xl border ' +
      (ok ? 'bg-teal-50 text-teal-800 border-teal-100' : 'bg-red-50 text-red-700 border-red-100');
    el.classList.remove('hidden');
  }

  async function load() {
    const box = document.getElementById('rv-list');
    if (!box) return;
    DomSafe.clearElement(box);
    let url = '/api/host/reviews?limit=50';
    if (filter === 'unreplied') url += '&unreplied=1';
    else if (filter) url += '&status=' + encodeURIComponent(filter);
    const res = await WorkHubAPI.api(url, { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    const items = data.reviews || [];
    if (!items.length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Không có review.'));
      return;
    }
    items.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'bg-white border rounded-3xl p-4';
      const stars = '★'.repeat(Number(r.Rating || 0)) + '☆'.repeat(Math.max(0, 5 - Number(r.Rating || 0)));
      li.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-bold',
          stars +
            ' · ' +
            (r.CustomerID?.FullName || 'Khách') +
            ' · ' +
            (r.SpaceID?.Name || r.SpaceID?.SpaceCode || 'Space')
        )
      );
      li.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-sm text-slate-600 mt-1',
          r.Comment || r.comment || '(không nội dung)'
        )
      );
      li.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-400 mt-1',
          (r.Status || '') +
            (r.ReportCount ? ' · reports ' + r.ReportCount : '') +
            (r.createdAt ? ' · ' + new Date(r.createdAt).toLocaleString('vi-VN') : '')
        )
      );
      if (r.HostReply) {
        li.appendChild(
          DomSafe.createTextElement(
            'p',
            'mt-2 text-sm bg-teal-50 border border-teal-100 rounded-xl px-3 py-2',
            'Host: ' + r.HostReply
          )
        );
      }
      const row = document.createElement('div');
      row.className = 'mt-3 flex flex-wrap gap-2 items-end';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Trả lời review…';
      input.maxLength = 2000;
      input.className = 'flex-1 min-w-[200px] border rounded-xl px-3 py-2 text-sm';
      if (r.HostReply) input.value = r.HostReply;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-xs font-black uppercase bg-teal-600 text-white px-4 py-2 rounded-xl';
      btn.textContent = r.HostReply ? 'Cập nhật reply' : 'Gửi reply';
      btn.addEventListener('click', async () => {
        const reply = input.value.trim();
        if (reply.length < 2) return msg('Nhập nội dung trả lời.');
        const r2 = await WorkHubAPI.api(`/api/host/reviews/${r._id}/reply`, {
          method: 'POST',
          body: { reply },
        });
        const d2 = await r2.json().catch(() => ({}));
        if (!r2.ok) return msg(d2.error || 'Reply thất bại');
        msg('Đã lưu reply', true);
        load();
      });
      row.appendChild(input);
      row.appendChild(btn);
      li.appendChild(row);
      box.appendChild(li);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.rv-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = btn.getAttribute('data-rv-filter') || '';
        document.querySelectorAll('.rv-filter').forEach((b) => {
          b.classList.remove('ring-2', 'ring-teal-500');
        });
        btn.classList.add('ring-2', 'ring-teal-500');
        load();
      });
    });
    load();
  });
})();
