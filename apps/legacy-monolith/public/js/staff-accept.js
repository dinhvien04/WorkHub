'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const pre = params.get('token') || '';
  const input = document.getElementById('staff-token');
  if (input && pre) input.value = pre;

  document.getElementById('staff-accept-btn')?.addEventListener('click', async () => {
    const msg = document.getElementById('staff-accept-msg');
    const token = (input?.value || '').trim();
    if (!token) {
      msg.textContent = 'Nhập token mời.';
      msg.className = 'text-sm mt-3 text-red-600';
      return;
    }
    const res = await WorkHubAPI.api('/api/staff/accept', {
      method: 'POST',
      body: { token },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      msg.textContent = data.error || 'Chấp nhận thất bại (đăng nhập đúng tài khoản?)';
      msg.className = 'text-sm mt-3 text-red-600';
      return;
    }
    msg.textContent =
      'Đã tham gia team host · role ' + (data.staff?.Role || data.staff?.role || 'staff');
    msg.className = 'text-sm mt-3 text-teal-700 font-bold';
    setTimeout(() => {
      window.location.href = '/host/reception';
    }, 1200);
  });
});
