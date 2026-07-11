// ==========================================
// SHARED CONFIGURATION & STATE
// ==========================================
const menus = {
  guest: [],
  customer: [
    { id: 'home', label: 'Trang chủ', icon: '🏠' },
    { id: 'dashboard', label: 'Tổng quan', icon: '📊' },
    { id: 'booking_wizard', label: 'Đặt chỗ', icon: '✨' },
    { id: 'booking_recurring', label: 'Đặt lặp lại', icon: '🔁' },
    { id: 'booking_group', label: 'Đặt nhóm', icon: '👥' },
    { id: 'history', label: 'Lịch sử đặt', icon: '📅' },
    { id: 'favorites', label: 'Yêu thích', icon: '❤️' },
    { id: 'notifications', label: 'Thông báo', icon: '🔔' },
    { id: 'messages', label: 'Tin nhắn', icon: '💬' },
    { id: 'membership', label: 'Membership', icon: '🎫' },
    { id: 'payment_history', label: 'Lịch sử thanh toán', icon: '💳' },
    { id: 'support', label: 'Hỗ trợ', icon: '🛟' },
    { id: 'security', label: 'Bảo mật', icon: '🔐' },
    { id: 'consent', label: 'Riêng tư', icon: '📜' },
    { id: 'profile', label: 'Hồ sơ', icon: '👤' },
  ],
  host: [
    { id: 'host_dashboard', label: 'Dashboard', icon: '📊' },
    { id: 'host_onboarding', label: 'Onboarding', icon: '🚀' },
    { id: 'host_calendar', label: 'Lịch', icon: '🗓️' },
    { id: 'host_reception', label: 'Lễ tân', icon: '🛎️' },
    { id: 'host_spaces', label: 'Quản lý không gian', icon: '🏢' },
    { id: 'host_ops', label: 'Ops / pricing', icon: '🧰' },
    { id: 'host_bookings', label: 'Quản lý đơn', icon: '📋' },
    { id: 'host_finance', label: 'Tài chính', icon: '💵' },
    { id: 'host_staff', label: 'Nhân viên', icon: '👥' },
    { id: 'host_reviews', label: 'Đánh giá', icon: '⭐' },
    { id: 'host_developer', label: 'Developer API', icon: '🔑' },
    { id: 'host_reports', label: 'Báo cáo', icon: '💰' },
    { id: 'host_payments', label: 'Lịch sử tiền', icon: '💳' },
    { id: 'host_profile', label: 'Hồ sơ', icon: '👤' },
  ],
  admin: [
    { id: 'admin_dashboard', label: 'Bảng điều khiển', icon: '📊' },
    { id: 'admin_users', label: 'Người dùng', icon: '👥' },
    { id: 'admin_hosts', label: 'Chủ cơ sở', icon: '🏢' },
    { id: 'admin_listings', label: 'Listings', icon: '🏷️' },
    { id: 'admin_disputes', label: 'Disputes', icon: '⚖️' },
    { id: 'admin_cms', label: 'CMS', icon: '📝' },
    { id: 'admin_seo', label: 'SEO', icon: '🔎' },
    { id: 'admin_flags', label: 'Flags', icon: '🚩' },
    { id: 'admin_health', label: 'Health & ops', icon: '💚' },
    { id: 'admin_activitylog', label: 'Nhật ký hoạt động', icon: '⭐' },
  ],
};

function navigateTo(id) {
  const routes = {
    home: '/',
    dashboard: '/dashboard',
    search: '/search',
    detail: '/detail',
    payment: '/payment',
    history: '/history',
    payment_history: '/payment_history',
    profile: '/profile',
    favorites: '/favorites',
    notifications: '/notifications',
    booking_wizard: '/booking/wizard',
    booking_recurring: '/booking/recurring',
    booking_group: '/booking/group',
    messages: '/messages',
    membership: '/membership',
    support: '/support',
    security: '/security',
    consent: '/consent',
    booking_detail: '/booking/detail',
    staff_accept: '/staff/accept',
    login: '/login',
    host_profile: '/host/profile',
    host_dashboard: '/host/dashboard',
    host_onboarding: '/host/onboarding',
    host_calendar: '/host/calendar',
    host_reception: '/host/reception',
    host_spaces: '/host/spaces',
    host_ops: '/host/ops',
    host_bookings: '/host/bookings',
    host_finance: '/host/finance',
    host_staff: '/host/staff',
    host_reviews: '/host/reviews',
    host_developer: '/host/developer',
    host_reports: '/host/reports',
    host_payments: '/host/payments',
    compare: '/compare',
    admin_dashboard: '/admin/dashboard',
    admin_users: '/admin/users',
    admin_hosts: '/admin/hosts',
    admin_listings: '/admin/listings',
    admin_disputes: '/admin/disputes',
    admin_cms: '/admin/cms',
    admin_seo: '/admin/seo',
    admin_flags: '/admin/flags',
    admin_health: '/admin/health',
    admin_activitylog: '/admin/activitylog',
  };
  if (routes[id]) window.location.href = routes[id];
}

let __modalFocusReturn = null;
let __modalKeyHandler = null;

function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  __modalFocusReturn = document.activeElement;
  el.classList.remove('hidden');
  el.classList.add('flex');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  // Focus first focusable
  const focusable = el.querySelector(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable) focusable.focus();
  if (__modalKeyHandler) document.removeEventListener('keydown', __modalKeyHandler);
  __modalKeyHandler = function (e) {
    if (e.key === 'Escape') {
      closeModal(id);
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', __modalKeyHandler);
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  el.classList.remove('flex');
  if (__modalKeyHandler) {
    document.removeEventListener('keydown', __modalKeyHandler);
    __modalKeyHandler = null;
  }
  if (__modalFocusReturn && typeof __modalFocusReturn.focus === 'function') {
    __modalFocusReturn.focus();
  }
  __modalFocusReturn = null;
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
  // Hide finance nav for staff without finance:view (host owners always see it)
  if (window.WorkHubAPI && WorkHubAPI.api) {
    WorkHubAPI.api('/api/host/me/permissions', { redirectOn401: false })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.canFinance) return;
        document.querySelectorAll('[data-nav="host_finance"], [data-menu="host_finance"]').forEach((el) => {
          el.classList.add('hidden');
        });
        // sidebar items by label path
        document.querySelectorAll('a, button, div').forEach((el) => {
          if (el.textContent && el.textContent.trim() === 'Tài chính' && el.closest('.sidebar, #sidebar, nav')) {
            el.classList.add('hidden');
          }
        });
      })
      .catch(() => {});
  }
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
    refreshNotifBadge();
  } else {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userInfo) userInfo.classList.add('hidden');
    if (sidebar) sidebar.classList.add('hidden-permanent');
    if (sidebarToggle) sidebarToggle.classList.add('hidden');
    setNotifBadge(0);
  }
}

function setNotifBadge(count) {
  const n = Math.max(0, Number(count) || 0);
  const badge = document.getElementById('header-notif-badge');
  const mob = document.getElementById('mob-notif-badge');
  [badge, mob].forEach((el) => {
    if (!el) return;
    if (n > 0) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });
}

async function refreshNotifBadge() {
  try {
    if (!window.WorkHubAPI) return;
    const res = await WorkHubAPI.api('/api/me/notifications/unread-count', {
      redirectOn401: false,
    });
    if (!res.ok) return;
    const data = await res.json();
    setNotifBadge(data.unreadCount || 0);
  } catch {
    /* ignore */
  }
}

window.WorkHubNotifBadge = { set: setNotifBadge, refresh: refreshNotifBadge };

function renderMenu(currentRole) {
  const c = document.getElementById('menu-items');
  if (!c) return;
  c.textContent = '';

  (menus[currentRole] || []).forEach((i) => {
    const d = document.createElement('div');
    d.className = 'nav-item cursor-pointer';

    let expectedPath = '/' + i.id;
    if (i.id === 'home') expectedPath = '/';
    else if (i.id === 'booking_wizard') expectedPath = '/booking/wizard';
    else if (i.id === 'booking_recurring') expectedPath = '/booking/recurring';
    else if (i.id === 'booking_group') expectedPath = '/booking/group';
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
