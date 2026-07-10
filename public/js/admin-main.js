let allUsersList = []; 
let chartInstances = {}; 
let currentAdminTimeType = 'all';
let currentLogPage = 1; 
const LOGS_PER_PAGE = 50;

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    // 1. KÍCH HOẠT CHO TRANG DASHBOARD
    if (path === '/admin/dashboard') {
        setupAdminFilters();
        fetchAdminStats(); // Lệnh này sẽ kéo số liệu về và đắp lên giao diện
        
        // Tự động cập nhật số liệu nếu có thay đổi
        if (typeof io !== 'undefined') {
            const socket = io();
            socket.on('new_audit_log_created', () => {
                fetchAdminStats(); 
            });
        }
    }

    // 2. KÍCH HOẠT CHO TRANG NHẬT KÝ (Đã gom gọn lại, bỏ đoạn lặp thừa)
    if (path === '/admin/activitylog') {
        setupAdminFilters();
        const entityFilter = document.getElementById('filter-entity');
        if (entityFilter) entityFilter.addEventListener('change', () => { currentLogPage = 1; fetchActivityLogs(); });
        
        fetchActivityLogs(); 

        if (typeof io !== 'undefined') {
            const socket = io();
            socket.on('new_audit_log_created', () => {
                console.log('🔔 Có hoạt động mới, đang tự động làm mới bảng...');
                currentLogPage = 1; 
                fetchActivityLogs(); 
            });
        }
    }

    // 3. KÍCH HOẠT CHO TRANG QUẢN LÝ NGƯỜI DÙNG
    if (path === '/admin/users') {
        fetchUsers(); 
        const searchInput = document.getElementById('search-user');
        const roleFilter = document.getElementById('filter-role');
        if (searchInput) searchInput.addEventListener('input', filterUsersList);
        if (roleFilter) roleFilter.addEventListener('change', filterUsersList);
    }

    // 4. KÍCH HOẠT CHO TRANG DUYỆT HOST
    if (path === '/admin/hosts') {
        fetchPendingHosts();
    }
});

// =====================================
// INTERFACE: BỘ LỌC CHUNG
// =====================================
function setupAdminFilters() {
    const timeBtn = document.getElementById('custom-time-btn');
    const timeMenu = document.getElementById('custom-time-menu');
    const timeText = document.getElementById('custom-time-text');
    const timeOptions = document.querySelectorAll('.time-option-btn');
    const d1 = document.getElementById('filter-date-1');
    const d2 = document.getElementById('filter-date-2');
    const keywordInput = document.getElementById('filter-keyword');

    const triggerFetch = () => {
        if (window.location.pathname === '/admin/dashboard') fetchAdminStats();
        else if (window.location.pathname === '/admin/activitylog') { currentLogPage = 1; fetchActivityLogs(); }
    };

    if (timeBtn && timeMenu) {
        timeBtn.onclick = (e) => {
            e.stopPropagation();
            timeMenu.classList.toggle('hidden');
            timeMenu.classList.toggle('opacity-0');
            timeMenu.classList.toggle('scale-95');
        };
    }

    document.addEventListener('click', (e) => {
        if (timeMenu && !timeMenu.classList.contains('hidden') && !timeBtn.contains(e.target) && !timeMenu.contains(e.target)) {
            timeMenu.classList.add('opacity-0', 'scale-95');
            setTimeout(() => { timeMenu.classList.add('hidden'); }, 200);
        }
    });

    timeOptions.forEach(btn => {
        btn.onclick = () => {
            currentAdminTimeType = btn.getAttribute('data-value');
            timeOptions.forEach(b => { b.classList.remove('text-teal-600'); b.classList.add('text-slate-700'); });
            btn.classList.remove('text-slate-700'); btn.classList.add('text-teal-600');
            timeMenu.classList.add('hidden', 'opacity-0');

            if (currentAdminTimeType === 'all') {
                timeText.textContent = 'Tất cả thời gian';
                if(d1) d1.value = ''; if(d2) d2.value = '';
                triggerFetch();
            } else {
                try { d1.showPicker(); } catch (e) { d1.focus(); }
            }
        };
    });

    const formatDateVN = (d) => d ? d.split('-').reverse().join('/') : '';

    if (d1) d1.onchange = () => {
        if (currentAdminTimeType === 'specific') {
            timeText.textContent = `Lọc: ${formatDateVN(d1.value)}`;
            triggerFetch();
        } else if (currentAdminTimeType === 'range') {
            setTimeout(() => { try { d2.showPicker(); } catch (e) { d2.focus(); } }, 100);
        }
    };

    if (d2) d2.onchange = () => {
        if (currentAdminTimeType === 'range') {
            timeText.textContent = `${formatDateVN(d1.value)} - ${formatDateVN(d2.value)}`;
            triggerFetch();
        }
    };

    if (keywordInput) {
        keywordInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); triggerFetch(); } };
    }
}

// =====================================
// DATA: API DASHBOARD
// =====================================
async function fetchAdminStats() {
    const token = localStorage.getItem('token');
    if (!token) return;

    const d1 = document.getElementById('filter-date-1')?.value || '';
    const d2 = document.getElementById('filter-date-2')?.value || '';
    let startDate = currentAdminTimeType !== 'all' ? d1 : '';
    let endDate = currentAdminTimeType !== 'all' ? (d2 || d1) : '';
    const keyword = document.getElementById('filter-keyword')?.value.trim() || '';

    try {
        const queryParams = new URLSearchParams({ startDate, endDate, keyword }).toString();
        const response = await fetch(`/api/admin/stats?${queryParams}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        if (response.ok) {
            const data = await response.json();
            animateValue('stat-users', 0, data.totals?.users || 0, 1000);
            animateValue('stat-hosts', 0, data.totals?.hosts || 0, 1000);
            animateValue('stat-branches', 0, data.totals?.branches || 0, 1000);
            animateValue('stat-spaces', 0, data.totals?.spaces || 0, 1000);
            animateValue('stat-bookings', 0, data.totals?.bookings || 0, 1000);

            renderRevenueChart(data.revenueByDay || []);
            renderBookingStatusChart(data.bookingStatusStats || []);
            renderTopHosts(data.topHosts || []);
            renderAuditLogs(data.auditLogs || []);
        } else {
            console.error("Lỗi API Stats");
        }
    } catch (error) { console.error('Lỗi lấy số liệu thống kê:', error); }
}

function animateValue(id, start, end, duration) {
    let obj = document.getElementById(id);
    if (!obj) return;
    if (start === end) { obj.innerHTML = end; return; }
    let range = end - start;
    let current = start;
    let increment = end > start ? 1 : -1;
    let stepTime = Math.abs(Math.floor(duration / range));
    if (stepTime < 1) stepTime = 1;
    let timer = setInterval(function() {
        current += increment;
        obj.innerHTML = current;
        if (current == end) clearInterval(timer);
    }, stepTime);
}

// =====================================
// VISUAL: VẼ BIỂU ĐỒ (DASHBOARD)
// =====================================
function renderRevenueChart(revenueData) {
    const ctx = document.getElementById('revenueLineChart')?.getContext('2d');
    if (!ctx) return;
    if (chartInstances['revenue']) chartInstances['revenue'].destroy(); 

    const labels = revenueData.map(item => item._id);
    const values = revenueData.map(item => item.total);

    chartInstances['revenue'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.length ? labels : ['Chưa có dữ liệu'],
            datasets: [{
                label: 'Doanh thu (VND)', data: values.length ? values : [0],
                borderColor: '#0d9488', backgroundColor: 'rgba(13, 148, 136, 0.1)',
                borderWidth: 3, tension: 0.4, fill: true
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
    });
}

function renderBookingStatusChart(statusData) {
    const ctx = document.getElementById('bookingStatusChart')?.getContext('2d');
    if (!ctx) return;
    if (chartInstances['status']) chartInstances['status'].destroy();

    const statusNames = { 'pending': 'Chờ duyệt', 'confirmed': 'Đã xác nhận', 'in-use': 'Đang dùng', 'completed': 'Hoàn thành', 'cancelled': 'Đã hủy' };
    const statusColors = { 'pending': '#f59e0b', 'confirmed': '#3b82f6', 'in-use': '#8b5cf6', 'completed': '#10b981', 'cancelled': '#ef4444' };
    const labels = statusData.map(item => statusNames[item._id] || item._id);
    const values = statusData.map(item => item.count);
    const colors = statusData.map(item => statusColors[item._id] || '#cbd5e1');

    chartInstances['status'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['Chưa có đơn'],
            datasets: [{ data: values.length ? values : [1], backgroundColor: colors }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderTopHosts(hosts) {
    const container = document.getElementById('top-hosts-container');
    if (!container) return;
    if (hosts.length === 0) { container.innerHTML = '<p class="text-sm text-slate-400 italic">Chưa có dữ liệu giao dịch.</p>'; return; }
    container.innerHTML = hosts.map((host, idx) => `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100 mb-2">
            <div class="flex items-center gap-3">
                <span class="w-6 h-6 rounded-full bg-amber-100 text-amber-700 font-black text-xs flex items-center justify-center">${idx + 1}</span>
                <span class="font-bold text-slate-700 text-sm">${host.name}</span>
            </div>
            <span class="font-black text-teal-600">${host.total.toLocaleString('vi-VN')}đ</span>
        </div>
    `).join('');
}

function renderAuditLogs(logs) {
    const container = document.getElementById('audit-log-container');
    if (!container) return;
    if (logs.length === 0) { container.innerHTML = '<p class="text-sm text-slate-400 italic">Chưa có hoạt động.</p>'; return; }
    container.innerHTML = logs.map(log => `
        <div class="flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg transition border-b border-slate-50">
            <div class="text-lg pt-0.5 ${log.color}">${log.icon}</div>
            <div class="flex-1">
                <p class="text-xs text-slate-800 font-medium whitespace-normal leading-tight">${log.text}</p>
                <p class="text-[10px] text-slate-400 mt-0.5">${new Date(log.time).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'})}</p>
            </div>
        </div>
    `).join('');
}

// =====================================
// DATA: API ACTIVITY LOG (NHẬT KÝ)
// =====================================
async function fetchActivityLogs() {
    const token = localStorage.getItem('token');
    if (!token) return;

    const d1 = document.getElementById('filter-date-1')?.value || '';
    const d2 = document.getElementById('filter-date-2')?.value || '';
    let startDate = currentAdminTimeType !== 'all' ? d1 : '';
    let endDate = currentAdminTimeType !== 'all' ? (d2 || d1) : '';
    const keyword = document.getElementById('filter-keyword')?.value.trim() || '';
    const entity = document.getElementById('filter-entity')?.value || 'all';
    const tbody = document.getElementById('activity-log-table-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400 font-medium">Đang tải dữ liệu...</td></tr>';

    try {
        const params = new URLSearchParams({ page: currentLogPage, limit: LOGS_PER_PAGE, search: keyword, entity, startDate, endDate });
        const res = await fetch(`/api/admin/activity-logs?${params}`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok) {
            renderActivityLogTable(data.logs);
            renderLogPagination(data.pagination);
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-500">Lỗi lấy dữ liệu</td></tr>`;
        }
    } catch (e) { console.error(e); }
}

function renderActivityLogTable(logs) {
    const tbody = document.getElementById('activity-log-table-body');
    if (!tbody) return;
    if (logs.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400">Chưa có dữ liệu.</td></tr>'; return; }

    // BỘ TỪ ĐIỂN DỊCH MÃ HÀNH ĐỘNG
const actionDictionary = {
        'LOGIN': 'Đăng nhập',
        'LOGOUT': 'Đăng xuất',
        'REGISTER_USER': 'Đăng ký mới',
        'BAN_USER': 'Khóa tài khoản',
        'UNBAN_USER': 'Mở khóa tài khoản',
        'VERIFY_HOST': 'Duyệt chủ cơ sở',
        'CREATE_BOOKING': 'Đặt chỗ mới',
        'CONFIRM_BOOKING': 'Xác nhận đơn',    
        'CHECKIN_BOOKING': 'Nhận phòng',
        'CANCEL_BOOKING': 'Hủy đặt chỗ',
        'PAYMENT': 'Thanh toán',
        'CONFIRM': 'Xác nhận đơn', 
        'CHECKIN': 'Nhận phòng',
        'PAYMENT_PENDING': 'Chờ duyệt tiền',
        'PAYMENT_SUCCESS': 'Thanh toán thành công',
        'UPDATE_PROFILE': 'Cập nhật hồ sơ',
        'SUBMIT_REVIEW': 'Đánh giá đơn',
        'UPDATE_REVIEW': 'Sửa đánh giá'
    };

    tbody.innerHTML = logs.map(log => {
        const timeStr = new Date(log.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'medium' });
        
        // 1. Phân loại màu sắc
        const rawAction = String(log.ActionType || '').toUpperCase();
        const actionText = actionDictionary[rawAction] || rawAction;
        let badgeClass = 'bg-slate-100 text-slate-600'; 
        if (rawAction.includes('BAN') || rawAction.includes('CANCEL') || rawAction.includes('DELETE')) badgeClass = 'bg-red-100 text-red-700';
        else if (rawAction.includes('LOGIN') || rawAction.includes('CHECKIN')) badgeClass = 'bg-blue-100 text-blue-700';
        else if (rawAction.includes('CREATE') || rawAction.includes('REGISTER') || rawAction.includes('SUCCESS') || rawAction.includes('CONFIRM')) badgeClass = 'bg-emerald-100 text-emerald-700';
        else if (rawAction.includes('VERIFY') || rawAction.includes('UPDATE')) badgeClass = 'bg-amber-100 text-amber-700';

        // 2. Mã hóa mô tả
        const safeDesc = encodeURIComponent(log.Description || 'Không có mô tả');

        // NÂNG CẤP CỘT NGƯỜI THỰC HIỆN: Truyền thẳng câu mô tả (safeDesc) vào Popup
        let actorHtml = '<span class="text-slate-400 italic">Hệ thống</span>';
        if (log.ActorID) {
            actorHtml = `
                <button onclick="viewDetails('USER', '${log.ActorID._id}', '${safeDesc}')" class="text-left hover:underline hover:text-teal-600 block transition cursor-pointer">
                    <p class="font-bold text-slate-800">${log.ActorID.FullName || 'Không rõ'}</p>
                    <p class="text-[10px] text-slate-500 uppercase font-black">${log.ActorID.Role}</p>
                </button>
            `;
        }
        // 4. NÂNG CẤP CỘT NỘI DUNG: Chèn Tem Link
        let descHtml = `<span class="leading-relaxed text-slate-700">${log.Description}</span>`;
        
        // Trả về đúng 4 cột
        return `
            <tr class="hover:bg-slate-50 transition border-b border-slate-50">
                <td class="p-4 text-slate-500 text-xs">${timeStr}</td>
                <td class="p-4">${actorHtml}</td>
                <td class="p-4"><span class="px-2 py-1 rounded-md text-[10px] font-black tracking-wider ${badgeClass}">${actionText}</span></td>
                <td class="p-4 text-sm font-medium">${descHtml}</td>
            </tr>
        `;
    }).join('');
}

function renderLogPagination(p) {
    const cont = document.getElementById('pagination-container');
    if (!cont) return;
    if (p.totalLogs === 0) { cont.innerHTML = ''; return; }
    cont.innerHTML = `
        <div>Hiển thị <span class="font-black">${((p.currentPage - 1) * p.limit) + 1}</span> - <span class="font-black">${Math.min(p.currentPage * p.limit, p.totalLogs)}</span> / <span class="font-black">${p.totalLogs}</span> sự kiện</div>
        <div class="flex gap-2">
            <button class="px-3 py-1 border rounded disabled:opacity-50" ${p.currentPage === 1 ? 'disabled' : ''} onclick="currentLogPage--; fetchActivityLogs()">Trước</button>
            <button class="px-3 py-1 border rounded disabled:opacity-50" ${p.currentPage === p.totalPages ? 'disabled' : ''} onclick="currentLogPage++; fetchActivityLogs()">Sau</button>
        </div>
    `;
}

// =====================================
// DATA: API QUẢN LÝ USER VÀ HOST
// =====================================
async function fetchUsers() {
    const token = localStorage.getItem('token');
    const tbody = document.getElementById('user-table-body');
    if (!token) return;
    try {
        const response = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.ok) {
            const data = await response.json(); allUsersList = data.users; renderUserTable(allUsersList); 
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 font-bold">Lỗi tải dữ liệu</td></tr>`;
        }
    } catch (error) { console.error(error); }
}

function filterUsersList() {
    const searchValue = document.getElementById('search-user').value.toLowerCase().trim();
    const roleValue = document.getElementById('filter-role').value;
    const filteredUsers = allUsersList.filter(user => {
        const nameMatch = (user.FullName || '').toLowerCase().includes(searchValue);
        const emailMatch = (user.Email || '').toLowerCase().includes(searchValue);
        return (nameMatch || emailMatch) && (roleValue === 'all' || user.Role === roleValue);
    });
    renderUserTable(filteredUsers);
}
// Hàm này sẽ chịu trách nhiệm đổ dữ liệu người dùng vào bảng, bao gồm cả phần nút hành động
function renderUserTable(users) {
    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;
    if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="p-8 text-center text-slate-400">Chưa có dữ liệu.</td></tr>'; return; }

    tbody.innerHTML = users.map(user => {
        let roleBadge = user.Role === 'admin' ? '<span class="px-2 py-1 bg-red-100 text-red-700 rounded-md text-xs font-bold">Admin</span>' : (user.Role === 'host' ? '<span class="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-md text-xs font-bold">Chủ cơ sở</span>' : '<span class="px-2 py-1 bg-teal-100 text-teal-700 rounded-md text-xs font-bold">Khách hàng</span>');
        let statusBadge = user.Status === 'active' ? '<span class="text-green-600 font-medium text-xs">Hoạt động</span>' : '<span class="text-red-600 font-medium text-xs">Bị khóa</span>';
        let actionBtn = user.Role === 'admin' ? '<span class="text-slate-400 text-xs italic">Bất tử 🛡️</span>' : (user.Status === 'active' ? `<button class="text-red-600 text-sm font-bold" onclick="toggleUserStatus('${user._id}', 'banned')">Khóa</button>` : `<button class="text-green-600 text-sm font-bold" onclick="toggleUserStatus('${user._id}', 'active')">Mở khóa</button>`);
        return `<tr class="hover:bg-slate-50"><td class="p-4 font-bold text-slate-800">${user.FullName || 'Chưa cập nhật'}</td><td class="p-4">${user.Email}</td><td class="p-4">${roleBadge}</td><td class="p-4">${statusBadge}</td><td class="p-4 text-right">${actionBtn}</td></tr>`;
    }).join('');
}

async function toggleUserStatus(userId, targetStatus) {
    if (!confirm(`Xác nhận thao tác này?`)) return;
    
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại!');
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}/toggle-status`, { 
            method: 'PATCH', 
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            } 
        });
        
        const data = await response.json();

        if (response.ok) { 
            alert('Thành công!'); 
            fetchUsers(); 
        } else {
            // NẾU CÓ LỖI TỪ SERVER, NÓ SẼ BÁO RÕ RÀNG Ở ĐÂY
            alert(`Lỗi: ${data.error || 'Lỗi không xác định'}`);
            console.error("Chi tiết lỗi:", data);
        }
    } catch (error) { 
        alert('Lỗi mạng hoặc không thể kết nối đến máy chủ.'); 
        console.error(error);
    }
}
async function fetchPendingHosts() {
    const token = localStorage.getItem('token');
    const tbody = document.getElementById('pending-hosts-body');
    if (!token || !tbody) return;
    try {
        const response = await fetch('/api/admin/pending-hosts', { headers: { 'Authorization': `Bearer ${token}` } });
        if (response.ok) { 
            const data = await response.json(); 
            renderPendingHostsTable(data.hosts); 
        } else {
            // Hiển thị lỗi ra màn hình nếu API có vấn đề thay vì treo "Đang tải..."
            tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-500 font-bold">Lỗi tải dữ liệu. Vui lòng kiểm tra lại.</td></tr>';
        }
    } catch (error) { 
        console.error(error); 
        tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-red-500 font-bold">Lỗi kết nối máy chủ.</td></tr>';
    }
}

function renderPendingHostsTable(hosts) {
    const tbody = document.getElementById('pending-hosts-body');
    if (!tbody) return;
    if (hosts.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-slate-400">Không có hồ sơ chờ duyệt.</td></tr>'; return; }
    tbody.innerHTML = hosts.map(host => `<tr class="hover:bg-amber-50"><td class="p-4"><p class="font-bold">${host.UserID?.FullName || 'Không rõ'}</p><p class="text-xs text-slate-500">${host.UserID?.Email || ''}</p></td><td class="p-4"><p class="font-bold text-indigo-700">${host.CompanyName || 'Chưa cập nhật'}</p><p class="text-xs">Bank: ${host.BankName} - ${host.BankNumber}</p></td><td class="p-4">📞 ${host.Hotline || 'Trống'}</td><td class="p-4 text-right"><button class="bg-amber-500 text-white text-sm font-bold px-4 py-2 rounded-lg" onclick="verifyHost('${host._id}')">Phê duyệt</button></td></tr>`).join('');
}

async function verifyHost(hostId) {
    if (!confirm('Xác nhận phê duyệt?')) return;
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/admin/hosts/${hostId}/verify`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } });
        if (response.ok) { alert('Thành công!'); fetchPendingHosts(); }
    } catch (error) { alert('Lỗi kết nối.'); }
}

// =====================================
// ĐIỀU KHIỂN POPUP CHI TIẾT (MODAL DEEP LINK)
// =====================================
async function viewDetails(entityType, targetId, safeDescription) {
    const modal = document.getElementById('detail-modal');
    const modalContent = document.getElementById('detail-modal-content');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    const description = decodeURIComponent(safeDescription);
    const entityNames = {
        'USER': 'Hồ sơ Người dùng', 'HOSTPROFILE': 'Hồ sơ Chủ cơ sở',
        'BOOKING': 'Đơn đặt chỗ', 'SPACE': 'Phòng / Không gian',
        'BRANCH': 'Chi nhánh Cơ sở', 'PAYMENT': 'Lịch sử Giao dịch',
        'PAYMENTHISTORY': 'Lịch sử Giao dịch'
    };
    const friendlyName = entityNames[String(entityType).toUpperCase()] || entityType;

    modalTitle.textContent = `Chi tiết: ${friendlyName}`;
    
    modalBody.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8">
            <div class="w-8 h-8 border-4 border-slate-200 border-t-teal-500 rounded-full animate-spin mb-3"></div>
            <p class="text-xs font-bold text-slate-400 animate-pulse">Đang truy xuất hệ thống...</p>
        </div>
    `;

    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); modalContent.classList.remove('scale-95'); }, 10);

    try {
        const token = localStorage.getItem('token');
        const res = await fetch(`/api/admin/entity-detail?type=${entityType}&id=${targetId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();

        if (!res.ok) throw new Error(result.error || 'Lỗi không xác định');

        const d = result.data;
       let html = `
            <div class="bg-teal-50 border border-teal-100 p-3 rounded-xl mb-5">
                <span class="text-[10px] font-black text-teal-600 uppercase block mb-1">Nội dung hoạt động:</span>
                <span class="text-sm font-medium text-teal-900">${description}</span>
            </div>`;

        switch (result.type) {
            case 'BOOKING':
                html += `
                    <div class="grid grid-cols-2 gap-4">
                        <div class="col-span-2 bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                            <h4 class="text-xs font-black text-indigo-800 uppercase mb-2">Thông tin đơn</h4>
                            <p><strong>Mã đơn:</strong> <span class="font-mono bg-white px-1 rounded">${d._id}</span></p>
                            <p class="mt-1"><strong>Trạng thái:</strong> <span class="uppercase font-bold text-indigo-600">${d.Status}</span></p>
                        </div>
                        <div class="p-4 border border-slate-100 rounded-xl shadow-sm">
                            <h4 class="text-xs font-black text-slate-500 uppercase mb-2">Khách hàng</h4>
                            <p class="font-bold text-slate-800">${d.UserID?.FullName || 'Không rõ'}</p>
                            <p class="text-xs mt-1">📞 ${d.UserID?.Phone || 'Chưa cập nhật'}</p>
                            <p class="text-xs text-slate-500">✉️ ${d.UserID?.Email || 'Không rõ'}</p>
                        </div>
                        <div class="p-4 border border-slate-100 rounded-xl shadow-sm">
                            <h4 class="text-xs font-black text-slate-500 uppercase mb-2">Chủ cơ sở (Host)</h4>
                            <p class="font-bold text-slate-800">${d.SpaceID?.BranchID?.HostID?.FullName || 'Không rõ'}</p>
                            <p class="text-xs mt-1">📞 ${d.SpaceID?.BranchID?.HostID?.Phone || 'Chưa cập nhật'}</p>
                            <p class="text-xs text-slate-500">🏢 CN: ${d.SpaceID?.BranchID?.Name || 'Không rõ'}</p>
                        </div>
                        <div class="col-span-2 p-4 border border-slate-100 rounded-xl shadow-sm flex justify-between items-center">
                            <div>
                                <h4 class="text-xs font-black text-slate-500 uppercase mb-1">Dịch vụ & Tài chính</h4>
                                <p class="font-bold text-slate-800">${d.SpaceID?.Name || 'Phòng đã bị xóa'}</p>
                                <p class="text-xs text-slate-500 mt-1">Nhận: ${new Date(d.StartTime).toLocaleString('vi-VN')} <br> Trả: ${new Date(d.EndTime).toLocaleString('vi-VN')}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-2xl font-black text-teal-600">${(d.TotalPrice || 0).toLocaleString('vi-VN')}đ</p>
                                <p class="text-[10px] uppercase font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded inline-block mt-1">${d.PaymentStatus || 'Không rõ'}</p>
                            </div>
                        </div>
                    </div>`;
                break;

            case 'USER':
            case 'HOSTPROFILE':
                html += `
                    <div class="flex items-center gap-4 mb-4 p-4 border border-slate-100 rounded-xl shadow-sm">
                        <div class="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-2xl">${d.user?.Avatar ? `<img src="${d.user.Avatar}" class="rounded-full w-full h-full object-cover">` : '👤'}</div>
                        <div>
                            <h3 class="text-lg font-black text-slate-800">${d.user?.FullName || 'Chưa cập nhật'}</h3>
                            <span class="text-[10px] uppercase font-bold text-white px-2 py-0.5 rounded ${d.user?.Role === 'host' ? 'bg-indigo-500' : (d.user?.Role === 'admin' ? 'bg-red-500' : 'bg-teal-500')}">${d.user?.Role}</span>
                            <span class="text-[10px] uppercase font-bold px-2 py-0.5 rounded ml-1 ${d.user?.Status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">${d.user?.Status}</span>
                        </div>
                    </div>
                    <div class="space-y-2 p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm">
                        <p><strong>Email:</strong> ${d.user?.Email}</p>
                        <p><strong>SĐT:</strong> ${d.user?.Phone || 'Chưa cập nhật'}</p>
                        <p><strong>Ngày tham gia:</strong> ${new Date(d.user?.createdAt).toLocaleDateString('vi-VN')}</p>
                    </div>`;
                if (d.hostInfo) {
                    html += `
                    <div class="mt-4 p-4 bg-amber-50 rounded-xl border border-amber-100 text-sm">
                        <h4 class="text-xs font-black text-amber-800 uppercase mb-2">Hồ sơ Doanh nghiệp</h4>
                        <p><strong>Tên CTY/Cơ sở:</strong> ${d.hostInfo.CompanyName}</p>
                        <p><strong>Hotline:</strong> ${d.hostInfo.Hotline || 'Không có'}</p>
                        <p><strong>Ngân hàng:</strong> ${d.hostInfo.BankName} - ${d.hostInfo.BankNumber}</p>
                        <p><strong>Trạng thái duyệt:</strong> ${d.hostInfo.IsVerified ? '✅ Đã duyệt' : '⏳ Chờ duyệt'}</p>
                    </div>`;
                }
                break;

            case 'SPACE':
            case 'BRANCH':
                html += `
                    <div class="p-5 border border-slate-100 rounded-xl shadow-sm text-sm">
                        <h3 class="text-lg font-black text-slate-800 mb-2">${d.Name}</h3>
                        <p class="text-xs text-slate-500 uppercase font-bold mb-4">${d.isSpace ? 'Phòng / Không gian' : 'Chi nhánh Cơ sở'}</p>
                        <div class="space-y-2">
                            ${d.isSpace ? `<p><strong>Thuộc chi nhánh:</strong> ${d.BranchID?.Name || 'Không rõ'}</p>` : ''}
                            <p><strong>Quản lý bởi Host:</strong> ${d.isSpace ? (d.BranchID?.HostID?.FullName || 'Không rõ') : (d.HostID?.FullName || 'Không rõ')}</p>
                            ${d.isSpace ? `<p><strong>Sức chứa:</strong> ${d.Capacity || 0} người</p>` : ''}
                            ${d.isSpace ? `<p><strong>Giá:</strong> ${d.PricePerHour?.toLocaleString('vi-VN')}đ/giờ | ${d.PricePerDay?.toLocaleString('vi-VN')}đ/ngày</p>` : ''}
                            <p><strong>Trạng thái:</strong> ${d.Status}</p>
                        </div>
                    </div>`;
                break;

            case 'PAYMENT':
            case 'PAYMENTHISTORY':
                html += `
                    <div class="text-center p-6 border border-slate-100 rounded-xl shadow-sm">
                        <p class="text-xs font-black text-slate-400 uppercase mb-1">Tổng tiền giao dịch</p>
                        <p class="text-4xl font-black text-teal-600 mb-4">${(d.Amount || 0).toLocaleString('vi-VN')}đ</p>
                        <div class="bg-slate-50 rounded-lg p-4 text-left text-sm space-y-2 inline-block w-full">
                            <p><strong>Mã GD:</strong> <span class="font-mono">${d._id}</span></p>
                            <p><strong>Phương thức:</strong> <span class="uppercase font-bold text-indigo-600">${d.PaymentMethod || 'Không rõ'}</span></p>
                            <p><strong>Thời gian:</strong> ${new Date(d.createdAt).toLocaleString('vi-VN')}</p>
                            <p><strong>Thuộc đơn đặt chỗ:</strong> <span class="font-mono underline text-blue-600 cursor-pointer" onclick="viewDetails('BOOKING', '${d.BookingID?._id}', 'Chuyển hướng từ giao dịch')">${d.BookingID?._id || 'Đơn đã bị xóa'}</span></p>
                        </div>
                    </div>`;
                break;
            case 'REVIEW':
                html += `
                    <div class="p-6 text-center border border-slate-100 rounded-xl shadow-sm">
                        <p class="text-xs font-black text-slate-400 uppercase mb-2">Đánh giá từ khách hàng</p>
                        <div class="text-4xl mb-3">${'★'.repeat(d.Rating)}${'☆'.repeat(5 - d.Rating)}</div>
                        <p class="text-slate-800 italic bg-slate-50 p-4 rounded-lg">"${d.Comment}"</p>
                        <div class="mt-4 text-left text-sm space-y-1 text-slate-600">
                            <p><strong>Khách hàng:</strong> ${d.CustomerID?.FullName || 'Ẩn danh'}</p>
                            <p><strong>Không gian:</strong> ${d.SpaceID?.Name || 'Không rõ'}</p>
                            <p><strong>Ngày:</strong> ${new Date(d.createdAt).toLocaleDateString('vi-VN')}</p>
                        </div>
                    </div>`;
                break;

            default:
                html += `<div class="p-4 bg-slate-100 text-center rounded-xl text-slate-600">Dữ liệu dạng thô: <br><code class="text-xs break-all">${JSON.stringify(d)}</code></div>`;
        }

        modalBody.innerHTML = html;

    } catch (error) {
        modalBody.innerHTML = `
            <div class="bg-red-50 p-4 rounded-xl text-center">
                <div class="text-4xl mb-2">⚠️</div>
                <h4 class="text-red-800 font-bold mb-1">Không thể tải dữ liệu</h4>
                <p class="text-red-600 text-sm">${error.message}</p>
            </div>
        `;
    }
}

function closeDetailsModal() {
    const modal = document.getElementById('detail-modal');
    const modalContent = document.getElementById('detail-modal-content');
    if(modal && modalContent) {
        modal.classList.add('opacity-0');
        modalContent.classList.add('scale-95');
        setTimeout(() => { modal.classList.add('hidden'); }, 200);
    }
}

