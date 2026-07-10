'use strict';

/**
 * Host inbox buckets + quick actions (confirm / check-in / cancel).
 */
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.getElementById('host-inbox-bar');
  if (!bar) return;

  let currentBucket = 'new';

  async function act(bookingId, action) {
    const map = {
      confirm: { method: 'PUT', path: `/api/hosts/bookings/${bookingId}/confirm` },
      checkin: { method: 'PUT', path: `/api/hosts/bookings/${bookingId}/checkin` },
      cancel: {
        method: 'PUT',
        path: `/api/hosts/bookings/${bookingId}/cancel`,
        body: { reason: 'host_reject' },
      },
    };
    const cfg = map[action];
    if (!cfg) return;
    if (action === 'cancel' && !confirm('Hủy / từ chối booking này?')) return;
    const res = await WorkHubAPI.api(cfg.path, {
      method: cfg.method,
      body: cfg.body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || data.message || 'Thao tác thất bại');
      return;
    }
    load(currentBucket);
  }

  function actionButtons(b) {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-wrap gap-1 justify-end';
    const status = b.status || b.Status || '';
    const id = b.id || b._id;
    if (!id) return wrap;

    const mk = (label, action, cls) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-[10px] font-black uppercase px-2 py-1 rounded-lg border ' + (cls || '');
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        act(id, action);
      });
      return btn;
    };

    if (status === 'pending' || status === 'hold') {
      wrap.appendChild(mk('Confirm', 'confirm', 'bg-teal-50 text-teal-800 border-teal-200'));
      wrap.appendChild(mk('Reject', 'cancel', 'text-red-600'));
    }
    if (status === 'confirmed') {
      wrap.appendChild(mk('Check-in', 'checkin', 'bg-amber-50 text-amber-800 border-amber-200'));
    }
    if (['pending', 'confirmed', 'awaiting_payment', 'payment_under_review'].includes(status)) {
      wrap.appendChild(mk('Cancel', 'cancel', 'text-slate-500'));
    }

    const link = document.createElement('a');
    link.href = `/host/bookings?highlight=${id}`;
    link.className = 'text-[10px] font-black uppercase px-2 py-1 text-teal-700';
    link.textContent = 'Chi tiết';
    wrap.appendChild(link);
    return wrap;
  }

  async function load(bucket) {
    currentBucket = bucket || 'new';
    const res = await WorkHubAPI.api(
      `/api/host/inbox?bucket=${encodeURIComponent(currentBucket)}&limit=20`
    );
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
      row.className = 'border-t p-3 text-sm flex flex-col sm:flex-row sm:justify-between gap-2';
      const left = document.createElement('div');
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'font-bold',
          (b.space && (b.space.Name || b.space.SpaceCode)) ||
            b.snapshot?.SpaceName ||
            'Booking'
        )
      );
      const cust =
        (b.customer && (b.customer.FullName || b.customer.Email)) || '';
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs text-slate-500',
          `${b.status || ''} · ${b.startTime ? new Date(b.startTime).toLocaleString('vi-VN') : ''}${cust ? ' · ' + cust : ''}`
        )
      );
      left.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-xs font-black text-teal-700 mt-0.5',
          Number(b.totalAmount || 0).toLocaleString('vi-VN') + 'đ'
        )
      );
      row.appendChild(left);
      row.appendChild(actionButtons(b));
      list.appendChild(row);
    });
    if (!(data.items || []).length) {
      list.appendChild(
        DomSafe.createTextElement('p', 'text-xs text-slate-400 p-3', 'Không có booking trong bucket này.')
      );
    }
  }

  bar.querySelectorAll('[data-inbox-bucket]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bar.querySelectorAll('[data-inbox-bucket]').forEach((b) =>
        b.classList.remove('ring-2', 'ring-teal-500')
      );
      btn.classList.add('ring-2', 'ring-teal-500');
      load(btn.getAttribute('data-inbox-bucket'));
    });
  });

  // Extra buckets if present in DOM
  load('new');
});
