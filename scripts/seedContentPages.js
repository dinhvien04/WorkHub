"use strict";

require("dotenv").config();
const mongoose = require("mongoose");

const PAGES = [
  {
    Slug: "huong-dan-chon-phong-hop",
    Title: "Hướng dẫn chọn phòng họp phù hợp",
    Body: "Chọn phòng theo số người, thiết bị (máy chiếu, bảng trắng), và thời lượng. WorkHub hiển thị sức chứa và giá theo giờ/nửa ngày/ngày.",
    Status: "published",
  },
  {
    Slug: "to-chuc-workshop-coworking",
    Title: "Tổ chức workshop tại co-working",
    Body: "Chuẩn bị agenda, đặt chỗ trước, add-on catering. Dùng booking group và recurring cho series workshop.",
    Status: "published",
  },
  {
    Slug: "bang-gia-thue-van-phong",
    Title: "Bảng giá thuê và gói membership",
    Body: "So sánh giá theo giờ, ngày, tuần, tháng và gói membership có credit giờ. Luôn xác nhận quote server-side trước khi thanh toán.",
    Status: "published",
  },
  {
    Slug: "remote-work-viet-nam",
    Title: "Remote work tại Việt Nam",
    Body: "Không gian yên tĩnh, wifi ổn định, gần metro. Lọc search theo amenities và khoảng cách.",
    Status: "published",
  },
  {
    Slug: "local-guide-quan-cafe-lam-viec",
    Title: "Local guide: làm việc linh hoạt",
    Body: "Kết hợp co-working và cafe làm việc theo khu vực — xem trang city listing của WorkHub.",
    Status: "published",
  },
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const CmsPage = require("../models/CmsPage");
  for (const page of PAGES) {
    await CmsPage.findOneAndUpdate(
      { Slug: page.Slug },
      { $set: page },
      { upsert: true, new: true },
    );
    console.log("upsert", page.Slug);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
