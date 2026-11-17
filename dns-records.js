// Display provider recommendations only; DNS is edited at the domain's DNS host.
export function dnsHost(name, zone) {
  const host = String(name || "").replace(/\.$/, "");
  const suffix = String(zone || "").replace(/\.$/, "");
  if (suffix && host.toLowerCase() === suffix.toLowerCase()) return "@";
  return suffix && host.toLowerCase().endsWith("." + suffix.toLowerCase())
    ? host.slice(0, -suffix.length - 1)
    : host;
}
function node(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
export function renderDnsRecords(
  records,
  { zone, empty = "Record DNS belum tersedia." } = {},
) {
  const table = node("table", undefined, "dns-record-table");
  table.append(node("caption", "Salin record ke pengelola DNS domain Anda."));
  const header = node("tr");
  for (const title of [
    "Host Name",
    "Tipe",
    "Nilai / Address",
    "Prioritas",
    "TTL",
    "Status",
  ]) {
    const th = node("th", title);
    th.scope = "col";
    header.append(th);
  }
  const head = node("thead");
  head.append(header);
  table.append(head);
  const body = node("tbody");
  table.append(body);
  if (!records.length) {
    const row = node("tr"),
      cell = node("td", empty, "dns-empty");
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
  }
  for (const record of records) {
    const row = node("tr", undefined, "dns-record-row");
    const host = dnsHost(record.name, zone);
    for (const [label, text, cls, copyLabel] of [
      ["Host Name", host, "dns-host-cell", "Salin Nama"],
      ["Tipe", record.type || "—", "dns-type-cell"],
      ["Nilai / Address", record.value, "dns-value-cell", "Salin Nilai"],
      ["Prioritas", record.priority, "dns-priority-cell"],
      ["TTL", record.ttl || "Auto", "dns-ttl-cell"],
      ["Status", record.status, "dns-status-cell"],
    ]) {
      const cell = node("td", undefined, cls);
      cell.dataset.label = label;
      if (copyLabel) {
        const field = node("div", undefined, "dns-copy-field");
        const value = node("textarea");
        value.readOnly = true;
        value.rows = 1;
        value.wrap = "off";
        value.textContent = text == null || text === "" ? "—" : String(text);
        value.setAttribute(
          "aria-label",
          label + " " + (record.type || "") + " " + host,
        );
        value.spellcheck = false;
        field.append(value);
        const copy = node("button", undefined, "dns-copy-button");
        copy.type = "button";
        copy.disabled = text == null || text === "";
        copy.setAttribute("aria-label", copyLabel);
        copy.title = copyLabel;
        copy.append(node("i", undefined, "fa-regular fa-copy"));
        copy.firstChild.setAttribute("aria-hidden", "true");
        copy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(String(text));
            copy.title = "Disalin";
            copy.firstChild.className = "fa-solid fa-check";
          } catch {
            value.focus();
            value.select();
            copy.title = "Pilih dan salin secara manual";
          }
        };
        field.append(copy);
        cell.append(field);
      } else if (cls === "dns-status-cell") {
        const labels = {
          verified: "Siap",
          pending: "Menunggu",
          not_started: "Menunggu",
          temporary_failure: "Coba lagi",
          failure: "Gagal",
          failed: "Gagal",
        };
        const badge = node(
          "span",
          labels[text] || "Belum diperiksa",
          "dns-status",
        );
        badge.dataset.state = text || "unknown";
        cell.append(badge);
      } else {
        cell.append(
          node(
            cls === "dns-type-cell" ? "strong" : "span",
            text == null || text === "" ? "—" : String(text),
          ),
        );
        if (cls === "dns-type-cell" && record.purpose)
          cell.append(node("small", record.purpose));
      }
      row.append(cell);
    }
    body.append(row);
  }
  return table;
}
