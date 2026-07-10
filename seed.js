require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { connectDB } = require('./config/db');

const User = require('./models/User');
const CustomerProfile = require('./models/customer_Profile');
const HostProfile = require('./models/host_Profile');
const Branch = require('./models/Branch');
const Space = require('./models/Space');
const Booking = require('./models/Booking');
const PaymentHistory = require('./models/Payment_History');
const Review = require('./models/Review');

async function seed() {
  await connectDB();


  // 2) XÓA DỮ LIỆU CŨ
  await mongoose.connection.dropDatabase();

  // 3) USERS: 5 users (3 customer, 1 host, 1 admin)
  const rawPassword = '123456';
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  const users = [
    { Email: 'customer1@example.com', PasswordHash: passwordHash,FullName: 'Nguyễn Văn A', Role: 'customer', Status: 'active' },
    { Email: 'customer2@example.com', PasswordHash: passwordHash, FullName: 'Trần Thị B', Role: 'customer', Status: 'active' },
    { Email: 'customer3@example.com', PasswordHash: passwordHash, FullName: 'Lê Văn C', Role: 'customer', Status: 'active' },
    { Email: 'host1@example.com', PasswordHash: passwordHash, FullName: 'Trần Thị Mạnh', Role: 'host', Status: 'active' },
    { Email: 'admin@example.com', PasswordHash: passwordHash, FullName: 'Administrator', Role: 'admin', Status: 'active' },
  ];

  const createdUsers = await User.insertMany(users);
  const customers = createdUsers.filter(u => u.Role === 'customer');
  const host = createdUsers.find(u => u.Role === 'host');
  const admin = createdUsers.find(u => u.Role === 'admin');

  // 3) PROFILES
  const customerProfiles = await CustomerProfile.insertMany([
    {
      UserID: customers[0]._id,
      Avatar: '',
      Phone: '0900000001',
      BankName: 'Vietcombank',
      BankNumber: '1111111111', 
    },
    {
      UserID: customers[1]._id,
      Avatar: '',
      Phone: '0900000002',
      BankName: 'TPBank',
      BankNumber: '2222222222',
    },
    {
      UserID: customers[2]._id,
      Avatar: '',
      Phone: '0900000003',
      BankName: 'ACB',
      BankNumber: '3333333333',
    },
  ]);

  const hostProfile = await HostProfile.create({
    UserID: host._id,
    CompanyName: 'Coworking Host Co., Ltd',
    Logo: '',
    Hotline: '0911111111',
    TaxCode: 'TAXCODE-HOST-0001',
    VerificationDocument: '',
    IsVerified: false,
    BankName: 'BIDV',
    BankNumber: '4444444444',
  });

  // 4) BRANCHES: 2 branches thuộc Host vừa tạo
  const branches = await Branch.insertMany([
    {
      HostID: host._id,
      Name: 'Chi nhánh Trung Tâm',
      Address: '12 Nguyễn Trãi',
      District: 'Quận 5',
      City: 'TP.HCM',
      Description: 'Khu vực trung tâm, thuận tiện đi lại',
      Images: [],
      OpeningTime: '08:00',
      ClosingTime: '17:30',
      DepositPercentage: 0.3,
      RatingAvg: 4.2,
      Status: 'active',
    },
    {
      HostID: host._id,
      Name: 'Chi nhánh Khu Công Nghệ',
      Address: '88 Lê Lợi',
      District: 'Quận 1',
      City: 'TP.HCM',
      Description: 'Gần các khu văn phòng',
      Images: [],
      OpeningTime: '09:00',
      ClosingTime: '18:00',
      DepositPercentage: 0.25,
      RatingAvg: 4.5,
      Status: 'active',
    },
  ]);

  // 5) SPACES: ~5 spaces chia đều cho 2 chi nhánh (Branch 1: 3, Branch 2: 2)
  const branch1 = branches[0];
  const branch2 = branches[1];

  const spacesPayload = [
    // Branch 1 (3)
    {
      BranchID: branch1._id,
      HostID: host._id,
      SpaceCode: 'B1-01',
      Name: 'Phòng họp 10 người',
      Category: 'meeting_room',
      Description: 'Có TV, bảng trắng',
      Capacity: 10,
      Amenities: ['Wifi', 'Máy chiếu', 'Bảng trắng'],
      Images: [],
      PricePerHour: 150000,
      DepositAmount: 300000,
      Status: 'available',
      RatingAvg: 4.6,
      RatingCount: 12,
    },
    {
      BranchID: branch1._id,
      HostID: host._id,
      SpaceCode: 'B1-02',
      Name: 'Bàn làm việc yên tĩnh',
      Category: 'desk',
      Description: 'Chỗ ngồi yên tĩnh, đủ ánh sáng',
      Capacity: 1,
      Amenities: ['Wifi', 'Ổ cắm'],
      Images: [],
      PricePerHour: 50000,
      DepositAmount: 100000,
      Status: 'available',
      RatingAvg: 4.4,
      RatingCount: 20,
    },
    {
      BranchID: branch1._id,
      HostID: host._id,
      SpaceCode: 'B1-03',
      Name: 'Phòng văn phòng nhóm 4',
      Category: 'desk',
      Description: 'Dành cho team nhỏ',
      Capacity: 4,
      Amenities: ['Wifi', 'Điều hòa'],
      Images: [],
      PricePerHour: 120000,
      DepositAmount: 240000,
      Status: 'available',
      RatingAvg: 4.3,
      RatingCount: 8,
    },

    // Branch 2 (2)
    {
      BranchID: branch2._id,
      HostID: host._id,
      SpaceCode: 'B2-01',
      Name: 'Phòng họp 6 người',
      Category: 'meeting_room',
      Description: 'Tối ưu cho meeting ngắn',
      Capacity: 6,
      Amenities: ['Wifi', 'Màn chiếu'],
      Images: [],
      PricePerHour: 100000,
      DepositAmount: 200000,
      Status: 'available',
      RatingAvg: 4.7,
      RatingCount: 5,
    },
    {
      BranchID: branch2._id,
      HostID: host._id,
      SpaceCode: 'B2-02',
      Name: 'Không gian sự kiện nhỏ',
      Category: 'meeting_room',
      Description: 'Tổ chức workshop hoặc event nhỏ',
      Capacity: 20,
      Amenities: ['Wifi', 'Âm thanh'],
      Images: [],
      PricePerHour: 220000,
      DepositAmount: 440000,
      Status: 'available',
      RatingAvg: 4.1,
      RatingCount: 9,
    },
  ];

  const spaces = await Space.insertMany(spacesPayload);

  // 6) BOOKINGS: tạo 10 lượt đặt phòng (gắn đúng CustomerID, SpaceID, HostID)
  // StartTime/EndTime phải là Date hợp lệ
  const baseDate = new Date('2026-01-15T00:00:00.000Z');

  function addHours(date, hours) {
    const d = new Date(date);
    d.setUTCHours(d.getUTCHours() + hours);
    return d;
  }

  const bookingsPayload = [];
  const bookingStatuses = ['confirmed', 'completed', 'confirmed', 'pending', 'completed'];

  for (let i = 0; i < 10; i++) {
    const customer = customers[i % customers.length];
    const space = spaces[i % spaces.length];

    // mỗi booking trải từ 9h - 17h, tránh end <= start
    const startHour = 9 + (i % 5); // 9..13
    const endHour = startHour + 2; // +2 giờ

    const startTime = addHours(baseDate, startHour + i); // dịch nhẹ theo i
    const endTime = addHours(baseDate, endHour + i);

    const total = space.PricePerHour * 2; // 2 giờ
    const deposit = Math.round(total * (space.DepositAmount > 0 ? 0.5 : 0.5));

    bookingsPayload.push({
      CustomerID: customer._id,
      SpaceID: space._id,
      HostID: host._id,
      StartTime: startTime,
      EndTime: endTime,
      TotalAmount: total,
      DepositAmount: deposit,
      Status: bookingStatuses[i % bookingStatuses.length],
      Note: `Booking mock #${i + 1}`,
    });
  }

  const bookings = await Booking.insertMany(bookingsPayload);

  // 7) PAYMENTS: tạo 10 giao dịch tương ứng 10 Bookings
  const paymentPayload = bookings.map((b, idx) => {
    const bookingIndex = idx + 1;
    const amount = b.TotalAmount;

    return {
      BookingID: b._id,
      CustomerID: b.CustomerID,
      HostID: b.HostID,
      TransactionCode: `TXN-MOCK-${String(bookingIndex).padStart(3, '0')}`,
      Amount: amount,
      PaymentType: 'full_payment',
      PaymentMethod: idx % 3 === 0 ? 'e_wallet' : idx % 3 === 1 ? 'bank_transfer' : 'cash',
      Status: 'successful',
      PaidAt: b.EndTime,
    };
  });

  await PaymentHistory.insertMany(paymentPayload);

  // 8) REVIEWS: tạo khoảng 8 đánh giá (đủ CustomerID, SpaceID, BookingID theo booking)
  const reviewCount = 8;
  const reviewPayload = [];

  for (let i = 0; i < reviewCount; i++) {
    const booking = bookings[i]; 
    const rating = 3 + (i % 3); 

    reviewPayload.push({
      CustomerID: booking.CustomerID, // Chữ C viết hoa
      SpaceID: booking.SpaceID,       // Chữ S viết hoa
      BookingID: booking._id,         // BỔ SUNG TRƯỜNG NÀY VÀO (Chữ B viết hoa)
      Rating: rating,                 // Chữ R viết hoa
      Comment: `Đánh giá mock #${i + 1}` // Chữ C viết hoa
      // Lưu ý: Không cần tự tạo createdAt vì Schema đã có { timestamps: true }
    });
  }

  await Review.insertMany(reviewPayload);

  // 9) LOG số lượng bản ghi từng collection
  const [
    usersCount,
    customerProfilesCount,
    hostProfilesCount,
    branchesCount,
    spacesCount,
    bookingsCount,
    paymentsCount,
    reviewsCount,
  ] = await Promise.all([
    User.countDocuments(),
    CustomerProfile.countDocuments(),
    HostProfile.countDocuments(),
    Branch.countDocuments(),
    Space.countDocuments(),
    Booking.countDocuments(),
    PaymentHistory.countDocuments(),
    Review.countDocuments(),
  ]);

  console.log('Seed completed. Counts:');
  console.log({ users: usersCount });
  console.log({ customer_profiles: customerProfilesCount });
  console.log({ host_profiles: hostProfilesCount });
  console.log({ branches: branchesCount });
  console.log({ spaces: spacesCount });
  console.log({ bookings: bookingsCount });
  console.log({ payment_histories: paymentsCount });
  console.log({ reviews: reviewsCount });

  process.exit(0);
}

seed().catch(async (err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
