'use strict';

(function () {
  const $ = (id) => document.getElementById(id);

  function msg(text, ok) {
    const el = $('al-msg');
    if (!el) return;
    el.textContent = text;
    el.className =
      'mb-4 text-sm p-3 rounded-xl border ' +
      (ok ? 'bg-teal-50 text-teal-800 border-teal-100' : 'bg-red-50 text-red-700 border-red-100');
    el.classList.remove('hidden');
  }

  function fillList(el, items, kind) {
    DomSafe.clearElement(el);
    (items || []).forEach((item) => {
      const li = document.createElement('li');
      li.className = 'border rounded-xl p-3 flex flex-wrap justify-between gap-2 items-center';
      const label =
        kind === 'branch'
          ? `${item.Name} · ${item.Status} · ${item.City || ''} · ${item._id}`
          : `${item.Name || item.SpaceCode} · ${item.Status} · ${item.PricePerHour || 0}đ · ${item._id}`;
      li.appendChild(DomSafe.createTextElement('span', 'text-xs sm:text-sm', label));
      const actions = document.createElement('div');
      actions.className = 'flex gap-2';
      ['suspend', 'restore', 'request_change'].forEach((act) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'text-[10px] font-black uppercase px-2 py-1 rounded-lg border';
        b.textContent = act;
        b.addEventListener('click', () => moderate(kind, item._id, act));
        actions.appendChild(b);
      });
      li.appendChild(actions);
      el.appendChild(li);
    });
    if (!(items || []).length) {
      el.appendChild(DomSafe.createTextElement('li', 'text-slate-400', 'Trống.'));
    }
  }

  async function moderate(targetType, targetId, action, reason, note) {
    const res = await WorkHubAPI.api('/api/admin/listings/moderate', {
      method: 'POST',
      body: {
        targetType,
        targetId,
        action,
        reason: reason || $('al-reason')?.value || action,
        note: note || $('al-note')?.value || '',
      },
    });
    const data = await res.json();
    if (!res.ok) return msg(data.error || 'Moderation failed');
    msg(data.message || `${action} OK → ${data.status}`, true);
    loadQueue();
  }

  async function loadQueue() {
    const res = await WorkHubAPI.api('/api/admin/listings/flagged');
    const data = await res.json();
    if (!res.ok) return msg(data.error || 'Load failed');
    fillList($('al-branches'), data.branches, 'branch');
    fillList($('al-spaces'), data.spaces, 'space');
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('al-submit')?.addEventListener('click', () => {
      moderate(
        $('al-type').value,
        $('al-id').value.trim(),
        $('al-action').value,
        $('al-reason').value,
        $('al-note').value
      );
    });
    $('al-refresh')?.addEventListener('click', loadQueue);
    loadQueue();
  });
})();
