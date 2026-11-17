import { createHash } from "node:crypto";
import { resolveCname } from "node:dns/promises";
import { db } from "./db.js";
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY);
export const mailError = (message, status = 400) =>
  Object.assign(new Error(message), { status });
export function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw mailError("ID email tidak valid.");
  return encodeURIComponent(value);
}
export function emailAddress(value) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[-a-zA-Z0-9.!#$%&'*+/=?^_`{|}~]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$/.test(
      value,
    )
  )
    throw mailError("Alamat email tidak valid.");
  const at = value.lastIndexOf("@");
  return value.slice(0, at) + "@" + value.slice(at + 1).toLowerCase();
}
export async function mailDb(path, options = {}) {
  try {
    return await db(path, options);
  } catch (error) {
    const known = {
      request_expired:
        "Permintaan ini melewati batas retry aman. Hubungi pengelola untuk memeriksa status kirim sebelum mencoba lagi.",
      domain_limit: "Maksimal 3 domain email per akun.",
      mailbox_limit: "Maksimal 10 alamat email per akun.",
      send_limit: "Batas 100 permintaan kirim per 24 jam tercapai.",
      request_conflict:
        "Permintaan kirim sudah dipakai untuk pesan yang berbeda.",
      domain_not_ready: "Domain belum siap untuk kirim dan terima.",
      domain_unavailable: "Domain tidak tersedia untuk akun Anda.",
      mailbox_unavailable: "Alamat tidak tersedia untuk akun Anda.",
    };
    if (known[error.dbMessage])
      throw mailError(
        known[error.dbMessage],
        error.dbMessage === "send_limit" ? 429 : 409,
      );
    throw mailError(
      error.status === 409
        ? "Domain atau alamat email sudah dipakai."
        : "Penyimpanan email belum siap atau batas akun tercapai. Pengelola perlu memeriksa migrasi email.",
      error.status === 409 ? 409 : 503,
    );
  }
}
export async function provider(path, { method = "GET", body, key } = {}) {
  if (!mailConfigured())
    throw mailError("Layanan email belum diaktifkan pengelola.", 503);
  let response;
  try {
    response = await fetch("https://api.resend.com" + path, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw mailError(
      "Layanan email tidak dapat dihubungi. Coba lagi dengan permintaan yang sama.",
      502,
    );
  }
  let raw = "";
  let size = 0;
  const reader = response.body?.getReader(),
    decoder = new TextDecoder();
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4 * 1024 * 1024) {
        await reader.cancel();
        throw mailError(
          "Respons email terlalu besar untuk ditampilkan. Hubungi pengelola.",
          502,
        );
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  }
  let data;
  try {
    data = JSON.parse(raw || "{}");
  } catch {
    throw mailError("Layanan email memberikan respons yang tidak valid.", 502);
  }
  if (!response.ok) {
    const message =
      response.status === 429
        ? "Batas layanan email tercapai. Coba lagi nanti."
        : response.status === 409
          ? "Alamat atau domain sudah tersedia di layanan email. Hubungi pengelola."
          : response.status === 404
            ? "Inbox atau pesan tidak ditemukan. Pastikan layanan Resend Inboxes tersedia pada akun pengelola."
            : response.status === 401 || response.status === 403
              ? "Layanan inbox belum memiliki akses yang diperlukan. Pengelola perlu memeriksa API key dan akses Resend Inboxes."
              : response.status === 422
                ? "Permintaan email ditolak. Periksa alamat, isi pesan, dan verifikasi domain."
                : "Operasi layanan email gagal. Coba lagi.";
    throw mailError(
      message,
      [404, 409, 422, 429].includes(response.status) ? response.status : 502,
    );
  }
  return data;
}
export async function ownedRow(table, id, user) {
  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw mailError("ID email tidak valid.");
  const rows = await mailDb(
    `${table}?id=eq.${identifier(id)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
  );
  if (!rows?.length)
    throw mailError("Email tidak ditemukan di akun Anda.", 404);
  return rows[0];
}
export async function refreshMailDomain(
  row,
  { verify = false, lookup = resolveCname } = {},
) {
  if (!row.provider_id)
    throw mailError(
      "Domain belum selesai didaftarkan. Coba Tambahkan Domain kembali.",
      409,
    );
  if (verify)
    await provider(`/domains/${identifier(row.provider_id)}/verify`, {
      method: "POST",
    });
  const data = await provider(`/domains/${identifier(row.provider_id)}`);
  if (data.name?.toLowerCase() !== row.domain)
    throw mailError(
      "Pemetaan domain email tidak sesuai. Hubungi pengelola.",
      502,
    );
  const records = (data.records || []).map((r) => ({
    type: r.type,
    name: r.name,
    value: r.value,
    priority: r.priority,
    ttl: r.ttl,
    status: r.status,
    purpose: r.record,
  }));
  const sending = records.filter((r) => ["SPF", "DKIM"].includes(r.purpose));
  const receiving = records.filter((r) => r.purpose === "Receiving");
  const sendingReady =
    sending.length > 0 &&
    sending.every((r) => r.status === "verified") &&
    data.capabilities?.sending === "enabled";
  let cnameConflict = false;
  try {
    cnameConflict = (await lookup(row.domain)).length > 0;
  } catch {}
  const receivingReady =
    !cnameConflict &&
    receiving.length > 0 &&
    receiving.every((r) => r.status === "verified") &&
    data.capabilities?.receiving === "enabled";
  await mailDb(`email_domains?id=eq.${row.id}&user_id=eq.${row.user_id}`, {
    method: "PATCH",
    body: JSON.stringify({
      sending_ready: sendingReady,
      receiving_ready: receivingReady,
    }),
  });
  return {
    id: row.id,
    domain: row.domain,
    sendingReady,
    receivingReady,
    records,
    cnameConflict,
  };
}
export function plainMessage(message) {
  const fallback = String(message.html || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return {
    id: message.id,
    direction: message.direction,
    from: String(message.from || "").slice(0, 512),
    to: (message.to || []).slice(0, 50).map((v) => String(v).slice(0, 512)),
    replyTo: (message.reply_to || [])
      .slice(0, 50)
      .map((v) => String(v).slice(0, 512)),
    subject: String(message.subject || "").slice(0, 200),
    text: String(message.text || fallback).slice(0, 50000),
    truncated: String(message.text || fallback).length > 50000,
    receivedAt: message.received_at,
    attachments: (message.attachments || [])
      .slice(0, 50)
      .map((a) => ({
        filename: String(a.filename || "Lampiran").slice(0, 200),
        size: a.size,
      })),
  };
}
export const contentHash = (content) =>
  createHash("sha256").update(JSON.stringify(content)).digest("hex");
