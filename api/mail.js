import { requireAccount } from "../lib/auth.js";
import { fail, db, platformHost } from "../lib/db.js";
import { normalizeDomain } from "../lib/domains.js";
import {
  mailConfigured,
  mailError,
  mailDb,
  provider,
  ownedRow,
  refreshMailDomain,
  emailAddress,
  identifier,
  plainMessage,
  contentHash,
  inspectProviderMailbox,
} from "../lib/mail.js";
async function protectSharedDomain(domain, user) {
  const current = (
    await db("app_settings?key=eq.custom_domain&select=value&limit=1")
  )?.[0]?.value;
  const history = await db(
    `shared_domains?domain=eq.${encodeURIComponent(domain)}&select=domain&limit=1`,
  );
  if (
    !user.isOperator &&
    (platformHost(domain) || domain === current || history?.length)
  )
    throw mailError(
      "Domain bersama AutoShort hanya dapat digunakan untuk email oleh pemilik platform.",
      403,
    );
}
async function allProviderDomains() {
  const rows = [];
  let after = "";
  for (let n = 0; n < 50; n++) {
    const page = await provider(
      "/domains?limit=100" +
        (after ? "&after=" + encodeURIComponent(after) : ""),
    );
    rows.push(...(page.data || []));
    if (!page.has_more) return rows;
    after = page.data?.at(-1)?.id;
    if (!after) break;
  }
  throw mailError("Daftar domain email terlalu besar. Hubungi pengelola.", 503);
}
const pickRow = (result) => (Array.isArray(result) ? result[0] : result);
export function createMailHandler({ refreshDomain = refreshMailDomain } = {}) {
  return async function handler(req, res) {
    const user = await requireAccount(req, res, { allowLegacy: false });
    if (!user) return;
    const send = (status, body) =>
      res.status(status).json({ userId: user.id, ...body });
    try {
      if (!["GET", "POST"].includes(req.method))
        return send(405, { error: "Method not allowed" });
      const input = req.method === "GET" ? req.query || {} : req.body || {};
      const action = input.action || "overview";
      if (!mailConfigured()) {
        if (req.method === "GET" && action === "overview")
          return send(200, {
            configured: false,
            domains: [],
            mailboxes: [],
            message: user.isOperator
              ? "Tambahkan RESEND_API_KEY pada Secret server dan jalankan migrasi email untuk mengaktifkan layanan."
              : "Pengelola belum mengaktifkan layanan email. Tautan dan domain shortlink tetap dapat dipakai.",
          });
        return send(503, {
          error: "Layanan email belum diaktifkan pengelola.",
        });
      }
      if (req.method === "GET" && action === "overview") {
        const scope = "user_id=eq." + encodeURIComponent(user.id);
        const [domains, mailboxes] = await Promise.all([
          mailDb(
            "email_domains?" +
              scope +
              "&select=id,domain,sending_ready,receiving_ready&order=created_at.asc",
          ),
          mailDb(
            "email_mailboxes?" +
              scope +
              "&select=id,address,display_name,provider_id&order=created_at.asc",
          ),
        ]);
        return send(200, {
          configured: true,
          domains,
          mailboxes: mailboxes.map(({ provider_id, ...row }) => ({
            ...row,
            ready: Boolean(provider_id),
          })),
        });
      }
      if (req.method === "POST" && action === "domain-add") {
        const name = normalizeDomain(input.domain);
        await protectSharedDomain(name, user);
        let row = (
          await mailDb(
            `email_domains?domain=eq.${encodeURIComponent(name)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`,
          )
        )?.[0];
        if (!row?.provider_id) {
          if (
            (await allProviderDomains()).some(
              (d) => d.name.toLowerCase() === name,
            )
          )
            throw mailError(
              "Domain sudah ada di layanan email. Pengelola perlu memeriksa kepemilikan sebelum migrasi; inbox existing tidak diambil alih otomatis.",
              409,
            );
          row = pickRow(
            await mailDb("rpc/reserve_email_domain", {
              method: "POST",
              body: JSON.stringify({ p_user: user.id, p_domain: name }),
            }),
          );
          const created = await provider("/domains", {
            method: "POST",
            body: {
              name,
              region: "us-east-1",
              capabilities: { sending: "enabled", receiving: "enabled" },
              open_tracking: false,
              click_tracking: false,
            },
          });
          if (!created.id)
            throw mailError(
              "Layanan belum mengembalikan ID domain. Hubungi pengelola.",
              502,
            );
          await mailDb(`email_domains?id=eq.${row.id}&user_id=eq.${user.id}`, {
            method: "PATCH",
            body: JSON.stringify({ provider_id: created.id }),
          });
          row.provider_id = created.id;
        }
        return send(200, { domain: await refreshDomain(row) });
      }
      if (req.method === "POST" && action === "domain-remove") {
        const row = await ownedRow("email_domains", input.id, user);
        if (
          (
            await mailDb(
              `email_mailboxes?domain_id=eq.${row.id}&user_id=eq.${user.id}&select=id&limit=1`,
            )
          )?.length
        )
          throw mailError(
            "Domain sudah memiliki alamat email dan tidak dapat dibatalkan.",
            409,
          );
        if (row.provider_id) {
          const current = await refreshDomain(row);
          if (current.sendingReady || current.receivingReady)
            throw mailError(
              "Domain aktif perlu ditangani pengelola agar email tidak terputus.",
              409,
            );
          await provider("/domains/" + identifier(row.provider_id), {
            method: "DELETE",
          });
        }
        await mailDb(`email_domains?id=eq.${row.id}&user_id=eq.${user.id}`, {
          method: "DELETE",
        });
        return send(200, { success: true });
      }
      if (["domain-details", "domain-check"].includes(action)) {
        if (action === "domain-check" && req.method !== "POST")
          return send(405, { error: "Gunakan POST untuk verifikasi domain." });
        const row = await ownedRow("email_domains", input.id, user);
        return send(200, {
          domain: await refreshDomain(row, {
            verify: action === "domain-check",
          }),
        });
      }
      if (req.method === "POST" && action === "mailbox-create") {
        const domain = await ownedRow("email_domains", input.domain_id, user);
        const checked = await refreshDomain(domain);
        if (!checked.sendingReady || !checked.receivingReady)
          throw mailError(
            "Verifikasi DNS untuk kirim dan terima sebelum membuat alamat email.",
            422,
          );
        const local = String(input.local_part || "")
          .trim()
          .toLowerCase();
        if (
          !/^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test(local) ||
          local.includes("..")
        )
          throw mailError(
            "Nama alamat harus 1–64 huruf/angka, titik, strip, atau garis bawah.",
          );
        const address = emailAddress(local + "@" + domain.domain);
        const display = String(input.display_name || "")
          .replace(/[\r\n\0]/g, "")
          .trim()
          .slice(0, 100);
        let box = pickRow(
          await mailDb("rpc/reserve_email_mailbox", {
            method: "POST",
            body: JSON.stringify({
              p_user: user.id,
              p_domain: domain.id,
              p_address: address,
              p_name: display,
            }),
          }),
        );
        if (!box.provider_id) {
          let existing = null;
          try {
            existing = await provider(
              "/inboxes/" + encodeURIComponent(address),
            );
          } catch (error) {
            if (error.status !== 404) throw error;
          }
          const marker = "AutoShort " + box.id;
          if (
            existing &&
            (existing.name !== marker || existing.email_address !== address)
          )
            throw mailError(
              "Alamat ini sudah ada di layanan email. Inbox existing tidak diambil alih otomatis.",
              409,
            );
          const result =
            existing ||
            (await provider("/inboxes", {
              method: "POST",
              body: {
                email_address: address,
                name: marker,
                from_name: display || undefined,
                forwarding: false,
              },
            }));
          if (!result.id)
            throw mailError("Layanan belum mengembalikan ID inbox.", 502);
          await mailDb(
            `email_mailboxes?id=eq.${box.id}&user_id=eq.${user.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({ provider_id: result.id }),
            },
          );
          box.provider_id = result.id;
        }
        await inspectProviderMailbox(box);
        return send(201, {
          mailbox: {
            id: box.id,
            address: box.address,
            display_name: box.display_name,
            ready: true,
          },
        });
      }
      const box = await ownedRow("email_mailboxes", input.mailbox_id, user);
      if (!box.provider_id)
        throw mailError(
          "Pembuatan inbox belum selesai. Coba buat alamat yang sama kembali.",
          409,
        );
      const base = "/inboxes/" + identifier(box.provider_id);
      if (req.method === "GET" && action === "mailbox-check") {
        const inbox = await inspectProviderMailbox(box);
        const domain = await ownedRow("email_domains", box.domain_id, user);
        const status = await refreshDomain(domain);
        return send(200, {
          mailbox: {
            id: box.id,
            address: box.address,
            active: status.sendingReady && status.receivingReady,
            sendingReady: status.sendingReady,
            receivingReady: status.receivingReady,
            lastReceived: inbox.last_received || null,
          },
        });
      }

      if (req.method === "GET" && action === "threads") {
        const folder = ["inbox", "sent", "archive", "spam", "trash"].includes(
          input.folder,
        )
          ? input.folder
          : "inbox";
        const cursor = input.after ? "&after=" + identifier(input.after) : "";
        const data = await provider(
          `${base}/threads?limit=30&folders=${folder}${cursor}`,
        );
        return send(200, {
          threads: (data.data || []).map((t) => ({
            id: t.id,
            subject: t.subject || "(Tanpa subjek)",
            from: t.from,
            to: t.to || [],
            read: t.read,
            received_at: t.received_at,
            folder: t.folder,
          })),
          hasMore: Boolean(data.has_more),
          next: data.has_more ? data.data?.at(-1)?.id : null,
        });
      }
      if (req.method === "GET" && action === "thread") {
        const data = await provider(
          `${base}/threads/${identifier(input.thread_id)}/emails?limit=10${input.after ? "&after=" + identifier(input.after) : ""}`,
        );
        return send(200, {
          messages: (data.data || []).map(plainMessage),
          hasMore: Boolean(data.has_more),
          next: data.has_more ? data.data?.at(-1)?.id : null,
        });
      }
      if (req.method === "POST" && action === "thread-update") {
        const payload = {};
        if (typeof input.read === "boolean") payload.read = input.read;
        if (["inbox", "archive", "spam", "trash"].includes(input.folder))
          payload.folder = input.folder;
        if (!Object.keys(payload).length)
          throw mailError("Perubahan pesan tidak valid.");
        await provider(`${base}/threads/${identifier(input.thread_id)}`, {
          method: "PATCH",
          body: payload,
        });
        return send(200, { success: true });
      }
      if (req.method === "POST" && action === "send") {
        if (
          typeof input.request_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            input.request_id,
          )
        )
          throw mailError("ID permintaan kirim tidak valid.");
        const to = (
          Array.isArray(input.to) ? input.to : String(input.to || "").split(",")
        ).map((x) => emailAddress(String(x).trim()));
        if (!to.length || to.length > 5)
          throw mailError("Masukkan 1–5 penerima.");
        const subject = String(input.subject || "").trim();
        const text = String(input.text || "");
        if (
          !subject ||
          subject.length > 200 ||
          /[\r\n\0]/.test(subject) ||
          !text.trim() ||
          text.length > 100000
        )
          throw mailError(
            "Isi subjek maksimal 200 karakter dan pesan maksimal 100.000 karakter.",
          );
        const content = { to, subject, text };
        if (input.thread_id) {
          content.thread_id = decodeURIComponent(identifier(input.thread_id));
          content.reply_to_email_id = decodeURIComponent(
            identifier(input.reply_to_email_id),
          );
          await provider(`${base}/threads/${identifier(input.thread_id)}`);
        }
        const reservation = pickRow(
          await mailDb("rpc/reserve_email_send", {
            method: "POST",
            body: JSON.stringify({
              p_user: user.id,
              p_mailbox: box.id,
              p_request: input.request_id,
              p_hash: contentHash(content),
            }),
          }),
        );
        if (reservation.state === "accepted")
          return send(200, { accepted: true });
        const domain = await ownedRow("email_domains", box.domain_id, user);
        const status = await refreshDomain(domain);
        if (!status.sendingReady)
          throw mailError("DNS pengiriman domain belum terverifikasi.", 422);
        await inspectProviderMailbox(box);
        const draft = await provider(base + "/drafts", {
          method: "POST",
          body: content,
          key: "draft/" + input.request_id,
        });
        const sent = await provider(
          `${base}/drafts/${identifier(draft.id)}/send`,
          { method: "POST", key: "send/" + input.request_id },
        );
        await mailDb(
          `email_send_requests?id=eq.${input.request_id}&user_id=eq.${user.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              state: "accepted",
              provider_message_id: sent.id,
            }),
          },
        );
        return send(200, { accepted: true });
      }
      return send(400, { error: "Tindakan email tidak valid." });
    } catch (error) {
      return fail(res, error);
    }
  };
}
export default createMailHandler();
