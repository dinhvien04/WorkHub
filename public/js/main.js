// ==========================================
// SHARED CONFIGURATION & STATE
// ==========================================
const menus = {
  guest: [],
  customer: [
    { id: 'home', label: 'Trang chủ', icon: '🏠' },
    { id: 'booking_wizard', label: 'Đặt chỗ', icon: '✨' },
    { id: 'history', label: 'Lịch sử đặt', icon: '📅' },
    { id: 'favorites', label: 'Yêu thích', icon: '❤️' },
    { id: 'notifications', label: 'Thông báo', icon: '🔔' },
    { id: 'messages', label: 'Tin nhắn', icon: '💬' },
    { id: 'membership', label: 'Membership', icon: '🎫' },
    { id: 'payment_history', label: 'Lịch sử thanh toán', icon: '💳' },
    { id: 'support', label: 'Hỗ trợ', icon: '🛟' },
    { id: 'security', label: 'Bảo mật', icon: '🔐' },
    { id: 'profile', label: 'Hồ sơ', icon: '👤' },
  ],
  host: [
    { id: 'host_dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'host_calendar', label: 'Lịch', icon: '🗓️' },
    { id: 'host_reception', label: 'Lễ tân', icon: '🛎️' },
    { id: 'host_spaces', label: 'Quản lý không gian', icon: '🏢' },
    { id: 'host_bookings', label: 'Quản lý đơn', icon: '📋' },
    { id: 'host_finance', label: 'Tài chính', icon: '💵' },
    { id: 'host_staff', label: 'Nhân viên', icon: '👥' },
    { id: 'host_reports', label: 'Báo cáo', icon: '💰' },
    { id: 'host_payments', label: 'Lịch sử tiền', icon: '💳' },
    { id: 'host_profile', label: 'Hồ sơ', icon: '👤' },
  ],
  admin: [
    { id: 'admin_dashboard', label: 'Bảng điều khiển', icon: '📊' },
    { id: 'admin_users', label: 'Người dùng', icon: '👥' },
    { id: 'admin_hosts', label: 'Chủ cơ sở', icon: '🏢' },
    { id: 'admin_disputes', label: 'Disputes', icon: '⚖️' },
    { id: 'admin_cms', label: 'CMS', icon: '📝' },
    { id: 'admin_activitylog', label: 'Nhật ký hoạt động', icon: '⭐' },
  ],
};

function navigateTo(id) {
  const routes = {
    home: '/',
    search: '/search',
    detail: '/detail',
    payment: '/payment',
    history: '/history',
    payment_history: '/payment_history',
    profile: '/profile',
    favorites: '/favorites',
    notifications: '/notifications',
    booking_wizard: '/booking/wizard',
    messages: '/messages',
    membership: '/membership',
    support: '/support',
    security: '/security',
    login: '/login',
    host_profile: '/host/profile',
    host_dashboard: '/host/dashboard',
    host_calendar: '/host/calendar',
    host_reception: '/host/reception',
    host_spaces: '/host/spaces',
    host_bookings: '/host/bookings',
    host_finance: '/host/finance',
    host_staff: '/host/staff',
    host_reports: '/host/reports',
    host_payments: '/host/payments',
    compare: '/compare',
    support: '/support',
    admin_dashboard: '/admin/dashboard',
    admin_users: '/admin/users',
    admin_hosts: '/admin/hosts',
    admin_disputes: '/admin/disputes',
    admin_cms: '/admin/cms',
    admin_activitylog: '/admin/activitylog',
  };
  if (routes[id]) window.location.href = routes[id];
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById(id).classList.add('flex');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.getElementById(id).classList.remove('flex');
}

function showToast(msg) {
  const t = document.getElementById('success-toast');
  const m = document.getElementById('toast-msg');
  if (t && m) {
    m.innerText = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2000);
  }
}

function toggleSidebar() {
  const s = document.getElementById('sidebar');
  if (s) s.classList.toggle('collapsed');
}

document.addEventListener('DOMContentLoaded', () => {
  updateUIBasedOnAuth();
});

async function updateUIBasedOnAuth() {
  const loginBtn = document.getElementById('nav-login-btn');
  const userInfo = document.getElementById('user-info');
  const nameDisplay = document.getElementById('user-display-name');
  const roleDisplay = document.getElementById('user-display-role');
  const avatarPreview = document.getElementById('header-avatar-preview');
  const sidebar = document.getElementById('sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');

  let user = null;
  try {
    const api = window.WorkHubAPI ? window.WorkHubAPI.api : (url, o) => fetch(url, { ...o, credentials: 'same-origin' });
    const res = await api('/api/auth/me', { redirectOn401: false });
    if (res.ok) {
      const data = await res.json();
      user = data.user;
    }
  } catch {
    user = null;
  }

  // Clear legacy JWT storage
  localStorage.removeItem('token');

  if (user) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userInfo) userInfo.classList.remove('hidden');

    const userName = user.fullName || sessionStorage.getItem('displayName') || '';
    if (nameDisplay) nameDisplay.textContent = userName;

    if (avatarPreview && userName) {
      const cachedAvatar = sessionStorage.getItem('displayAvatar');
      avatarPreview.src = cachedAvatar
        ? cachedAvatar
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=0D8B8B&color=fff`;
    }

    if (roleDisplay) {
      if (user.role === 'host') {
        roleDisplay.textContent = 'Chủ cơ sở';
        roleDisplay.classList.add('text-indigo-600');
      } else if (user.role === 'admin') {
        roleDisplay.textContent = 'Quản trị viên';
        roleDisplay.classList.add('text-red-600');
      } else {
        roleDisplay.textContent = 'Khách hàng';
        roleDisplay.classList.add('text-teal-600');
      }
    }

    if (sidebar) sidebar.classList.remove('hidden-permanent', 'collapsed');
    if (sidebarToggle) sidebarToggle.classList.remove('hidden');

    renderMenu(user.role);
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.add('hidden');
    if (sidebar) sidebar.classList.add('hidden-permanent');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
  }
}

function renderMenu(currentRole) {
  const c = document.getElementById('menu-items');
  if (!c) return;
  c.textContent = '';

  (menus[currentRole] || []).forEach((i) => {
    const d = document.createElement('div');
    d.className = 'nav-item cursor-pointer';

    let expectedPath = '/' + i.id;
    if (i.id === 'home') expectedPath = '/';
    else if (i.id.startsWith('host_')) expectedPath = '/host/' + i.id.replace('host_', '');
    else if (i.id.startsWith('admin_')) expectedPath = '/admin/' + i.id.replace('admin_', '');

    if (window.location.pathname === expectedPath) d.classList.add('active');

    d.addEventListener('click', () => navigateTo(i.id));
    const icon = document.createElement('span');
    icon.textContent = i.icon;
    d.appendChild(icon);
    d.appendChild(document.createTextNode(' ' + i.label));
    c.appendChild(d);
  });
}

function toggleUserMenu() {
  const dropdown = document.getElementById('dropdown-menu');
  if (dropdown) dropdown.classList.toggle('hidden');
}

async function logout() {
  try {
    const api = window.WorkHubAPI ? window.WorkHubAPI.api : null;
    if (api) {
      await api('/api/auth/logout', { method: 'POST' });
    } else {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    }
  } catch {
    /* ignore */
  }
  localStorage.removeItem('token');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userName');
  localStorage.removeItem('userId');
  localStorage.removeItem('userAvatar');
  localStorage.removeItem('user');
  sessionStorage.clear();
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;';
  window.location.href = '/login';
}

document.addEventListener('click', (event) => {
  const userInfo = document.getElementById('user-info');
  const dropdown = document.getElementById('dropdown-menu');
  if (userInfo && dropdown && !userInfo.contains(event.target)) {
    dropdown.classList.add('hidden');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const changePasswordBtn = Array.from(document.querySelectorAll('button, a, div')).find(
    (el) => el.textContent.trim() === 'THAY ĐỔI MẬT KHẨU'
  );

  if (changePasswordBtn) {
    changePasswordBtn.classList.add('cursor-pointer');
    changePasswordBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const inputs = document.querySelectorAll('input[type="password"]');
      const oldPasswordInput = inputs[0];
      const newPasswordInput = inputs[1];
      const confirmPasswordInput = inputs[2];
      if (!oldPasswordInput || !newPasswordInput || !confirmPasswordInput) {
        alert('Không tìm thấy các ô nhập mật khẩu trên giao diện!');
        return;
      }
      const oldPassword = oldPasswordInput.value.trim();
      const newPassword = newPasswordInput.value.trim();
      const confirmPassword = confirmPasswordInput.value.trim();
      if (!oldPassword || !newPassword || !confirmPassword) {
        alert('Vui lòng điền đầy đủ cả 3 ô mật khẩu!');
        return;
      }
      if (newPassword !== confirmPassword) {
        alert('Mật khẩu mới và Xác nhận mật khẩu mới không trùng khớp với nhau!');
        return;
      }
      if (newPassword.length < 6) {
        alert('Mật khẩu mới phải có độ dài từ 6 ký tự trở lên!');
        return;
      }
      try {
        changePasswordBtn.innerText = 'ĐANG XỬ LÝ...';
        changePasswordBtn.style.pointerEvents = 'none';
        const api = window.WorkHubAPI.api;
        const res = await api('/api/auth/change-password', {
          method: 'POST',
          body: { oldPassword, newPassword },
        });
        const data = await res.json();
        if (res.ok) {
          alert(data.message || 'Đổi mật khẩu thành công!');
          window.location.href = '/login';
        } else {
          alert(data.error || 'Đổi mật khẩu thất bại');
        }
      } catch {
        alert('Lỗi kết nối máy chủ');
      } finally {
        changePasswordBtn.innerText = 'THAY ĐỔI MẬT KHẨU';
        changePasswordBtn.style.pointerEvents = '';
      }
    });
  }
});
