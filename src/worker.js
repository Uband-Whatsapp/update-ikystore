
const OWNER = "Uband-Whatsapp";
const BRANCH = "main";
const FILE_PATH = "index.html";
const MAX_SIZE = 900000;
const SESSION_SECONDS = 43200;

const REPOSITORIES = {
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

const encoder = new TextEncoder();

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra
    }
  });
}

function secret(env, upper, lower) {
  return env[upper] || env[lower] || "";
}

function equal(a, b) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);

  if (x.length !== y.length) return false;

  let result = 0;

  for (let i = 0; i < x.length; i++) {
    result |= x[i] ^ y[i];
  }

  return result === 0;
}

function base64url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sign(secretValue, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretValue),
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  return base64url(new Uint8Array(signature));
}

async function makeSession(password) {
  const expires =
    Math.floor(Date.now() / 1000) + SESSION_SECONDS;

  const nonce = base64url(
    crypto.getRandomValues(new Uint8Array(20))
  );

  const payload = expires + "." + nonce;
  const signature = await sign(password, payload);

  return payload + "." + signature;
}

function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";

  for (const part of cookies.split(";")) {
    const index = part.indexOf("=");

    if (index < 0) continue;

    if (part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }

  return "";
}

async function checkSession(request, password) {
  const value = getCookie(
    request,
    "index_manager_session"
  );

  const parts = value.split(".");

  if (parts.length !== 3) return false;

  const expires = Number(parts[0]);

  if (
    !Number.isFinite(expires) ||
    expires < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const payload = parts[0] + "." + parts[1];
  const expected = await sign(password, payload);

  return equal(parts[2], expected);
}

function sessionCookie(value, age) {
  return {
    "Set-Cookie":
      "index_manager_session=" + value +
      "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=" + age
  };
}

async function sha(value) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(value)
  );

  return Array.from(new Uint8Array(result))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getRepo(key) {
  if (!Object.prototype.hasOwnProperty.call(REPOSITORIES, key)) {
    return null;
  }

  return REPOSITORIES[key];
}

function getToken(env) {
  return secret(env, "GITHUB_TOKEN", "github_token");
}

function getPassword(env) {
  return secret(env, "PASSWORD", "password");
}

async function github(env, endpoint, options = {}) {
  const token = getToken(env);

  if (!token) {
    throw new Error("Secret GITHUB_TOKEN belum dipasang.");
  }

  return fetch("https://api.github.com" + endpoint, {
    method: options.method || "GET",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "GitHub-Index-Manager",
      ...(options.body ? {
        "Content-Type": "application/json"
      } : {})
    },
    body: options.body
      ? JSON.stringify(options.body)
      : undefined
  });
}

function decodeContent(value) {
  const binary = atob(value.replace(/\s/g, ""));

  const bytes = Uint8Array.from(
    binary,
    char => char.charCodeAt(0)
  );

  return new TextDecoder().decode(bytes);
}

function encodeContent(value) {
  const bytes = encoder.encode(value);
  let binary = "";

  const chunk = 8192;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, i + chunk)
    );
  }

  return btoa(binary);
}

async function readFile(env, repo) {
  const endpoint =
    "/repos/" + OWNER + "/" + repo +
    "/contents/" + FILE_PATH +
    "?ref=" + BRANCH;

  const response = await github(env, endpoint);

  if (response.status === 404) {
    throw new Error(
      "index.html tidak ditemukan pada repository."
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || "Gagal membaca file GitHub."
    );
  }

  if (data.type !== "file" || !data.sha) {
    throw new Error("Target bukan file biasa.");
  }

  return {
    sha: data.sha,
    content: data.content
      ? decodeContent(data.content)
      : ""
  };
}

async function history(env, item) {
  if (!env.HISTORY_KV) {
    throw new Error("Binding HISTORY_KV belum dipasang.");
  }

  const key = "update-history-v1";

  let items = [];

  const saved = await env.HISTORY_KV.get(key);

  if (saved) {
    try {
      items = JSON.parse(saved);
    } catch {
      items = [];
    }
  }

  items.unshift(item);

  await env.HISTORY_KV.put(
    key,
    JSON.stringify(items.slice(0, 100))
  );
}

async function routeAPI(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  const password = getPassword(env);

  if (!password) {
    return json({
      error: "Secret PASSWORD belum dipasang."
    }, 503);
  }

  if (!env.HISTORY_KV) {
    return json({
      error: "Binding HISTORY_KV belum dipasang."
    }, 503);
  }

  if (
    method !== "GET" &&
    request.headers.get("Origin") !== url.origin
  ) {
    return json({
      error: "Origin tidak diizinkan."
    }, 403);
  }

  // LOGIN

  if (path === "/api/login" && method === "POST") {
    const ip =
      request.headers.get("CF-Connecting-IP") || "unknown";

    const key = "login:" + await sha(ip);

    let attempts = {
      count: 0,
      start: Date.now()
    };

    const saved = await env.HISTORY_KV.get(key);

    if (saved) {
      try {
        attempts = JSON.parse(saved);
      } catch {}
    }

    if (Date.now() - attempts.start > 900000) {
      attempts = {
        count: 0,
        start: Date.now()
      };
    }

    if (attempts.count >= 5) {
      return json({
        error: "Terlalu banyak percobaan. Tunggu 15 menit."
      }, 429);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        error: "Format permintaan tidak valid."
      }, 400);
    }

    if (!equal(String(body.password || ""), password)) {
      attempts.count++;

      await env.HISTORY_KV.put(
        key,
        JSON.stringify(attempts),
        { expirationTtl: 900 }
      );

      return json({
        error: "Password salah."
      }, 401);
    }

    await env.HISTORY_KV.delete(key);

    const session = await makeSession(password);

    return json(
      { success: true },
      200,
      sessionCookie(session, SESSION_SECONDS)
    );
  }

  // LOGOUT

  if (path === "/api/logout" && method === "POST") {
    return json(
      { success: true },
      200,
      sessionCookie("", 0)
    );
  }

  // AUTHENTICATION

  if (!(await checkSession(request, password))) {
    return json({
      error: "Sesi berakhir. Silakan login kembali."
    }, 401);
  }

  if (path === "/api/me" && method === "GET") {
    return json({ authenticated: true });
  }

  // LIST REPOSITORIES

  if (path === "/api/repos" && method === "GET") {
    return json({
      repositories: Object.entries(REPOSITORIES).map(
        ([key, value]) => ({
          key,
          name: value.name,
          repo: value.repo
        })
      )
    });
  }

  // READ INDEX.HTML

  if (path === "/api/file" && method === "GET") {
    const selected = getRepo(
      url.searchParams.get("repo")
    );

    if (!selected) {
      return json({
        error: "Repository tidak diizinkan."
      }, 403);
    }

    try {
      const file = await readFile(env, selected.repo);

      return json({
        name: selected.name,
        branch: BRANCH,
        file: FILE_PATH,
        content: file.content
      });

    } catch (error) {
      return json({ error: error.message }, 502);
    }
  }

  // HISTORY

  if (path === "/api/history" && method === "GET") {
    const saved = await env.HISTORY_KV.get(
      "update-history-v1"
    );

    let items = [];

    if (saved) {
      try {
        items = JSON.parse(saved);
      } catch {}
    }

    return json({ items });
  }

  // UPDATE INDEX.HTML

  if (path === "/api/update" && method === "POST") {
    let body;

    try {
      body = await request.json();
    } catch {
      return json({
        error: "Data update tidak valid."
      }, 400);
    }

    const selected = getRepo(body.repo);

    if (!selected) {
      return json({
        error: "Repository tidak diizinkan."
      }, 403);
    }

    if (
      typeof body.code !== "string" ||
      !body.code.trim()
    ) {
      return json({
        error: "Kode HTML tidak boleh kosong."
      }, 400);
    }

    const bytes = encoder.encode(body.code);

    if (bytes.length > MAX_SIZE) {
      return json({
        error: "Ukuran kode maksimal 900 KB."
      }, 413);
    }

    const message = String(
      body.message || "Update index.html via Index Manager"
    ).replace(/[\r\n]/g, " ").slice(0, 100);

    const record = {
      name: selected.name,
      repo: selected.repo,
      date: new Date().toISOString(),
      message,
      status: "failed",
      commitUrl: null
    };

    try {
      // Selalu mengambil SHA terbaru sebelum update.
      const current = await readFile(env, selected.repo);

      // Endpoint hanya untuk index.html pada branch main.
      const endpoint =
        "/repos/" + OWNER + "/" + selected.repo +
        "/contents/" + FILE_PATH;

      const response = await github(env, endpoint, {
        method: "PUT",
        body: {
          message,
          content: encodeContent(body.code),
          sha: current.sha,
          branch: BRANCH
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          (result.message || "GitHub menolak update.") +
          " (HTTP " + response.status + ")"
        );
      }

      record.status = "success";
      record.commitUrl =
        result.commit?.html_url || null;

      try {
        await history(env, record);
      } catch (error) {
        console.error("History save error:", error);
      }

      return json({
        success: true,
        commitUrl: record.commitUrl
      });

    } catch (error) {
      record.error = String(error.message).slice(0, 180);

      try {
        await history(env, record);
      } catch (historyError) {
        console.error("History error:", historyError);
      }

      return json({
        error: record.error
      }, 502);
    }
  }

  return json({
    error: "API endpoint tidak ditemukan."
  }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const securityHeaders = {
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self'; " +
        "connect-src 'self'; " +
        "frame-src 'self' data:; " +
        "object-src 'none'; " +
        "base-uri 'none'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'"
    };

    try {
      let response;

      if (url.pathname.startsWith("/api/")) {
        response = await routeAPI(request, env, url);
      } else {
        if (request.method !== "GET" && request.method !== "HEAD") {
          response = new Response("Method Not Allowed", {
            status: 405
          });
        } else {
          response = await env.ASSETS.fetch(request);
        }
      }

      const headers = new Headers(response.headers);

      for (const [key, value] of Object.entries(securityHeaders)) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        headers
      });

    } catch (error) {
      console.error(error);

      return json({
        error: "Terjadi kesalahan internal Worker."
      }, 500, securityHeaders);
    }
  }
};
