import { renderDnsRecords } from "./dns-records.js";
// Email content stays in memory and is cleared on every account change.
export function createMailUI({ api, getSession, notify }) {
  const el = (id) => document.getElementById(id);
  let generation = 0,
    busy = false,
    configured = false,
    domains = [],
    boxes = [],
    messages = [],
    thread = null,
    requestId = null,
    reply = null,
    next = null,
    messageNext = null,
    canSend = false,
    receiveReady = false;
  function node(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function controls() {
    const enabled = configured && Boolean(getSession().user) && !busy;
    el("mailAddDomain").disabled = !enabled;
    el("mailRefreshDomains").disabled = busy;
    el("mailLocalPart").disabled = !enabled;
    el("mailDomainSearch").disabled = !enabled;
    el("mailDomainOptions")
      .querySelectorAll("input")
      .forEach((radio) => {
        radio.disabled = !enabled;
      });
    el("mailCreateBox").disabled = !enabled || !el("mailCreateDomain").value;
    el("mailCompose").disabled =
      !enabled || !el("mailboxSelect").value || !canSend;
    el("mailSend").disabled =
      !enabled || !el("mailboxSelect").value || !canSend;
    el("mailboxSelect").disabled = !enabled;
    el("mailFolder").disabled = !enabled;
    el("mailLoadMore").disabled = !enabled;
    if (el("mailDomainSelect")) el("mailDomainSelect").disabled = !enabled;
  }
  async function call(query = {}, body) {
    const id = getSession().user?.id,
      g = generation;
    const data = await api(
      "/api/mail" + (body ? "" : "?" + new URLSearchParams(query)),
      body ? { method: "POST", body: JSON.stringify(body) } : {},
    );
    if (g !== generation || id !== getSession().user?.id || data.userId !== id)
      throw Object.assign(new Error("Sesi telah berubah."), { stale: true });
    return data;
  }
  function notice(text) {
    el("mailNotice").textContent = text;
    el("mailSetupNotice").textContent = text === "Inbox pribadi." ? "" : text;
  }
  async function run(work) {
    if (busy) return;
    const g = generation;
    busy = true;
    controls();
    if (configured) notice("Memproses…");
    try {
      await work();
      if (el("mailNotice").textContent === "Memproses…")
        notice("Inbox pribadi.");
    } catch (error) {
      if (!error.stale && g === generation) {
        notice(error.message);
        if (el("mailComposeDialog").open)
          el("mailComposeNotice").textContent = error.message;
      }
    } finally {
      if (g === generation) {
        busy = false;
        controls();
      }
    }
  }
  function reset() {
    generation++;
    busy = false;
    configured = false;
    domains = [];
    boxes = [];
    messages = [];
    thread = null;
    requestId = null;
    reply = null;
    next = null;
    messageNext = null;
    canSend = false;
    receiveReady = false;
    [
      "mailDomainList",
      "mailDns",
      "mailThreads",
      "mailMessage",
      "mailboxSelect",
      "mailDomainOptions",
    ].forEach((id) => el(id).replaceChildren());
    delete el("mailDns").dataset.domain;
    el("mailCreateDomain").value = "";
    el("mailDomainSearch").value = "";
    el("mailDomainPicker").open = false;
    el("mailSelectedDomain").textContent = "Pilih domain aktif";
    el("mailAddressPreview").textContent = "";
    el("mailReceiveStatus").textContent = "";
    el("mailDomainEmpty").hidden = false;
    el("mailDomainForm").reset();
    el("mailBoxForm").reset();
    el("mailComposeForm").reset();
    el("mailComposeDialog").close();
    el("mailLoadMore").hidden = true;
    emptyDns();
    notice(
      getSession().state === "loading"
        ? "Memuat sesi akun…"
        : getSession().state === "error"
          ? "Koneksi server gagal. Muat ulang halaman."
          : "Masuk untuk memakai inbox pribadi.",
    );
    controls();
  }
  async function overview() {
    const previous = el("mailboxSelect").value;
    const data = await call();
    configured = data.configured === true;
    domains = data.domains || [];
    boxes = data.mailboxes || [];
    notice(
      data.message ||
        (configured ? "Inbox pribadi." : "Layanan email belum diaktifkan."),
    );
    el("mailDomainList").replaceChildren();
    if (domains.length) {
      const label = node("label", "Pilih domain email");
      label.htmlFor = "mailDomainSelect";
      const select = node("select", undefined, "input-control");
      select.id = "mailDomainSelect";
      for (const d of domains) {
        const option = node("option", d.domain);
        option.value = d.id;
        select.append(option);
      }
      select.value = domains.some((d) => d.id === el("mailDns").dataset.domain)
        ? el("mailDns").dataset.domain
        : domains[0].id;
      select.onchange = () => run(() => showDns(select.value));
      el("mailDomainList").append(label, select);
    } else emptyDns();
    for (const box of boxes.filter((b) => !b.ready)) {
      el("mailDomainList").append(
        node(
          "p",
          "Pembuatan " +
            box.address +
            " belum selesai. Buat ulang alamat yang sama untuk mencoba lagi.",
        ),
      );
    }
    renderReadyDomains();
    el("mailboxSelect").replaceChildren(
      node(
        "option",
        boxes.some((b) => b.ready)
          ? "Pilih alamat email"
          : "Belum ada alamat aktif",
      ),
    );
    el("mailboxSelect").firstChild.value = "";
    for (const box of boxes.filter((b) => b.ready)) {
      const option = node("option", box.address);
      option.value = box.id;
      el("mailboxSelect").append(option);
    }
    el("mailboxSelect").value = boxes.some((b) => b.ready && b.id === previous)
      ? previous
      : boxes.find((b) => b.ready)?.id || "";
    controls();
  }
  function previewAddress() {
    const selected = domains.find((d) => d.id === el("mailCreateDomain").value);
    const local = el("mailLocalPart").value.trim().toLowerCase();
    el("mailAddressPreview").textContent =
      selected && local ? local + "@" + selected.domain : "";
  }
  function chooseDomain(id) {
    const selected = domains.find(
      (d) => d.id === id && d.sending_ready && d.receiving_ready,
    );
    el("mailCreateDomain").value = selected?.id || "";
    el("mailSelectedDomain").textContent = selected
      ? "@" + selected.domain
      : "Belum ada domain siap";
    for (const radio of el("mailDomainOptions").querySelectorAll(
      'input[type="radio"]',
    ))
      radio.checked = radio.value === selected?.id;
    previewAddress();
    controls();
  }
  function filterDomains() {
    const term = el("mailDomainSearch")
      .value.trim()
      .toLowerCase()
      .replace(/^@/, "");
    let visible = 0;
    for (const row of el("mailDomainOptions").children) {
      row.hidden = !row.dataset.domain.includes(term);
      if (!row.hidden) visible++;
    }
    el("mailDomainEmpty").hidden = visible > 0;
    el("mailDomainEmpty").textContent = domains.some(
      (d) => d.sending_ready && d.receiving_ready,
    )
      ? "Tidak ada domain yang cocok."
      : "Belum ada domain siap. Verifikasi DNS email terlebih dahulu.";
  }
  function renderReadyDomains() {
    const previous = el("mailCreateDomain").value;
    const ready = domains.filter((d) => d.sending_ready && d.receiving_ready);
    el("mailDomainOptions").replaceChildren();
    for (const domain of ready) {
      const row = node("label", undefined, "mail-domain-option");
      row.dataset.domain = domain.domain.toLowerCase();
      const radio = node("input");
      radio.type = "radio";
      radio.name = "mailReadyDomain";
      radio.value = domain.id;
      radio.onchange = () => {
        chooseDomain(domain.id);
        el("mailDomainPicker").open = false;
        el("mailDomainPicker").querySelector("summary").focus();
      };
      row.append(radio, node("span", "@" + domain.domain));
      el("mailDomainOptions").append(row);
    }
    chooseDomain(
      ready.some((d) => d.id === previous) ? previous : ready[0]?.id || "",
    );
    filterDomains();
  }
  async function checkMailbox() {
    const g = generation;
    canSend = false;
    receiveReady = false;
    controls();
    const id = el("mailboxSelect").value;
    if (!id) {
      el("mailReceiveStatus").textContent = "";
      return;
    }
    el("mailReceiveStatus").textContent = "Memeriksa kesiapan alamat email…";
    let data;
    try {
      data = await call({ action: "mailbox-check", mailbox_id: id });
    } catch (error) {
      if (!error.stale && g === generation)
        el("mailReceiveStatus").textContent =
          "Status penerimaan belum dapat dipastikan. Coba Segarkan.";
      throw error;
    }
    canSend = data.mailbox.sendingReady;
    receiveReady = data.mailbox.active;
    el("mailReceiveStatus").textContent = data.mailbox.active
      ? "Inbox dan MX terverifikasi. " +
        (data.mailbox.lastReceived
          ? "Terakhir menerima: " +
            new Date(data.mailbox.lastReceived).toLocaleString("id-ID")
          : "Belum ada email masuk yang tercatat.")
      : "Penerimaan belum siap. Periksa DNS email domain ini.";
    controls();
  }
  async function open() {
    const session = getSession();
    if (
      !el("mailDomainInput").value &&
      session.user &&
      (session.user.isOperator || session.domain !== session.shared)
    )
      el("mailDomainInput").value = session.domain || "";
    if (!getSession().cloud || !getSession().user) {
      reset();
      if (getSession().state === "ready" && !getSession().cloud)
        notice("Email tersedia dalam mode cloud.");
      return;
    }
    await run(async () => {
      await overview();
      if (el("mailboxSelect").value) {
        await checkMailbox();
        await loadThreads();
      }
    });
  }
  async function showDns(id, verify = false) {
    const result = await call(
      { action: "domain-details", id },
      verify ? { action: "domain-check", id } : undefined,
    );
    renderDns(result.domain);
    if (verify) await overview();
  }
  async function openDomains() {
    if (!getSession().cloud || !getSession().user) {
      reset();
      return;
    }
    await run(async () => {
      await overview();
      const selected = el("mailDns").dataset.domain;
      const domain = domains.find((d) => d.id === selected) || domains[0];
      if (configured && domain) await showDns(domain.id);
    });
  }
  function emptyDns() {
    el("mailDns").replaceChildren(
      renderDnsRecords([], {
        empty:
          getSession().state === "loading"
            ? "Memuat koneksi akun…"
            : getSession().state === "error"
              ? "Koneksi server gagal. Record DNS belum dapat dimuat."
              : !getSession().user
                ? "Masuk untuk memuat domain email Anda."
                : "Record DNS belum tersedia. Tambahkan domain setelah koneksi layanan email siap.",
      }),
    );
    el("mailDnsGuide").open = true;
  }
  function renderDns(d) {
    const root = el("mailDns");
    root.dataset.domain = d.id;
    el("mailDnsGuide").open = false;
    root.replaceChildren(node("h3", "DNS · " + d.domain));
    root.append(
      node(
        "p",
        (d.sendingReady ? "Kirim siap" : "Kirim menunggu DNS") +
          " · " +
          (d.receivingReady ? "Terima siap" : "Terima menunggu DNS"),
        "dns-summary",
      ),
    );
    if (d.mxReady === false)
      root.append(
        node(
          "p",
          "MX belum sesuai. Salin record penerimaan di bawah.",
          "dns-warning",
        ),
      );
    if (d.cnameConflict)
      root.append(
        node(
          "p",
          "CNAME bentrok dengan MX. Gunakan domain akar atau hostname email lain.",
          "dns-warning",
        ),
      );
    root.append(
      renderDnsRecords(
        (d.records || []).map((r) => ({
          ...r,
          purpose: r.purpose === "Receiving" ? "Terima" : r.purpose,
        })),
        { zone: d.domain },
      ),
    );
    const check = node("button", "Periksa DNS Email", "btn btn-outline btn-sm");
    check.type = "button";
    check.onclick = () => run(() => showDns(d.id, true));
    root.append(check);
    if (!d.sendingReady && !d.receivingReady) {
      const cancel = node(
        "button",
        "Batalkan Domain",
        "btn btn-outline btn-sm",
      );
      cancel.type = "button";
      cancel.onclick = () => {
        if (
          confirm(
            "Batalkan domain email yang belum aktif ini? Record DNS eksternal tidak diubah.",
          )
        )
          run(async () => {
            await call({}, { action: "domain-remove", id: d.id });
            el("mailDns").replaceChildren();
            delete el("mailDns").dataset.domain;
            await overview();
            if (domains[0]) await showDns(domains[0].id);
          });
      };
      root.append(cancel);
    }
  }
  async function loadThreads(append = false, preserveMessage = false) {
    const box = el("mailboxSelect").value;
    if (!box) {
      el("mailThreads").replaceChildren(
        node("p", "Buat alamat setelah DNS domain terverifikasi."),
      );
      return;
    }
    const data = await call({
      action: "threads",
      mailbox_id: box,
      folder: el("mailFolder").value,
      ...(append && next ? { after: next } : {}),
    });
    if (!append) {
      el("mailThreads").replaceChildren();
      if (!preserveMessage) {
        el("mailMessage").replaceChildren(
          node("p", "Pilih pesan untuk membacanya."),
        );
        thread = null;
        messages = [];
      }
    }
    if (
      receiveReady &&
      !append &&
      el("mailFolder").value === "inbox" &&
      data.threads?.length
    ) {
      const latest = Math.max(
        ...data.threads
          .map((t) => new Date(t.received_at).getTime())
          .filter(Number.isFinite),
      );
      if (Number.isFinite(latest))
        el("mailReceiveStatus").textContent =
          "Inbox dan MX terverifikasi. Pesan masuk terakhir: " +
          new Date(latest).toLocaleString("id-ID");
    }
    next = data.next;
    el("mailLoadMore").hidden = !data.hasMore;
    for (const t of data.threads || []) {
      const button = node(
        "button",
        undefined,
        "mail-thread" + (!t.read ? " is-unread" : ""),
      );
      button.type = "button";
      button.append(
        node("strong", t.subject),
        node("span", t.from || t.to.join(", ")),
        node("small", new Date(t.received_at).toLocaleString("id-ID")),
      );
      button.onclick = () =>
        run(async () => {
          await loadMessage(t);
          button.classList.remove("is-unread");
        });
      el("mailThreads").append(button);
    }
    if (!el("mailThreads").children.length)
      el("mailThreads").append(node("p", "Belum ada pesan di folder ini."));
  }
  async function loadMessage(t, append = false) {
    const data = await call({
      action: "thread",
      mailbox_id: el("mailboxSelect").value,
      thread_id: t.id,
      ...(append && messageNext ? { after: messageNext } : {}),
    });
    thread = t;
    messages = append ? [...messages, ...data.messages] : data.messages;
    messageNext = data.next;
    renderMessage();
    await call(
      {},
      {
        action: "thread-update",
        mailbox_id: el("mailboxSelect").value,
        thread_id: t.id,
        read: true,
      },
    );
  }
  function renderMessage() {
    const root = el("mailMessage");
    root.replaceChildren(node("h3", thread.subject));
    const actions = node("div", undefined, "domain-actions");
    for (const [label, folder] of [
      ["Arsipkan", "archive"],
      ["Ke Inbox", "inbox"],
      ["Ke Sampah", "trash"],
    ]) {
      const b = node("button", label, "btn btn-outline btn-sm");
      b.type = "button";
      b.onclick = () =>
        run(async () => {
          await call(
            {},
            {
              action: "thread-update",
              mailbox_id: el("mailboxSelect").value,
              thread_id: thread.id,
              folder,
            },
          );
          await loadThreads();
        });
      actions.append(b);
    }
    root.append(actions);
    for (const m of [...messages].sort(
      (a, b) => new Date(a.receivedAt) - new Date(b.receivedAt),
    )) {
      const article = node("article", undefined, "mail-message-body");
      article.append(
        node("strong", m.from),
        node("small", new Date(m.receivedAt).toLocaleString("id-ID")),
        node("pre", m.text || "(Pesan tanpa isi teks)"),
      );
      if (m.truncated)
        article.append(
          node("p", "Isi pesan dipersingkat karena ukurannya besar."),
        );
      if (m.attachments.length)
        article.append(
          node(
            "p",
            "Lampiran: " +
              m.attachments.map((a) => a.filename).join(", ") +
              ". Unduh lampiran belum tersedia pada versi ini.",
          ),
        );
      if (m.direction === "inbound") {
        const b = node("button", "Balas", "btn btn-outline btn-sm");
        b.type = "button";
        b.onclick = () => compose(m);
        article.append(b);
      }
      root.append(article);
    }
    if (messageNext) {
      const more = node(
        "button",
        "Muat pesan berikutnya",
        "btn btn-outline btn-sm",
      );
      more.onclick = () => run(() => loadMessage(thread, true));
      root.append(more);
    }
  }
  function compose(message) {
    el("mailComposeNotice").textContent = "";
    el("mailComposeForm").reset();
    requestId = null;
    reply = message
      ? { thread_id: thread.id, reply_to_email_id: message.id }
      : null;
    el("mailFrom").textContent =
      boxes.find((b) => b.id === el("mailboxSelect").value)?.address || "";
    if (message) {
      el("mailTo").value = (
        message.replyTo.length ? message.replyTo : [message.from]
      )
        .map((value) => value.match(/<([^<>\r\n]+)>/)?.[1] || value)
        .join(", ");
      el("mailSubject").value = /^re:/i.test(message.subject)
        ? message.subject
        : "Re: " + message.subject;
    }
    el("mailComposeDialog").showModal();
    el(message ? "mailBody" : "mailTo").focus();
  }
  el("mailRefresh").onclick = open;
  el("mailRefreshDomains").onclick = openDomains;
  el("mailboxSelect").onchange = () =>
    run(async () => {
      await checkMailbox();
      await loadThreads();
    });
  el("mailFolder").onchange = () => run(() => loadThreads());
  el("mailDomainSearch").oninput = filterDomains;
  el("mailDomainSearch").onkeydown = (event) => {
    if (event.key === "Enter") event.preventDefault();
    if (event.key === "Escape") {
      el("mailDomainPicker").open = false;
      el("mailDomainPicker").querySelector("summary").focus();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      [...el("mailDomainOptions").children]
        .find((row) => !row.hidden)
        ?.querySelector("input")
        .focus();
    }
  };
  el("mailLocalPart").oninput = previewAddress;
  el("mailLoadMore").onclick = () => run(() => loadThreads(true));
  el("mailCompose").onclick = () => compose();
  el("mailCancelCompose").onclick = () => el("mailComposeDialog").close();
  el("mailComposeDialog").addEventListener("close", () => {
    el("mailComposeForm").reset();
    reply = null;
    requestId = null;
  });
  el("mailComposeForm").addEventListener("input", () => {
    requestId = null;
  });
  el("mailDomainForm").onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await call(
        {},
        { action: "domain-add", domain: el("mailDomainInput").value },
      );
      renderDns(data.domain);
      await overview();
    });
  };
  el("mailBoxForm").onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      const created = await call(
        {},
        {
          action: "mailbox-create",
          domain_id: el("mailCreateDomain").value,
          local_part: el("mailLocalPart").value,
        },
      );
      el("mailBoxForm").reset();
      await overview();
      el("mailboxSelect").value = created.mailbox.id;
      await checkMailbox();
      await loadThreads();
      previewAddress();
      notify("Alamat email dibuat.", "success");
    });
  };
  el("mailComposeForm").onsubmit = (event) => {
    event.preventDefault();
    run(async () => {
      requestId ||= crypto.randomUUID();
      const result = await call(
        {},
        {
          action: "send",
          mailbox_id: el("mailboxSelect").value,
          request_id: requestId,
          to: el("mailTo").value,
          subject: el("mailSubject").value,
          text: el("mailBody").value,
          ...(reply || {}),
        },
      );
      if (result.accepted) {
        el("mailComposeDialog").close();
        notify("Pesan diterima layanan pengiriman.", "success");
        el("mailFolder").value = "sent";
        await loadThreads();
      }
    });
  };
  setInterval(() => {
    if (
      configured &&
      getSession().user &&
      !document.hidden &&
      !busy &&
      !el("mailComposeDialog").open &&
      el("viewMail").style.display !== "none" &&
      el("mailboxSelect").value
    )
      run(() => loadThreads(false, true));
  }, 15000);
  reset();
  return {
    open,
    openDomains,
    reset,
    leave: () => el("mailComposeDialog").close(),
  };
}
