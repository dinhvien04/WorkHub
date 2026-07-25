'use strict';

(function () {
  let filter = 'all';

  const TYPE_LABEL = {
    booking: 'Booking',
    payment: 'Thanh toán',
    message: 'Tin nhắn',
    system: 'Hệ thống',
    host: 'Host',
    admin: 'Admin',
  };

  function setFilterUi() {
    document.querySelectorAll('#notif-filters [data-filter]').forEach((btn) => {
      const on = btn.getAttribute('data-filter') === filter;
      btn.classList.toggle('ring-2', on);
      btn.classList.toggle('ring-teal-500', on);
      btn.classList.toggle('bg-teal-50', on);
    });
  }

  function buildQuery() {
    const q = new URLSearchParams({ limit: '50' });
    if (filter === 'unread') q.set('unread', '1');
    else if (filter !== 'all') q.set('type', filter);
    return q.toString();
  }

  async function loadNotifications() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    DomSafe.clearElement(list);
    setFilterUi();
    try {
      const res = await WorkHubAPI.api('/api/me/notifications?' + buildQuery());
      if (res.status === 401) {
        list.appendChild(
          DomSafe.createTextElement('p', 'empty-state', 'Đăng nhập để xem thông báo.')
        );
        return;
      }
      const data = await res.json();
      const unreadLabel = document.getElementById('notif-unread-label');
      if (unreadLabel) {
        unreadLabel.textContent = (data.unreadCount || 0) + ' chưa đọc';
      }
      if (window.WorkHubNotifBadge) WorkHubNotifBadge.set(data.unreadCount || 0);

      const items = data.notifications || [];
      if (!items.length) {
        list.appendChild(
          DomSafe.createTextElement('p', 'empty-state', 'Không có thông báo phù hợp.')
        );
        return;
      }
      items.forEach((n) => {
        const card = document.createElement('div');
        card.className =
          'bg-white border rounded-2xl p-4 flex gap-3 ' +
          (n.IsRead ? 'opacity-70' : 'border-teal-200 shadow-sm');

        const main = document.createElement('button');
        main.type = 'button';
        main.className = 'flex-1 text-left bg-transparent border-0 p-0 cursor-pointer';
        const head = document.createElement('div');
        head.className = 'flex flex-wrap items-center gap-2 mb-1';
        head.appendChild(
          DomSafe.createTextElement(
            'span',
            'text-[9px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-600',
            TYPE_LABEL[n.Type] || n.Type || 'system'
          )
        );
        if (!n.IsRead) {
          head.appendChild(
            DomSafe.createTextElement(
              'span',
              'text-[9px] font-black uppercase text-teal-700',
              'Mới'
            )
          );
        }
        main.appendChild(head);
        main.appendChild(DomSafe.createTextElement('p', 'font-bold text-sm', n.Title || ''));
        main.appendChild(
          DomSafe.createTextElement('p', 'text-sm text-slate-600 mt-1', n.Body || '')
        );
        main.appendChild(
          DomSafe.createTextElement(
            'p',
            'text-[10px] text-slate-400 mt-2',
            n.createdAt ? new Date(n.createdAt).toLocaleString('vi-VN') : ''
          )
        );
        main.addEventListener('click', async () => {
          if (!n.IsRead) {
            await WorkHubAPI.api(`/api/me/notifications/${n._id}/read`, { method: 'PATCH' });
          }
          if (n.Link) window.location.href = n.Link;
          else loadNotifications();
        });
        card.appendChild(main);

        const del = document.createElement('button');
        del.type = 'button';
        del.className =
          'self-start text-[10px] font-bold text-slate-400 hover:text-red-600 px-2 py-1';
        del.textContent = '✕';
        del.setAttribute('aria-label', 'Xóa thông báo');
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          await WorkHubAPI.api(`/api/me/notifications/${n._id}`, { method: 'DELETE' });
          loadNotifications();
        });
        card.appendChild(del);
        list.appendChild(card);
      });
    } catch {
      list.appendChild(DomSafe.createTextElement('p', 'error-state', 'Lỗi tải thông báo'));
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadNotifications();
    document.getElementById('notif-read-all')?.addEventListener('click', async () => {
      await WorkHubAPI.api('/api/me/notifications/read-all', { method: 'POST' });
      loadNotifications();
    });
    document.querySelectorAll('#notif-filters [data-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filter = btn.getAttribute('data-filter') || 'all';
        loadNotifications();
      });
    });
  });
})();
