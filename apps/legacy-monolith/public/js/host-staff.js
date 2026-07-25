'use strict';
async function loadStaff() {
  const list = document.getElementById('staff-list');
  if (!list) return;
  DomSafe.clearElement(list);
  const res = await WorkHubAPI.api('/api/host/staff');
  const data = await res.json();
  (data.staff || []).forEach((s) => {
    const row = document.createElement('div');
    row.className = 'bg-white border rounded-2xl p-4 flex justify-between items-center';
    row.appendChild(
      DomSafe.createTextElement(
        'div',
        '',
        `${s.UserID?.FullName || s.UserID?.Email || 'User'} · ${s.Role} · ${s.Status}`
      )
    );
    if (s.Status !== 'revoked') {
      const btn = document.createElement('button');
      btn.className = 'text-xs text-rose-600 font-bold';
      btn.textContent = 'Thu hồi';
      btn.addEventListener('click', async () => {
        await WorkHubAPI.api(`/api/host/staff/${s._id}`, { method: 'DELETE' });
        loadStaff();
      });
      row.appendChild(btn);
    }
    list.appendChild(row);
  });
}
document.addEventListener('DOMContentLoaded', () => {
  loadStaff();
  document.getElementById('staff-invite')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await WorkHubAPI.api('/api/host/staff/invite', {
      method: 'POST',
      body: { email: fd.get('email'), role: fd.get('role') },
    });
    const data = await res.json();
    const msg = document.getElementById('staff-invite-msg');
    if (!res.ok) msg.textContent = data.error || 'Lỗi';
    else {
      msg.textContent = data.inviteToken
        ? `Invite OK. Dev token: ${data.inviteToken}`
        : 'Đã mời';
      loadStaff();
    }
  });
});
