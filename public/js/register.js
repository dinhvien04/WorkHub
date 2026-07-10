// public/js/register.js
async function handleRegister(event) {
    event.preventDefault(); // Chặn hành vi load lại trang mặc định

    // 1. Lấy giá trị của Role đang được tích chọn (customer hoặc host)
    const role = document.querySelector('input[name="role"]:checked').value;

    // 2. Khởi tạo đối tượng FormData (Bắt buộc để gửi file truyền tải qua mạng)
    const formData = new FormData();

    // 3. Nạp tất cả các thông tin cơ bản dạng chữ vào FormData
    formData.append('role', role);
    formData.append('fullName', document.getElementById('fullName').value);
    formData.append('email', document.getElementById('email').value);
    formData.append('password', document.getElementById('password').value);
    formData.append('confirmPassword', document.getElementById('confirmPassword').value);
    formData.append('phone', document.getElementById('phone').value);
    formData.append('bankName', document.getElementById('bankName').value);
    formData.append('bankNumber', document.getElementById('bankNumber').value);

    // Kiểm tra mật khẩu trùng khớp ở frontend trước
    if (document.getElementById('password').value !== document.getElementById('confirmPassword').value) {
        alert('Mật khẩu xác nhận không trùng khớp!');
        return;
    }

    // 4. Nếu đăng ký làm Host, nạp thêm thông tin doanh nghiệp và FILE
    if (role === 'host') {
        formData.append('companyName', document.getElementById('companyName').value);
        formData.append('taxCode', document.getElementById('taxCode').value);
        
        // Lấy file từ ô input file ra
        const fileInput = document.getElementById('verificationDoc');
        if (fileInput.files.length > 0) {
            // Nhãn dán gửi lên server bắt buộc phải khớp với cấu hình ở Route: 'verificationDocument'
            formData.append('verificationDocument', fileInput.files[0]); 
        }
    }

    try {
        // 5. Gửi API lên Server
        // LƯU Ý ĐẶC BIỆT: Tuyệt đối không viết headers: {'Content-Type': 'application/json'} vào đây.
        // Khi truyền biến formData, trình duyệt sẽ tự cấu hình Content-Type Multipart thích hợp.
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            body: formData 
        });

        const result = await response.json();

        if (!response.ok) {
            alert(result.error || 'Có lỗi xảy ra khi đăng ký.');
        } else {
            alert('Đăng ký tài khoản thành công!');
            window.location.href = '/login'; // Chuyển hướng sang trang đăng nhập
        }
    } catch (error) {
        console.error('Đăng ký lỗi:', error);
        alert('Không thể kết nối đến máy chủ.');
    }
}

// Hàm ẩn hiện trường thông tin cho Host (Dữ liệu giao diện của bạn)
function toggleHostFields() {
    const roleHost = document.getElementById('roleHost').checked;
    const hostFields = document.getElementById('hostFields');
    if (roleHost) {
        hostFields.classList.remove('hidden');
    } else {
        hostFields.classList.add('hidden');
    }
}


// Hàm xử lý đăng ký (gọi API)
// Sử dụng FormData để có thể gửi cả file (giấy phép kinh doanh) và text
async function handleRegister(event) {
    if (event) event.preventDefault(); // Chặn hành vi load lại trang mặc định

    // 1. Thu thập dữ liệu cơ bản
    const role = document.querySelector('input[name="role"]:checked').value;
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const fullName = document.getElementById('fullName').value;

    if (password !== confirmPassword) {
        if (typeof showToast === 'function') {
            return showToast('Mật khẩu xác nhận không khớp!'); 
        } else {
            alert('Mật khẩu xác nhận không khớp!');
            return;
        }
    }

    // Các trường bổ sung (Hỗ trợ cả ID giao diện của HEAD và Na)
    const phoneInput = document.getElementById('phone');
    const hotlineInput = document.getElementById('hotline');
    const phoneVal = phoneInput ? phoneInput.value : (hotlineInput ? hotlineInput.value : "");

    const bankName = document.getElementById('bankName')?.value || "";
    const bankNumber = document.getElementById('bankNumber')?.value || "";

    // 2. Khởi tạo đối tượng FormData (Bắt buộc để gửi file truyền tải qua mạng)
    const formData = new FormData();
    formData.append('role', role);
    formData.append('email', email);
    formData.append('password', password);
    formData.append('fullName', fullName);
    formData.append('phone', phoneVal); 
    formData.append('hotline', phoneVal); // Gửi cả 2 tên biến để Backend hứng được kiểu gì cũng nhận
    formData.append('bankName', bankName);
    formData.append('bankNumber', bankNumber);

    // 3. Nếu đăng ký làm Host, nạp thêm thông tin doanh nghiệp và FILE
    if (role === 'host') {
        const companyName = document.getElementById('companyName')?.value || "";
        const taxCode = document.getElementById('taxCode')?.value || "";
        
        formData.append('companyName', companyName);
        formData.append('taxCode', taxCode);
        
        // Lấy file từ ô input file ra
        const fileInput = document.getElementById('verificationDoc');
        if (fileInput && fileInput.files.length > 0) {
            // Nhãn dán gửi lên server bắt buộc phải khớp với cấu hình Multer ở Route: 'verificationDocument'
            formData.append('verificationDocument', fileInput.files[0]); 
        }
    }

    try {
        // 4. Gửi API lên Server
        // LƯU Ý ĐẶC BIỆT: Tuyệt đối không viết headers: {'Content-Type': 'application/json'} vào đây.
        // Khi truyền biến formData, trình duyệt sẽ tự cấu hình Content-Type Multipart thích hợp.
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            body: formData 
        });

        const data = await response.json();

        if (response.ok) {
            if (typeof showToast === 'function') {
                showToast('Đăng ký thành công! Đang chuyển hướng...');
            } else {
                alert('Đăng ký tài khoản thành công!');
            }
            setTimeout(() => window.location.href = '/login', 1500);
        } else {
            if (typeof showToast === 'function') {
                showToast(data.error || 'Đăng ký thất bại!'); 
            } else {
                alert(data.error || 'Có lỗi xảy ra khi đăng ký.');
            }
        }
    } catch (error) {
        console.error('Đăng ký lỗi:', error);
        if (typeof showToast === 'function') {
            showToast('Không thể kết nối đến máy chủ!');
        } else {
            alert('Không thể kết nối đến máy chủ.');
        }
    }
}