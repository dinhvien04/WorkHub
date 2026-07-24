"use strict";

/**
 * Optional ClamAV clamd INSTREAM over TCP.
 * Env: CLAMAV_HOST, CLAMAV_PORT (default 3310)
 * If unavailable, returns { ok: true, skipped: true }.
 */
const net = require("net");
const logger = require("../utils/logger");
const { ValidationError } = require("../utils/errors");

function clamavEnabled() {
  return Boolean(process.env.CLAMAV_HOST);
}

function scanWithClamd(buffer, { timeoutMs = 8000 } = {}) {
  const host = process.env.CLAMAV_HOST;
  const port = Number(process.env.CLAMAV_PORT) || 3310;
  if (!host || !buffer?.length) {
    return Promise.resolve({ ok: true, skipped: true });
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port }, () => {
      // zINSTREAM\0 + chunks
      socket.write(Buffer.from("zINSTREAM\0"));
      const chunkSize = 2048;
      for (let i = 0; i < buffer.length; i += chunkSize) {
        const slice = buffer.subarray(
          i,
          Math.min(i + chunkSize, buffer.length),
        );
        const size = Buffer.alloc(4);
        size.writeUInt32BE(slice.length, 0);
        socket.write(size);
        socket.write(slice);
      }
      const end = Buffer.alloc(4);
      end.writeUInt32BE(0, 0);
      socket.write(end);
    });

    let data = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("ClamAV timeout"));
    }, timeoutMs);

    socket.on("data", (d) => {
      data += d.toString("utf8");
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on("end", () => {
      clearTimeout(timer);
      const reply = data.trim();
      if (/OK$/i.test(reply) || /: OK/i.test(reply)) {
        resolve({ ok: true, reply });
        return;
      }
      if (/FOUND/i.test(reply)) {
        const err = new ValidationError(`Phát hiện malware: ${reply}`);
        err.code = "MALWARE_DETECTED";
        reject(err);
        return;
      }
      resolve({ ok: true, reply, skipped: !reply });
    });
  });
}

async function scanBufferOptional(buffer) {
  if (!clamavEnabled()) return { ok: true, skipped: true };
  try {
    return await scanWithClamd(buffer);
  } catch (err) {
    if (err.statusCode === 400 || err.code === "MALWARE_DETECTED") throw err;
    logger.warn(`ClamAV unavailable: ${err.message}`);
    return { ok: true, skipped: true, error: err.message };
  }
}

module.exports = { clamavEnabled, scanWithClamd, scanBufferOptional };
