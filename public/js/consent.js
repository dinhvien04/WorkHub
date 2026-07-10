'use strict';
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [prefRes, polRes] = await Promise.all([
      WorkHubAPI.api('/api/me/notification-prefs'),
      fetch('/api/privacy/policy').then((r) => r.json()),
    ]);
    const pref = (await prefRes.json()).prefs || {};
    document.getElementById('c-email').checked = pref.email !== false;
    document.getElementById('c-push').checked = pref.push !== false;
    document.getElementById('c-sms').checked = !!pref.sms;
    document.getElementById('c-mkt').checked = !!pref.marketing;
    document.getElementById('c-policy').textContent =
      `Version ${polRes.version || '—'}. Marketing default: ${polRes.marketingOptInDefault}. ${polRes.dataRetention || ''}`;
  } catch {
    document.getElementById('c-policy').textContent = 'Không tải được policy (có thể chưa đăng nhập prefs).';
  }

  document.getElementById('c-save').addEventListener('click', async () => {
    const res = await WorkHubAPI.api('/api/me/notification-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('c-email').checked,
        push: document.getElementById('c-push').checked,
        sms: document.getElementById('c-sms').checked,
        marketing: document.getElementById('c-mkt').checked,
      }),
    });
    const msg = document.getElementById('c-msg');
    msg.textContent = res.ok ? 'Đã lưu.' : 'Lỗi lưu';
    msg.className = res.ok ? 'text-sm mt-2 text-teal-700 font-bold' : 'text-sm mt-2 text-red-600';
  });
});
