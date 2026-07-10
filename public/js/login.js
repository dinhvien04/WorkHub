async function handleLogin(event) {
    if (event) event.preventDefault();

    // 1. Thu thập dữ liệu
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    if (!email || !password) {
        return showToast('Vui lòng nhập đầy đủ Email và Mật khẩu!');
    }

    try {
        // 2. Gửi request sang Backend
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        // 3. Nhận phản hồi
        const data = await response.json();

        if (response.ok) {
            // Đăng nhập thành công! 
            showToast('Đăng nhập thành công! Đang chuyển hướng...');

            // LƯU TOKEN VÀ THÔNG TIN VÀO LOCALSTORAGE
            localStorage.setItem('token', data.token); // Cất giấy thông hành
            localStorage.setItem('userRole', data.user.role); // Nhớ vai trò để render UI sau này
            localStorage.setItem('userName', data.user.fullName); // Lưu tên để hiển thị trên UI
            localStorage.setItem('userId', data.user.id); // LƯU LẠI ID DỰ PHÒNG CHỐNG LỖI UI CŨ
            
            // Lưu mảng đối tượng của Na (Phòng hờ cho việc lấy Avatar hay thông tin khác sau này)
            localStorage.setItem('user', JSON.stringify(data.user)); 

            // RẤT QUAN TRỌNG: Lưu Cookie cho hệ thống Render EJS của Backend đọc (Của Bạn)
            document.cookie = `token=${data.token}; path=/; max-age=86400; SameSite=Strict`;

            // ĐIỀU HƯỚNG DỰA TRÊN VAI TRÒ (ROLE-BASED ROUTING)
            setTimeout(() => {
                if (data.user.role === 'host') {
                    window.location.href = '/host/dashboard'; // Host vào trang quản lý
                } else if (data.user.role === 'admin') {
                    window.location.href = '/admin/dashboard'; // Admin vào trang admin
                } else {
                    window.location.href = '/'; // Customer về trang chủ tìm phòng
                }
            }, 1000);

        } else {
            // Lỗi sai mật khẩu, sai email, hoặc bị ban
            showToast(data.error || 'Đăng nhập thất bại!');
        }
    } catch (error) {
        console.error('Lỗi khi gọi API:', error);
        showToast('Không thể kết nối đến máy chủ!');
    }
}

// Hàm đóng/mở chuyển đổi giữa Form Đăng nhập và Form Quên mật khẩu
function toggleForgotPasswordForm(showForgot) {
    const loginArea = document.getElementById('login-form-area');
    const forgotArea = document.getElementById('forgot-form-area');
    
    if (showForgot) {
        loginArea.classList.add('hidden');
        forgotArea.classList.remove('hidden');
    } else {
        loginArea.classList.remove('hidden');
        forgotArea.classList.add('hidden');
        // Reset lại các ô nhập liệu về trạng thái ban đầu
        document.getElementById('otp-email-subzone').classList.remove('hidden');
        document.getElementById('otp-verify-subzone').classList.add('hidden');
    }
}

// BƯỚC 1: Gửi email yêu cầu cấp mã OTP
async function requestOtpCode(event) {
    event.preventDefault();
    const email = document.getElementById('forgot-email').value;

    try {
        const response = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const result = await response.json();

        if (!response.ok) {
            alert(result.error || 'Lỗi gửi yêu cầu.');
        } else {
            alert(result.message);
            // Ẩn ô nhập email đi, mở phân vùng bắt nhập mã OTP và mật khẩu mới lên
            document.getElementById('otp-email-subzone').classList.add('hidden');
            document.getElementById('otp-verify-subzone').classList.remove('hidden');
        }
    } catch (error) {
        alert('Không thể kết nối đến máy chủ.');
    }
}

// BƯỚC 2: Gửi OTP kèm mật khẩu mới lên để cập nhật
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
            body: JSON.stringify({ email, otp, newPassword })
        });

        const result = await response.json();

        if (!response.ok) {
            alert(result.error || 'Lỗi cập nhật mật khẩu.');
        } else {
            alert(result.message);
            // Thành công -> Đưa người dùng về lại form đăng nhập sạch sẽ
            toggleForgotPasswordForm(false);
        }
    } catch (error) {
        alert('Không thể kết nối đến máy chủ.');
    }
}