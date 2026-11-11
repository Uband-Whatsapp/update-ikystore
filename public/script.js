
const $ = id => document.getElementById(id);

const repositories = {
  orderiky: {
    name: "ORDERIKY",
    repo: "orderikystore"
  },
  apkprem: {
    name: "APKPREM",
    repo: "apkpremiky"
  },
  botwhatsapp: {
    name: "BOTWHATSAPP",
    repo: "ikystoreproduk"
  }
};

let selectedRepo = "orderiky";
let busy = false;
let toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });

  let data = {};

  try {
    data = await response.json();
  } catch {}

  if (response.status === 401 && path !== "/api/login") {
    showLogin();
  }

  if (!response.ok) {
    throw new Error(data.error || "Terjadi kesalahan server.");
  }

  return data;
}

function notify(message, type = "success") {
  const toast = $("toast");

  toast.textContent = message;
  toast.className = "toast " + type;

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.className = "toast hidden";
  }, 4000);
}

function showLogin() {
  $("dashboard").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  $("password").value = "";
}

function showDashboard() {
  $("loginScreen").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
}

async function login(event) {
  event.preventDefault();

  if (busy) return;

  const password = $("password").value;

  if (!password) return;

  busy = true;
  $("loginButton").disabled = true;
  $("loginButton").textContent = "MEMERIKSA...";

  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });

    $("password").value = "";
    $("loginError").textContent = "";

    showDashboard();

    notify("Login berhasil.");

    await loadFile();
    await loadHistory();

  } catch (error) {
    $("loginError").textContent = error.message;
    notify(error.message, "error");

  } finally {
    busy = false;
    $("loginButton").disabled = false;
    $("loginButton").textContent = "Masuk Dashboard";
  }
}

$("loginForm").addEventListener("submit", login);

async function logout() {
  try {
    await api("/api/logout", {
      method: "POST",
      body: "{}"
    });
  } catch {}

  showLogin();
  notify("Berhasil logout.");
}

$("logoutButton").addEventListener("click", logout);

async function checkSession() {
  try {
    await api("/api/me");
    showDashboard();
    await loadFile();
    await loadHistory();
  } catch {
    showLogin();
  }
}

function selectRepository(key) {
  if (!repositories[key] || busy) return;

  selectedRepo = key;

  document.querySelectorAll(".repository").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.repo === key
    );
  });

  $("selectedName").textContent = repositories[key].name;

  $("selectedRepo").textContent =
    "Uband-Whatsapp/" + repositories[key].repo;

  $("previewContainer").classList.add("hidden");

  loadFile();
}

document.querySelectorAll(".repository").forEach(button => {
  button.addEventListener("click", () => {
    selectRepository(button.dataset.repo);
  });
});

async function loadFile() {
  $("codeEditor").disabled = true;
  $("codeEditor").value = "Memuat index.html dari GitHub...";

  try {
    const data = await api(
      "/api/file?repo=" + encodeURIComponent(selectedRepo)
    );

    $("codeEditor").value = data.content || "";

    notify("File " + repositories[selectedRepo].name + " berhasil dimuat.");

  } catch (error) {
    $("codeEditor").value = "";
    notify(error.message, "error");

  } finally {
    $("codeEditor").disabled = false;
  }
}

$("reloadButton").addEventListener("click", () => {
  if (!busy) loadFile();
});

$("previewButton").addEventListener("click", () => {
  $("previewFrame").srcdoc = $("codeEditor").value;

  $("previewContainer").classList.remove("hidden");

  $("previewContainer").scrollIntoView({
    behavior: "smooth",
    block: "nearest"
  });
});

$("closePreview").addEventListener("click", () => {
  $("previewContainer").classList.add("hidden");
  $("previewFrame").srcdoc = "";
});

$("updateButton").addEventListener("click", () => {
  if (busy) return;

  const code = $("codeEditor").value;

  if (!code.trim()) {
    notify("Kode HTML tidak boleh kosong.", "error");
    return;
  }

  const repo = repositories[selectedRepo];

  $("confirmDescription").textContent =
    "Anda akan mengganti index.html pada " +
    repo.name + " (Uband-Whatsapp/" + repo.repo +
    "), branch main. Perubahan akan langsung di-commit.";

  $("confirmModal").classList.remove("hidden");
});

$("cancelUpdate").addEventListener("click", () => {
  $("confirmModal").classList.add("hidden");
});

async function updateFile() {
  if (busy) return;

  const code = $("codeEditor").value;
  const message = $("commitMessage").value.trim();

  if (!code.trim()) {
    notify("Kode HTML kosong.", "error");
    return;
  }

  if (new TextEncoder().encode(code).length > 900000) {
    notify("Kode melebihi batas 900 KB.", "error");
    return;
  }

  busy = true;

  $("confirmModal").classList.add("hidden");
  $("updateButton").disabled = true;
  $("updateButton").textContent = "MENGUPDATE...";

  try {
    const result = await api("/api/update", {
      method: "POST",
      body: JSON.stringify({
        repo: selectedRepo,
        code,
        message: message || "Update index.html via Index Manager"
      })
    });

    notify("Berhasil memperbarui " + repositories[selectedRepo].name);

    if (result.commitUrl) {
      window.open(result.commitUrl, "_blank", "noopener,noreferrer");
    }

    await loadHistory();

  } catch (error) {
    notify("Update gagal: " + error.message, "error");
    await loadHistory();

  } finally {
    busy = false;
    $("updateButton").disabled = false;
    $("updateButton").textContent = "Update index.html →";
  }
}

$("confirmUpdate").addEventListener("click", updateFile);

function formatDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("id-ID");
}

async function loadHistory() {
  const list = $("historyList");

  list.textContent = "Memuat riwayat...";

  try {
    const data = await api("/api/history");

    const items = data.items || [];

    $("totalUpdates").textContent = items.filter(
      item => item.status === "success"
    ).length;

    list.textContent = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Belum ada riwayat pembaruan.";
      list.appendChild(empty);
      return;
    }

    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "history-item";

      const details = document.createElement("div");

      const name = document.createElement("strong");
      name.textContent = item.name || item.repo;

      const date = document.createElement("p");
      date.textContent = formatDate(item.date);

      const message = document.createElement("p");
      message.textContent = item.message || "Update index.html";

      details.append(name, date, message);

      if (item.commitUrl) {
        const link = document.createElement("a");
        link.href = item.commitUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Lihat commit GitHub";
        details.appendChild(link);
      }

      const status = document.createElement("span");
      status.className =
        "history-status " +
        (item.status === "success" ? "" : "failed");

      status.textContent =
        item.status === "success" ? "BERHASIL" : "GAGAL";

      row.append(details, status);
      list.appendChild(row);
    });

  } catch (error) {
    list.textContent = "Gagal memuat riwayat: " + error.message;
  }
}

$("refreshHistory").addEventListener("click", loadHistory);

checkSession();
