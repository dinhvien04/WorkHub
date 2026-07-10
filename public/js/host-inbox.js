'use strict';

/**
 * Optional host inbox buckets using /api/host/inbox
 * Safe no-op if container missing.
 */
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('host-inbox-bar');
  if (!bar) return;

  async function load(bucket) {
    const res = await WorkHubAPI.api(`/api/host/inbox?bucket=${encodeURIComponent(bucket || 'new')}&limit=20`);
    const data = await res.json();
    if (!res.ok) return;

    const countsEl = document.getElementById('host-inbox-counts');
    if (countsEl && data.counts) {
      countsEl.textContent = Object.entries(data.counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
    }

    const list = document.getElementById('host-inbox-list');
    if (!list) return;
    list.replaceChildren();
    (data.items || []).forEach((b) => {
      const row = document.createElement('div');
      row.className = 'border-t p-3 text-sm flex justify-between gap-2';
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-bold',
          (b.space && (b.space.Name || b.space.SpaceCode)) || b.snapshot?.SpaceName || 'Booking'
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          `${b.status} · ${b.startTime ? new Date(b.startTime).toLocaleString('vi-VN') : ''}`
        )
      );
      row.appendChild(left);
      row.appendChild(
        DomSafe.createTextElement(
          'span',
          'text-xs font-black text-teal-700',
          Number(b.totalAmount || 0).toLocaleString('vi-VN') + 'đ'
        )
      );
      list.appendChild(row);
    });
  }

  bar.querySelectorAll('[data-inbox-bucket]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('[data-inbox-bucket]').forEach((b) => b.classList.remove('ring-2', 'ring-teal-500'));
      btn.classList.add('ring-2', 'ring-teal-500');
      load(btn.getAttribute('data-inbox-bucket'));
    });
  });

  load('new');
});
