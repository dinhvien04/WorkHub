let currentSelectedBranch = 'all';
let myChart = null; // Dùng 1 biến duy nhất quản lý Chart

document.addEventListener("DOMContentLoaded", function () {
    loadDashboardData('all');
});

async function loadDashboardData(branchId) {
    const token = localStorage.getItem('token');
    if (!token) {
        alert('Vui lòng đăng nhập để xem dữ liệu!');
        return;
    }

    try {
        // Đã sửa đường dẫn URL chuẩn
        const response = await fetch(`/api/hosts/dashboard-stats?branchId=${branchId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Lỗi tải dữ liệu");

        // 1. Cập nhật số liệu
        document.getElementById('stat-revenue').innerText = result.stats.revenue.toLocaleString('vi-VN') + 'đ';
        document.getElementById('stat-bookings').innerText = result.stats.totalBookings;
        document.getElementById('stat-occupied').innerText = result.stats.totalOccupiedGuests;
        document.getElementById('stat-rooms').innerText = result.stats.activeRoomsCount;
        document.getElementById('finance-paid').innerText = result.stats.revenue.toLocaleString('vi-VN') + 'đ';
        document.getElementById('finance-pending').innerText = result.stats.paidAmount.toLocaleString('vi-VN') + 'đ';

        // 2. Render Tabs Chi nhánh
        if (branchId === 'all' && result.branches) {
            const tabContainer = document.getElementById('branch-tabs-container');
            tabContainer.innerHTML = `<button type="button" data-id="all" class="branch-tab px-5 py-2.5 rounded-xl text-sm font-bold transition ${currentSelectedBranch === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600'}" onclick="switchBranch('all')">Tất cả</button>`;
            result.branches.forEach(b => {
                tabContainer.innerHTML += `
                    <button type="button" data-id="${b._id}" class="branch-tab px-5 py-2.5 rounded-xl text-sm font-bold transition ${currentSelectedBranch === b._id ? 'bg-indigo-600 text-white' : 'text-slate-600'}" onclick="switchBranch('${b._id}')">
                        ${b.Name}
                    </button>`;
            });
        }

        // 3. Khởi tạo Biểu đồ
        if (typeof Chart !== 'undefined' && result.chartData) {
            renderChart(result.chartData);
        }

        // 4. Render Sơ đồ phòng
        const floorPlanContainer = document.getElementById('host-floor-plan-mini');
        floorPlanContainer.innerHTML = '';
        if (result.liveFloorPlan?.length > 0) {
            result.liveFloorPlan.forEach(space => {
                let colorClass = 'bg-emerald-100 border-emerald-200 text-emerald-800';
                if (space.LiveStatus === 'occupied') colorClass = 'bg-rose-100 border-rose-200 text-rose-800';
                else if (space.LiveStatus === 'maintenance') colorClass = 'bg-slate-200 border-slate-300 text-slate-500';

                floorPlanContainer.innerHTML += `
                    <div class="aspect-square min-h-[2.25rem] rounded-lg flex items-center justify-center text-[10px] font-bold border ${colorClass}">
                        ${space.SpaceCode}
                    </div>`;
            });
        }

        // 5. Render Danh sách Booking gần nhất
        const tableBody = document.getElementById('host-recent-table');
        if (tableBody) {
            tableBody.innerHTML = ''; 

            if (result.recentBookings && result.recentBookings.length > 0) {
                result.recentBookings.forEach(booking => {
                    const customerName = booking.CustomerID?.FullName || booking.CustomerID?.fullName || 'Khách vãng lai';
                    const spaceName = booking.SpaceID?.SpaceCode || booking.SpaceID?.name || 'N/A';
                    const date = new Date(booking.createdAt).toLocaleDateString('vi-VN');

                    const statusMap = { 'pending': 'Chờ duyệt', 'confirmed': 'Đã xác nhận', 'in-use': 'Đang sử dụng', 'completed': 'Hoàn thành' };
                    const statusText = statusMap[booking.Status] || booking.Status;

                    tableBody.innerHTML += `
                <tr class="border-b border-slate-100 hover:bg-slate-50">
                    <td class="p-3 font-medium text-slate-800">${customerName}</td>
                    <td class="p-3">${spaceName}</td>
                    <td class="p-3 text-slate-500">${date}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 rounded-md text-[9px] font-bold uppercase ${booking.Status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                            booking.Status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                        }">
                            ${statusText}
                        </span>
                    </td>
                </tr>
            `;
                });
            } else {
                tableBody.innerHTML = '<tr><td colspan="4" class="p-4 text-center text-slate-400">Chưa có đơn đặt chỗ nào.</td></tr>';
            }
        }
    } catch (err) {
        console.error("Lỗi:", err);
    }
}

// Hàm renderChart tách riêng
function renderChart(chartData) {
    const ctx = document.getElementById('bookingChart').getContext('2d');

    if (myChart) {
        myChart.destroy();
    }

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [{
                label: 'Số lượt đặt chỗ',
                data: chartData.bookings,
                borderColor: '#0d9488',
                backgroundColor: 'rgba(13, 148, 136, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#0d9488',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    padding: 12,
                    titleFont: { size: 13 },
                    bodyFont: { size: 14, weight: 'bold' },
                    displayColors: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, color: '#94a3b8' },
                    grid: { color: '#f1f5f9', drawBorder: false }
                },
                x: {
                    ticks: { color: '#94a3b8', font: { weight: 'bold' } },
                    grid: { display: false }
                }
            }
        }
    });
}

// Hàm switchBranch
function switchBranch(branchId) {
    currentSelectedBranch = branchId;
    document.querySelectorAll('.branch-tab').forEach(tab => {
        const isActive = tab.getAttribute('data-id') === branchId;
        tab.className = `branch-tab px-5 py-2.5 rounded-xl text-sm font-bold transition ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-600'}`;
    });
    loadDashboardData(branchId);
}