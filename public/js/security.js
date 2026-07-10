'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('session-list');
  const secMsg = document.getElementById('sec-msg');
  const privacyMsg = document.getElementById('privacy-msg');
  const logoutAllBtn = document.getElementById('logout-all-btn');
  const exportBtn = document.getElementById('export-data-btn');
  const deleteBtn = document.getElementById('delete-account-btn');
  const totpStatus = document.getElementById('totp-status');
  const totpMsg = document.getElementById('totp-msg');
  const totpSecret = document.getElementById('totp-secret');
  const setupBtn = document.getElementById('totp-setup-btn');
  const enableBtn = document.getElementById('totp-enable-btn');
  const disableBtn = document.getElementById('totp-disable-btn');

  async function loadSessions() {
    list.replaceChildren();
    const res = await WorkHubAPI.api('/api/sessions');
    const data = await res.json();
    const items = data.sessions || [];
    if (!items.length) {
      list.appendChild(
        DomSafe.createTextElement(
          'p',
          'text-sm text-slate-400',
          'Chưa ghi nhận session (sẽ xuất hiện sau lần đăng nhập kế tiếp).'
        )
      );
      return;
    }
    items.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'border rounded-2xl p-3 text-sm bg-slate-50';
      card.appendChild(
        DomSafe.createTextElement('p', 'font-bold text-slate-800', s.UserAgent || 'Thiết bị')
      );
      const meta = [
        s.IP ? 'IP: ' + s.IP : null,
        s.LastSeenAt ? 'Seen: ' + new Date(s.LastSeenAt).toLocaleString('vi-VN') : null,
        s.createdAt ? 'Tạo: ' + new Date(s.createdAt).toLocaleString('vi-VN') : null,
      ]
        .filter(Boolean)
        .join(' · ');
      if (meta) card.appendChild(DomSafe.createTextElement('p', 'text-xs text-slate-500 mt-1', meta));
      list.appendChild(card);
    });
  }

  async function loadTotp() {
    const res = await WorkHubAPI.api('/api/auth/2fa/status');
    const data = await res.json();
    const on = !!data.totpEnabled;
    totpStatus.textContent = on
      ? '2FA đang BẬT.'
      : data.recommended
        ? '2FA đang TẮT — khuyến nghị bật (host/admin).'
        : '2FA đang TẮT.';
    setupBtn.classList.toggle('hidden', on);
    enableBtn.classList.add('hidden');
    disableBtn.classList.toggle('hidden', !on);
  }

  if (setupBtn) {
    setupBtn.addEventListener('click', async () => {
      totpMsg.textContent = '';
      const res = await WorkHubAPI.api('/api/auth/2fa/setup', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        totpMsg.textContent = data.error || data.message || 'Lỗi setup';
        totpMsg.className = 'text-sm text-red-600 mt-2';
        return;
      }
      totpSecret.textContent =
        'Secret: ' + data.secret + '\nURL: ' + data.otpauthUrl + '\nNhập mã 6 số rồi bấm Xác nhận.';
      totpSecret.classList.remove('hidden');
      enableBtn.classList.remove('hidden');
    });
  }

  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      const code = window.prompt('Mã 6 số từ Authenticator:');
      if (!code) return;
      const res = await WorkHubAPI.api('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        totpMsg.textContent = data.error || data.message || 'Lỗi';
        totpMsg.className = 'text-sm text-red-600 mt-2';
        return;
      }
      totpSecret.textContent =
        'Recovery codes (lưu ngay):\n' + (data.recoveryCodes || []).join('\n');
      totpSecret.classList.remove('hidden');
      totpMsg.textContent = data.message || 'Đã bật 2FA';
      totpMsg.className = 'text-sm text-teal-700 mt-2 font-bold';
      loadTotp();
    });
  }

  if (disableBtn) {
    disableBtn.addEventListener('click', async () => {
      const password = window.prompt('Mật khẩu hiện tại:');
      const code = window.prompt('Mã 2FA:');
      if (!password || !code) return;
      const res = await WorkHubAPI.api('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        totpMsg.textContent = data.error || data.message || 'Lỗi';
        totpMsg.className = 'text-sm text-red-600 mt-2';
        return;
      }
      totpSecret.classList.add('hidden');
      totpMsg.textContent = data.message;
      totpMsg.className = 'text-sm text-teal-700 mt-2 font-bold';
      loadTotp();
    });
  }

  async function loadPrefs() {
    const res = await WorkHubAPI.api('/api/me/notification-prefs');
    const data = await res.json();
    const p = data.prefs || {};
    const email = document.getElementById('pref-email');
    const push = document.getElementById('pref-push');
    const sms = document.getElementById('pref-sms');
    const marketing = document.getElementById('pref-marketing');
    if (email) email.checked = p.email !== false;
    if (push) push.checked = p.push !== false;
    if (sms) sms.checked = !!p.sms;
    if (marketing) marketing.checked = !!p.marketing;
  }

  const prefSave = document.getElementById('pref-save-btn');
  if (prefSave) {
    prefSave.addEventListener('click', async () => {
      const res = await WorkHubAPI.api('/api/me/notification-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.getElementById('pref-email').checked,
          push: document.getElementById('pref-push').checked,
          sms: document.getElementById('pref-sms').checked,
          marketing: document.getElementById('pref-marketing').checked,
        }),
      });
      const msg = document.getElementById('pref-msg');
      if (res.ok) {
        msg.textContent = 'Đã lưu tùy chọn.';
        msg.className = 'text-sm text-teal-700 mt-2 font-bold';
      } else {
        const data = await res.json().catch(() => ({}));
        msg.textContent = data.error || 'Lỗi';
        msg.className = 'text-sm text-red-600 mt-2';
      }
    });
  }

  if (logoutAllBtn) {
    logoutAllBtn.addEventListener('click', async () => {
      if (!confirm('Đăng xuất tất cả thiết bị? Bạn sẽ cần đăng nhập lại.')) return;
      secMsg.textContent = '';
      try {
        const res = await WorkHubAPI.api('/api/sessions/logout-all', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Lỗi');
        secMsg.textContent = data.message || 'Đã đăng xuất tất cả.';
        secMsg.className = 'text-sm text-teal-700 mb-3 font-bold';
        setTimeout(() => {
          window.location.href = '/login';
        }, 800);
      } catch (err) {
        secMsg.textContent = err.message || 'Lỗi';
        secMsg.className = 'text-sm text-red-600 mb-3';
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      privacyMsg.textContent = 'Đang chuẩn bị…';
      try {
        const res = await WorkHubAPI.api('/api/me/privacy/export');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || 'Export thất bại');
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'workhub-my-data.json';
        a.click();
        URL.revokeObjectURL(url);
        privacyMsg.textContent = 'Đã tải file JSON.';
        privacyMsg.className = 'text-sm text-teal-700 mt-3 font-bold';
      } catch (err) {
        privacyMsg.textContent = err.message || 'Lỗi';
        privacyMsg.className = 'text-sm text-red-600 mt-3';
      }
    });
  }

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (
        !confirm(
          'Gửi yêu cầu xóa tài khoản? Hành động cần xác nhận admin và không hoàn tác dữ liệu tài chính.'
        )
      ) {
        return;
      }
      try {
        const res = await WorkHubAPI.api('/api/me/privacy/delete-request', { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.message || 'Lỗi');
        privacyMsg.textContent = data.message || 'Đã ghi nhận yêu cầu xóa.';
        privacyMsg.className = 'text-sm text-teal-700 mt-3 font-bold';
      } catch (err) {
        privacyMsg.textContent = err.message || 'Lỗi';
        privacyMsg.className = 'text-sm text-red-600 mt-3';
      }
    });
  }

  loadSessions().catch((e) => {
    secMsg.textContent = e.message || 'Không tải được sessions';
    secMsg.className = 'text-sm text-red-600 mb-3';
  });
  loadTotp().catch(() => {
    totpStatus.textContent = 'Không tải được trạng thái 2FA';
  });
  loadPrefs().catch(() => {});
});
