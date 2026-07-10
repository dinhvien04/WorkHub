'use strict';

async function loadNotifications() {
  const list = document.getElementById('notif-list');
  if (!list) return;
  DomSafe.clearElement(list);
  try {
    const res = await WorkHubAPI.api('/api/me/notifications?limit=50');
    if (res.status === 401) {
      list.appendChild(DomSafe.createTextElement('p', 'empty-state', 'Đăng nhập để xem thông báo.'));
      return;
    }
    const data = await res.json();
    const items = data.notifications || [];
    if (!items.length) {
      list.appendChild(DomSafe.createTextElement('p', 'empty-state', 'Chưa có thông báo.'));
      return;
    }
    items.forEach((n) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className =
        'w-full text-left bg-white border rounded-2xl p-4 hover:bg-slate-50 ' +
        (n.IsRead ? 'opacity-70' : 'border-teal-200');
      card.appendChild(DomSafe.createTextElement('p', 'font-bold text-sm', n.Title || ''));
      card.appendChild(DomSafe.createTextElement('p', 'text-sm text-slate-600 mt-1', n.Body || ''));
      card.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-[10px] text-slate-400 mt-2',
          n.createdAt ? new Date(n.createdAt).toLocaleString('vi-VN') : ''
        )
      );
      card.addEventListener('click', async () => {
        if (!n.IsRead) {
          await WorkHubAPI.api(`/api/me/notifications/${n._id}/read`, { method: 'PATCH' });
        }
        if (n.Link) window.location.href = n.Link;
        else loadNotifications();
      });
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
});
