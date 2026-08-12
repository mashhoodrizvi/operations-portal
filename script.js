const SHEET_ID = "1qy9zHFQgzfGZXiuDbw_kuMzmYiIHCGqY-hTnd3SnJ4A";
const CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;
const API_URL = "https://script.google.com/macros/s/AKfycbwKaguijjg5tQALRNkjAiaLzePHEWZRY-bEsFWpn-rSCHc4zW8kvVWJcBasZh0MXaQ/exec";

const columns = [
  "Date",
  "Actual Time",
  "Invoice Time",
  "Extra Time/Difference",
  "Required Return Amount",
  "Paid Amount",
  "Paid Date",
  "Balance"
];

let records = [];
let filtered = [];
let adminPassword =
  sessionStorage.getItem("returnsAdminPassword") || "";

const $ = selector => document.querySelector(selector);

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(value);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value !== "" || row.length) {
    row.push(value);
    if (row.some(cell => cell.trim() !== "")) rows.push(row);
  }

  return rows;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function numberValue(value) {
  return Number(String(value ?? "").replace(/[$,]/g, "")) || 0;
}

function paidInputValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "";
  }

  return String(numberValue(value));
}

function money(value, showPlus = false) {
  const number = numberValue(value);

  const formatted = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(Math.abs(number));

  if (number < 0) return `-${formatted}`;
  if (showPlus && number > 0) return `+${formatted}`;
  return formatted;
}

function parseDurationMinutes(value) {
  if (value === null || value === undefined || value === "") return 0;

  const text = String(value).trim();
  const parts = text.split(":");

  if (parts.length >= 2) {
    const hours = Number(parts[0]) || 0;
    const minutes = Number(parts[1]) || 0;
    const seconds = Number(parts[2]) || 0;
    return Math.round(hours * 60 + minutes + seconds / 60);
  }

  const numeric = Number(text);

  if (Number.isFinite(numeric)) {
    return numeric < 1
      ? Math.round(numeric * 24 * 60)
      : Math.round(numeric * 60);
  }

  return 0;
}

function formatMinutes(totalMinutes) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} hrs`;
  return `${hours} hrs ${minutes} min`;
}

function formatDuration(value) {
  if (!value) return "—";
  return formatMinutes(parseDurationMinutes(value));
}

function calculatedDifference(record) {
  const invoiceMinutes = parseDurationMinutes(record["Invoice Time"]);
  const actualMinutes = parseDurationMinutes(record["Actual Time"]);
  return formatMinutes(invoiceMinutes - actualMinutes);
}

function rowBalance(record) {
  if (record.Balance !== "") return numberValue(record.Balance);

  return (
    numberValue(record["Paid Amount"]) -
    numberValue(record["Required Return Amount"])
  );
}

function balanceClass(number) {
  return number < 0 ? "negative" : number > 0 ? "positive" : "zero";
}

function showMessage(text, type = "") {
  const box = $("#messageBox");
  box.hidden = false;
  box.className = `message ${type}`;
  box.textContent = text;
}

function hideMessage() {
  $("#messageBox").hidden = true;
}

function setMode() {
  const admin = Boolean(adminPassword);

  $("#publicView").hidden = admin;
  $("#adminView").hidden = !admin;
  $("#loginBtn").hidden = admin;
  $("#logoutBtn").hidden = !admin;

  $("#modeText").textContent = admin
    ? "Admin mode: update paid amounts and view full details."
    : "Login to update and view full details.";
}

function updateBalance() {
  const totalPaid = filtered.reduce(
    (sum, record) => sum + numberValue(record["Paid Amount"]),
    0
  );

  const totalReturn = filtered.reduce(
    (sum, record) => sum + numberValue(record["Required Return Amount"]),
    0
  );

  const balance = totalPaid - totalReturn;

  $("#overallBalance").textContent = money(balance, true);
  $("#balanceCard").className =
    `balance-card ${balanceClass(balance)}`;
}

function renderPublic() {
  $("#publicBody").innerHTML = filtered
    .map(record => `
      <tr>
        <td>${escapeHTML(record.Date || "—")}</td>
        <td class="money">${money(record["Required Return Amount"])}</td>
        <td class="money">
          ${record["Paid Amount"] !== ""
            ? money(record["Paid Amount"])
            : "—"}
        </td>
        <td>${escapeHTML(record["Paid Date"] || "—")}</td>
      </tr>
    `)
    .join("");

  $("#publicCards").innerHTML = filtered
    .map(record => `
      <article class="record-card">
        <div class="record-detail">
          <div class="detail-row">
            <span>Date</span>
            <span>${escapeHTML(record.Date || "—")}</span>
          </div>
          <div class="detail-row">
            <span>Required Return Amount</span>
            <span>${money(record["Required Return Amount"])}</span>
          </div>
          <div class="detail-row">
            <span>Paid Amount</span>
            <span>
              ${record["Paid Amount"] !== ""
                ? money(record["Paid Amount"])
                : "—"}
            </span>
          </div>
          <div class="detail-row">
            <span>Paid Date</span>
            <span>${escapeHTML(record["Paid Date"] || "—")}</span>
          </div>
        </div>
      </article>
    `)
    .join("");
}

function renderAdmin() {
  $("#adminBody").innerHTML = filtered
    .map(record => {
      const balance = rowBalance(record);

      return `
        <tr>
          <td>${escapeHTML(record.Date || "—")}</td>
          <td>${escapeHTML(formatDuration(record["Actual Time"]))}</td>
          <td>${escapeHTML(formatDuration(record["Invoice Time"]))}</td>
          <td>${escapeHTML(calculatedDifference(record))}</td>
          <td class="money">${money(record["Required Return Amount"])}</td>
          <td>
            <input
              class="payment-input"
              type="number"
              min="0"
              step="0.01"
              value="${escapeHTML(paidInputValue(record["Paid Amount"]))}"
              data-input="${record.__rowNumber}"
            >
          </td>
          <td>${escapeHTML(record["Paid Date"] || "—")}</td>
          <td>
            <span class="balance-pill ${balanceClass(balance)}">
              ${money(balance, true)}
            </span>
          </td>
          <td>
            <button
              class="save-btn"
              data-save="${record.__rowNumber}"
            >Save</button>
          </td>
        </tr>
      `;
    })
    .join("");

  $("#adminCards").innerHTML = filtered
    .map(record => {
      const balance = rowBalance(record);

      return `
        <article class="record-card">
          <div class="record-detail">
            <div class="detail-row">
              <span>Date</span>
              <span>${escapeHTML(record.Date || "—")}</span>
            </div>
            <div class="detail-row">
              <span>Actual Time</span>
              <span>${escapeHTML(formatDuration(record["Actual Time"]))}</span>
            </div>
            <div class="detail-row">
              <span>Invoice Time</span>
              <span>${escapeHTML(formatDuration(record["Invoice Time"]))}</span>
            </div>
            <div class="detail-row">
              <span>Difference</span>
              <span>${escapeHTML(calculatedDifference(record))}</span>
            </div>
            <div class="detail-row">
              <span>Required Return Amount</span>
              <span>${money(record["Required Return Amount"])}</span>
            </div>
            <div class="detail-row">
              <span>Paid Date</span>
              <span>${escapeHTML(record["Paid Date"] || "—")}</span>
            </div>
            <div class="detail-row">
              <span>Balance</span>
              <span class="balance-pill ${balanceClass(balance)}">
                ${money(balance, true)}
              </span>
            </div>

            <div class="mobile-pay">
              <input
                class="payment-input"
                type="number"
                min="0"
                step="0.01"
                value="${escapeHTML(paidInputValue(record["Paid Amount"]))}"
                data-input="${record.__rowNumber}"
              >
              <button
                class="save-btn"
                data-save="${record.__rowNumber}"
              >Save Payment</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  document
    .querySelectorAll("[data-save]")
    .forEach(button => {
      button.onclick = () =>
        savePayment(Number(button.dataset.save), button);
    });
}

function render() {
  renderPublic();
  renderAdmin();
  updateBalance();

  $("#recordCount").textContent =
    `Showing ${filtered.length} of ${records.length} ` +
    `record${records.length === 1 ? "" : "s"}`;
}

function applySearch() {
  const query = $("#searchInput").value.trim().toLowerCase();

  filtered = records.filter(record =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(query)
  );

  render();
}

async function loadSheet() {
  try {
    hideMessage();
    $("#recordCount").textContent = "Loading Google Sheet…";

    const response = await fetch(
      `${CSV_URL}&cache=${Date.now()}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error("Could not load Google Sheet.");
    }

    const rows = parseCSV(await response.text());

    if (!rows.length) {
      throw new Error("Google Sheet is empty.");
    }

    const headers = rows[0].map(header => header.trim());
    const missing = columns.filter(
      column => !headers.includes(column)
    );

    if (missing.length) {
      throw new Error(
        `Missing heading(s): ${missing.join(", ")}`
      );
    }

    records = rows
      .slice(1)
      .map((cells, index) => {
        const source = {};

        headers.forEach((header, cellIndex) => {
          source[header] =
            (cells[cellIndex] ?? "").trim();
        });

        const record = Object.fromEntries(
          columns.map(column => [
            column,
            source[column] ?? ""
          ])
        );

        record.__rowNumber = index + 2;
        return record;
      })
      .filter(record => record.Date !== "");

    filtered = [...records];
    render();
  } catch (error) {
    showMessage(error.message, "error");
    $("#recordCount").textContent = "Load failed";
  }
}

async function apiRequest(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload),
    redirect: "follow"
  });

  return response.json();
}

async function savePayment(rowNumber, button) {
  const container =
    button.closest("tr") ||
    button.closest(".record-card") ||
    document;

  const input = container.querySelector(
    `[data-input="${rowNumber}"]`
  );

  const paidAmount = Number(input.value);

  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    showMessage("Enter a valid paid amount.", "error");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Saving…";

  try {
    const result = await apiRequest({
      action: "savePayment",
      rowNumber,
      paidAmount,
      password: adminPassword
    });

    if (!result.success) {
      throw new Error(
        result.error || "Payment could not be saved."
      );
    }

    showMessage(
      "Payment saved. Paid Date was added automatically.",
      "success"
    );

    await new Promise(resolve => setTimeout(resolve, 700));
    await loadSheet();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

$("#loginBtn").onclick = () =>
  $("#loginDialog").showModal();

$("#closeLoginBtn").onclick = () =>
  $("#loginDialog").close();

$("#loginForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const password = $("#passwordInput").value.trim();
    if (!password) return;

    const submitButton = event.submitter;
    submitButton.disabled = true;
    submitButton.textContent = "Checking…";

    try {
      const result = await apiRequest({
        action: "login",
        password
      });

      if (!result.success) {
        throw new Error(result.error || "Login failed.");
      }

      adminPassword = password;
      sessionStorage.setItem(
        "returnsAdminPassword",
        password
      );

      $("#passwordInput").value = "";
      $("#loginDialog").close();

      setMode();
      render();

      showMessage(
        "Admin login successful.",
        "success"
      );
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Login";
    }
  }
);

$("#logoutBtn").onclick = () => {
  adminPassword = "";
  sessionStorage.removeItem("returnsAdminPassword");
  setMode();
  render();
};

$("#searchInput").addEventListener("input", applySearch);
$("#refreshBtn").onclick = loadSheet;

$("#themeBtn").onclick = event => {
  document.body.classList.toggle("dark");
  event.currentTarget.textContent =
    document.body.classList.contains("dark")
      ? "☀"
      : "☾";
};

setMode();
loadSheet();
