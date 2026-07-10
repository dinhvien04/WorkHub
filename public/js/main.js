// ==========================================
// SHARED CONFIGURATION & STATE
// ==========================================
const menus = { 
    'guest': [], 
    'customer': [
        { id: 'home', label: 'Trang chủ', icon: '🏠' }, 
        { id: 'history', label: 'Lịch sử đặt', icon: '📅' }, 
        { id: 'payment_history', label: 'Lịch sử thanh toán', icon: '💳' }, 
        { id: 'profile', label: 'Hồ sơ', icon: '👤' }
    ], 
    'host': [
        { id: 'host_dashboard', label: 'Dashboard', icon: '📊' }, 
        { id: 'host_spaces', label: 'Quản lý không gian', icon: '🏢' }, 
        { id: 'host_bookings', label: 'Quản lý đơn', icon: '📋' }, 
        { id: 'host_reports', label: 'Báo cáo', icon: '💰' }, 
        { id: 'host_payments', label: 'Lịch sử tiền', icon: '💳' }, 
        { id: 'host_profile', label: 'Hồ sơ', icon: '👤' }
    ],
    'admin': [
        { id: 'admin_dashboard', label: 'Bảng điều khiển', icon: '📊' }, 
        { id: 'admin_users', label: 'Người dùng', icon: '👥' }, 
        { id: 'admin_hosts', label: 'Chủ cơ sở', icon: '🏢' }, 
        { id: 'admin_activitylog', label: 'Nhật ký hoạt động', icon: '⭐' }
    ]
};

// ==========================================
// SHARED NAVIGATION & UI UTILITIES
// ==========================================
function navigateTo(id) {
    const routes = {
        'home': '/', 
        'search': '/search', 
        'detail': '/detail', 
        'payment': '/payment',
        'history': '/history', 
        'payment_history': '/payment_history', 
        'profile': '/profile',

        'login': '/login', 

        'host_profile': '/host/profile',
        'host_dashboard': '/host/dashboard', 
        'host_spaces': '/host/spaces',
        'host_bookings': '/host/bookings',
        'host_reports': '/host/reports',
        'host_payments': '/host/payments',

        'admin_dashboard': '/admin/dashboard',
        'admin_users': '/admin/users',
        'admin_hosts': '/admin/hosts',
        'admin_activitylog': '/admin/activitylog'
    };
    
    if (routes[id]) {
        window.location.href = routes[id];
    }
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
    const t = document.getElementById('success-toast'), m = document.getElementById('toast-msg'); 
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

// ==========================================
// XỬ LÝ GIAO DIỆN CHUNG DỰA TRÊN TRẠNG THÁI ĐĂNG NHẬP
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    updateUIBasedOnAuth();
});

function updateUIBasedOnAuth() {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('userRole') || 'guest';
    const userName = localStorage.getItem('userName');
    const userAvatar = localStorage.getItem('userAvatar'); // Của Na

    const loginBtn = document.getElementById('nav-login-btn');
    const userInfo = document.getElementById('user-info');
    const nameDisplay = document.getElementById('user-display-name');
    const roleDisplay = document.getElementById('user-display-role');
    const avatarPreview = document.getElementById('header-avatar-preview');
    
    const sidebar = document.getElementById('sidebar'); 
    const sidebarToggle = document.getElementById('sidebar-toggle'); 

    if (token) {
        if (loginBtn) loginBtn.classList.add('hidden');
        if (userInfo) userInfo.classList.remove('hidden');

        if (nameDisplay && userName) nameDisplay.textContent = userName;

        // Ưu tiên Avatar thật, fallback về ui-avatars
        if (avatarPreview && userName) {
            avatarPreview.src = userAvatar
                ? userAvatar
                : `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=0D8B8B&color=fff`;
        }

        if (roleDisplay) {
            if (role === 'host') {
                roleDisplay.textContent = 'Chủ cơ sở';
                roleDisplay.classList.add('text-indigo-600'); 
            } else if (role === 'admin') {
                roleDisplay.textContent = 'Quản trị viên';
                roleDisplay.classList.add('text-red-600');
            } else {
                roleDisplay.textContent = 'Khách hàng';
                roleDisplay.classList.add('text-teal-600');
            }
        }

        if (sidebar) sidebar.classList.remove('hidden-permanent', 'collapsed'); 
        if (sidebarToggle) sidebarToggle.classList.remove('hidden');
        
        renderMenu(role);

    } else {
        if (loginBtn) loginBtn.classList.remove('hidden');
        if (userInfo) userInfo.classList.add('hidden');
        
        if (sidebar) sidebar.classList.add('hidden-permanent'); 
        if (sidebarToggle) sidebarToggle.classList.add('hidden');
    }
}

function renderMenu(currentRole) { 
    const c = document.getElementById('menu-items'); 
    if(!c) return;
    c.innerHTML = ''; 
    
    (menus[currentRole] || []).forEach(i => { 
        const d = document.createElement('div'); 
        d.className = 'nav-item cursor-pointer'; 
        
        let expectedPath = '/' + i.id;
        if (i.id === 'home') expectedPath = '/';
        else if (i.id.startsWith('host_')) expectedPath = '/host/' + i.id.replace('host_', '');
        else if (i.id.startsWith('admin_')) { 
                expectedPath = '/admin/' + i.id.replace('admin_', '');
        }

        if (window.location.pathname === expectedPath) {
            d.classList.add('active');
        }

        d.onclick = () => navigateTo(i.id); 
        d.innerHTML = `<span>${i.icon}</span> ${i.label}`; 
        c.appendChild(d); 
    }); 
}

// ================= CÁC HÀM TƯƠNG TÁC MENU =================
function toggleUserMenu() {
    const dropdown = document.getElementById('dropdown-menu');
    if (dropdown) dropdown.classList.toggle('hidden');
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userName');
    localStorage.removeItem('userId'); // Dọn dẹp cả ID dự phòng
    localStorage.removeItem('userAvatar'); // Dọn dẹp cả Avatar của Na
    localStorage.removeItem('user'); // Dọn dẹp cục object user
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT;";
    window.location.href = '/login';
}

// Ẩn menu người dùng khi click ra ngoài
document.addEventListener('click', (event) => {
    const userInfo = document.getElementById('user-info');
    const dropdown = document.getElementById('dropdown-menu');
    if (userInfo && dropdown && !userInfo.contains(event.target)) {
        dropdown.classList.add('hidden');
    }
});

// ==========================================
// XỬ LÝ SỰ KIỆN ĐỔI MẬT KHẨU (GỬI API LÊN BACKEND)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Tìm nút "THAY ĐỔI MẬT KHẨU"
    const changePasswordBtn = Array.from(document.querySelectorAll('button, a, div'))
        .find(el => el.textContent.trim() === 'THAY ĐỔI MẬT KHẨU');

    if (changePasswordBtn) {
        changePasswordBtn.classList.add('cursor-pointer');

        changePasswordBtn.addEventListener('click', async (e) => {
            e.preventDefault();

            // 2. Trỏ tới các ô nhập
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

            // 3. Validate dữ liệu nhanh ở Frontend
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

                // 4. Lấy token
                const token = localStorage.getItem('token');

                // 5. Gửi request Fetch
                const response = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify({
                        oldPassword: oldPassword,
                        newPassword: newPassword
                    })
                });

                const result = await response.json();

                if (response.ok) {
                    if (typeof showToast === 'function') {
                        showToast('Cập nhật mật khẩu thành công!');
                    } else {
                        alert('Cập nhật mật khẩu thành công!');
                    }

                    // Xóa sạch dữ liệu cũ
                    oldPasswordInput.value = '';
                    newPasswordInput.value = '';
                    confirmPasswordInput.value = '';

                } else {
                    alert(result.error || 'Đổi mật khẩu thất bại, vui lòng thử lại!');
                }

            } catch (error) {
                console.error('Lỗi khi gọi API đổi mật khẩu:', error);
                alert('Có lỗi kết nối hệ thống, vui lòng thử lại sau!');
            } finally {
                changePasswordBtn.innerText = 'THAY ĐỔI MẬT KHẨU';
                changePasswordBtn.style.pointerEvents = 'auto';
            }
        });
    }
});