async function mergeGuestFavoritesAfterLogin() {
  try {
    const local = JSON.parse(localStorage.getItem('guestFavorites') || '[]');
    if (!Array.isArray(local) || !local.length) return;
    // Need CSRF for POST
    const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
    const csrfData = await csrfRes.json().catch(() => ({}));
    const token = csrfData.csrfToken || '';
    await fetch('/api/me/favorites/merge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
      },
      body: JSON.stringify({ branchIds: local }),
    });
    localStorage.removeItem('guestFavorites');
  } catch {
    /* non-blocking */
  }
}

function resolvePostLoginPath(data) {
  const q = new URLSearchParams(location.search);
  const returnUrl = q.get('returnUrl') || q.get('next') || '';
  // Only allow same-origin relative paths
  if (returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('//')) {
    return returnUrl;
  }
  if (data.user && data.user.role === 'host') return '/host/dashboard';
  if (data.user && data.user.role === 'admin') return '/admin/dashboard';
  // Resume booking wizard draft after guest login
  if (data.user && data.user.role === 'customer') {
    try {
      const raw =
        sessionStorage.getItem('bookingWizardDraft') ||
        localStorage.getItem('bookingWizardDraft');
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && (draft.spaceId || draft.branchId || draft.step > 1)) {
          return '/booking/wizard?restore=1';
        }
      }
    } catch {
      /* ignore */
    }
  }
  return '/';
}

function finishLoginRedirect(data) {
  showToast('Đăng nhập thành công! Đang chuyển hướng...');
  localStorage.removeItem('token');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userId');
  localStorage.removeItem('user');
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;';
  if (data.user) {
    sessionStorage.setItem('displayName', data.user.fullName || '');
    sessionStorage.setItem('displayRole', data.user.role || '');
  }
  const path = resolvePostLoginPath(data);
  const go = () => {
    window.location.href = path;
  };
  if (data.user && data.user.role === 'customer') {
    mergeGuestFavoritesAfterLogin().finally(() => setTimeout(go, 400));
  } else {
    setTimeout(go, 800);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Google status + OAuth 2FA return
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('requires2fa') === '1' && q.get('pendingToken')) {
      const code = window.prompt('Nhập mã 2FA sau đăng nhập Google:');
      if (code) {
        const vRes = await fetch('/api/auth/2fa/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ pendingToken: q.get('pendingToken'), code }),
        });
        const vData = await vRes.json();
        if (vRes.ok) return finishLoginRedirect(vData);
        showToast(vData.error || 'Mã 2FA sai');
      }
    }
    const st = await fetch('/api/auth/google/status', { credentials: 'same-origin' }).then((r) =>
      r.json()
    );
    const hint = document.getElementById('google-login-hint');
    const btn = document.getElementById('google-login-btn');
    if (!st.configured && hint) {
      hint.classList.remove('hidden');
      hint.textContent = st.mockAllowed
        ? 'Google chưa cấu hình — mock API bật (dev/test).'
        : 'Google OIDC chưa cấu hình trên server.';
      if (btn && !st.configured) {
        btn.addEventListener('click', (e) => {
          if (!st.configured) {
            e.preventDefault();
            showToast('Cấu hình GOOGLE_CLIENT_ID / SECRET hoặc bật ALLOW_GOOGLE_MOCK.');
          }
        });
      }
    }
  } catch {
    /* ignore */
  }
});

async function handleLogin(event) {
  if (event) event.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  if (!email || !password) {
    return showToast('Vui lòng nhập đầy đủ Email và Mật khẩu!');
  }

  try {
    // Ensure CSRF cookie exists before login is not required (login is CSRF-exempt),
    // but fetch with credentials for cookie session.
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (response.ok && data.requires2fa) {
      const code = window.prompt('Nhập mã 2FA (Authenticator hoặc recovery code):');
      if (!code) return showToast('Cần mã 2FA để đăng nhập.');
      const vRes = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ pendingToken: data.pendingToken, code }),
      });
      const vData = await vRes.json();
      if (!vRes.ok) return showToast(vData.error || vData.message || 'Mã 2FA sai');
      finishLoginRedirect(vData);
      return;
    }

    if (response.ok) {
      finishLoginRedirect(data);
    } else {
      showToast(data.error || data.message || 'Đăng nhập thất bại!');
    }
  } catch (error) {
    console.error('Lỗi khi gọi API:', error);
    showToast('Không thể kết nối đến máy chủ!');
  }
}

function toggleForgotPasswordForm(showForgot) {
  const loginArea = document.getElementById('login-form-area');
  const forgotArea = document.getElementById('forgot-form-area');

  if (showForgot) {
    loginArea.classList.add('hidden');
    forgotArea.classList.remove('hidden');
  } else {
    loginArea.classList.remove('hidden');
    forgotArea.classList.add('hidden');
    document.getElementById('otp-email-subzone').classList.remove('hidden');
    document.getElementById('otp-verify-subzone').classList.add('hidden');
  }
}

async function requestOtpCode(event) {
  event.preventDefault();
  const email = document.getElementById('forgot-email').value;

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    });

    const result = await response.json();
    alert(result.message || result.error || 'Đã xử lý yêu cầu.');
    if (response.ok) {
      document.getElementById('otp-email-subzone').classList.add('hidden');
      document.getElementById('otp-verify-subzone').classList.remove('hidden');
    }
  } catch (error) {
    alert('Không thể kết nối đến máy chủ.');
  }
}

async function executeResetPassword(event) {
  event.preventDefault();
  const email = document.getElementById('forgot-email').value;
  const otp = document.getElementById('forgot-otp').value;
  const newPassword = document.getElementById('forgot-new-password').value;
  const confirmPassword = document.getElementById('forgot-confirm-password').value;

  if (newPassword !== confirmPassword) {
    alert('Mật khẩu xác nhận không khớp nhau!');
    return;
  }

  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, otp, newPassword }),
    });

    const result = await response.json();

    if (!response.ok) {
      alert(result.error || 'Lỗi cập nhật mật khẩu.');
    } else {
      alert(result.message);
      toggleForgotPasswordForm(false);
    }
  } catch (error) {
    alert('Không thể kết nối đến máy chủ.');
  }
}
