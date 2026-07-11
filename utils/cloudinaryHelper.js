"use strict";

/**
 * Extract Cloudinary public_id from a full delivery URL.
 * Example: .../upload/v123/coworking/branchs/file.jpg -> coworking/branchs/file
 */
function extractPublicId(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") return null;
  const matches = imageUrl.match(
    /\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/,
  );
  if (!matches || !matches[1]) return null;
  // strip transformation segments if present
  let id = matches[1];
  if (id.includes("/")) {
    // keep path as public_id (folder/file)
  }
  return id.replace(/\.[a-zA-Z0-9]+$/, "");
}

function imageInResource(images, imageUrl) {
  if (!Array.isArray(images) || !imageUrl) return false;
  return images.some((img) => {
    if (typeof img === "string") return img === imageUrl;
    if (img && typeof img === "object")
      return img.url === imageUrl || img.publicId === imageUrl;
    return false;
  });
}

module.exports = { extractPublicId, imageInResource };
