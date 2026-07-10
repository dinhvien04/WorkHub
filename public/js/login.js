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
  setTimeout(() => {
    if (data.user && data.user.role === 'host') {
      window.location.href = '/host/dashboard';
    } else if (data.user && data.user.role === 'admin') {
      window.location.href = '/admin/dashboard';
    } else {
      window.location.href = '/';
    }
  }, 800);
}

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
