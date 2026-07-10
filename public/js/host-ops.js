'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  function msg(text, ok) {
    const el = $('ops-msg');
    if (!el) return;
    el.textContent = text;
    el.className =
      'mb-4 text-sm p-3 rounded-xl border ' +
      (ok ? 'bg-teal-50 text-teal-800 border-teal-100' : 'bg-red-50 text-red-700 border-red-100');
    el.classList.remove('hidden');
  }

  function parseIds(raw) {
    return String(raw || '')
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => /^[a-f\d]{24}$/i.test(s));
  }

  async function loadBlackouts() {
    const box = $('bo-list');
    if (!box) return;
    DomSafe.clearElement(box);
    const res = await WorkHubAPI.api('/api/host/blackouts', { redirectOn401: true });
    const data = await res.json();
    if (!res.ok) {
      box.appendChild(DomSafe.createTextElement('li', 'text-red-600', data.error || 'Lỗi'));
      return;
    }
    (data.blackouts || []).forEach((b) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex justify-between gap-2 items-center';
      li.appendChild(
        DomSafe.createTextElement(
          'span',
          '',
          `${b.SpaceID} · ${new Date(b.StartTime).toLocaleString('vi-VN')} → ${new Date(b.EndTime).toLocaleString('vi-VN')} · ${b.Reason}`
        )
      );
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-xs font-bold text-red-600';
      btn.textContent = 'Xóa';
      btn.addEventListener('click', async () => {
        await WorkHubAPI.api(`/api/host/blackouts/${b._id}`, { method: 'DELETE' });
        loadBlackouts();
      });
      li.appendChild(btn);
      box.appendChild(li);
    });
    if (!(data.blackouts || []).length) {
      box.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Chưa có blackout.'));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('ops-bulk-btn')?.addEventListener('click', async () => {
      const spaceIds = parseIds($('ops-space-ids').value);
      if (!spaceIds.length) return msg('Nhập ít nhất 1 spaceId hợp lệ.');
      const body = { spaceIds };
      if ($('ops-status').value) body.status = $('ops-status').value;
      if ($('ops-price').value !== '') body.pricePerHour = Number($('ops-price').value);
      if ($('ops-deposit').value !== '') body.depositAmount = Number($('ops-deposit').value);
      if ($('ops-fc').value !== '') body.freeCancelHours = Number($('ops-fc').value);
      if ($('ops-instant').checked) body.instantBook = true;
      const am = ($('ops-amenities').value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (am.length) body.amenities = am;

      const res = await WorkHubAPI.api('/api/host/spaces/bulk', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Bulk thất bại');
      msg(`Đã sửa ${data.modified}/${data.matched} spaces · fields: ${(data.fields || []).join(', ')}`, true);
    });

    $('bo-create')?.addEventListener('click', async () => {
      const body = {
        spaceId: $('bo-space').value.trim(),
        startTime: new Date($('bo-start').value).toISOString(),
        endTime: new Date($('bo-end').value).toISOString(),
        reason: $('bo-reason').value.trim() || 'maintenance',
        notifyCustomers: $('bo-notify').checked,
      };
      const res = await WorkHubAPI.api('/api/host/blackouts', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) return msg(data.error || 'Tạo blackout thất bại');
      msg(`Blackout OK · notified ${data.notified || 0} khách`, true);
      const alts = $('bo-alts');
      DomSafe.clearElement(alts);
      if (data.alternatives && data.alternatives.length) {
        alts.appendChild(DomSafe.createTextElement('p', 'font-bold', 'Gợi ý slot thay thế:'));
        data.alternatives.forEach((a) => {
          alts.appendChild(DomSafe.createTextElement('p', '', a.label || JSON.stringify(a)));
        });
      }
      loadBlackouts();
    });

    loadBlackouts();
  });
})();
