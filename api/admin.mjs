import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const owner = process.env.GITHUB_OWNER || "HaxtonKuo";
const repo = process.env.GITHUB_REPO || "framefield-notes";
const branch = process.env.GITHUB_BRANCH || "main";
const postsPath = "src/content/posts";

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function escapePath(value) {
  const filename = String(value || "");
  if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Invalid post filename.");
  }
  return filename;
}

function slugify(value) {
  return (
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || `post-${Date.now()}`
  );
}

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ""));
}

function estimateReadingTime(body) {
  const compact = String(body || "").replace(/\s+/g, "");
  return `${Math.max(1, Math.ceil(compact.length / 600))} 分鐘閱讀`;
}

function parseCategories(value) {
  return String(value || "")
    .split(/[,，]/)
    .map((category) => category.trim())
    .filter(Boolean);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data = {};

  for (const line of match[1].split(/\r?\n/)) {
    const divider = line.indexOf(":");
    if (divider === -1) continue;

    const key = line.slice(0, divider).trim();
    const raw = line.slice(divider + 1).trim();

    try {
      if (raw === "true") data[key] = true;
      else if (raw === "false") data[key] = false;
      else if (raw.startsWith("[") || raw.startsWith("\"")) data[key] = JSON.parse(raw);
      else data[key] = raw;
    } catch {
      data[key] = raw;
    }
  }

  return { data, body: match[2].trimEnd() };
}

function buildPost(fields, existing = {}) {
  const title = fields.title || "未命名文章";
  const body = fields.body || "";
  const categories = parseCategories(fields.categories);
  const frontmatter = [
    "---",
    `title: ${quoteYaml(title)}`,
    `description: ${quoteYaml(fields.description || "")}`,
    `pubDate: ${fields.pubDate || new Date().toISOString().slice(0, 10)}`,
    `author: ${quoteYaml(fields.author || "郭豪")}`,
    `authorInitials: ${quoteYaml(fields.authorInitials || "KH")}`,
    `readingTime: ${quoteYaml(fields.readingTime || estimateReadingTime(body))}`,
    `categories: [${categories.map(quoteYaml).join(", ")}]`,
    fields.cover || existing.cover ? `cover: ${quoteYaml(fields.cover || existing.cover)}` : "",
    fields.coverAlt || existing.coverAlt ? `coverAlt: ${quoteYaml(fields.coverAlt || existing.coverAlt)}` : "",
    fields.sourceUrl || existing.sourceUrl ? `sourceUrl: ${quoteYaml(fields.sourceUrl || existing.sourceUrl)}` : "",
    `featured: ${fields.featured === true ? "true" : "false"}`,
    "---",
    "",
  ].filter(Boolean);

  return `${frontmatter.join("\n")}${body.trim()}\n`;
}

function getSecret() {
  return process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
}

function sign(value) {
  return createHmac("sha256", getSecret()).update(value).digest("base64url");
}

function sessionCookie() {
  const value = JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  const payload = Buffer.from(value).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function isValidSession(request) {
  const cookie = request.headers.cookie || "";
  const token = cookie.match(/(?:^|;\s*)framefield_admin=([^;]+)/)?.[1];
  if (!token || !getSecret()) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expected = sign(payload);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return false;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(session.exp) > Date.now();
  } catch {
    return false;
  }
}

function assertConfig() {
  if (!process.env.ADMIN_PASSWORD) throw new Error("Missing ADMIN_PASSWORD.");
  if (!process.env.GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN.");
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 240)}`);
  }

  return response.json();
}

function decodeContent(item) {
  return Buffer.from(String(item.content || "").replace(/\n/g, ""), "base64").toString("utf8");
}

async function listPosts() {
  const files = await github(postsPath, { method: "GET" });
  const posts = await Promise.all(
    files
      .filter((file) => file.name.endsWith(".md"))
      .map(async (file) => {
        const item = await github(`${postsPath}/${file.name}`, { method: "GET" });
        const { data } = parseFrontmatter(decodeContent(item));
        return {
          filename: file.name,
          title: data.title || file.name,
          pubDate: data.pubDate || "",
          author: data.author || "",
          featured: data.featured === true,
        };
      }),
  );

  return posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
}

async function getPost(filename) {
  const item = await github(`${postsPath}/${escapePath(filename)}`, { method: "GET" });
  const parsed = parseFrontmatter(decodeContent(item));
  return { filename: item.name, sha: item.sha, ...parsed };
}

async function savePost(payload) {
  const existingFilename = payload.filename ? escapePath(payload.filename) : "";
  let filename = existingFilename || `${slugify(payload.title)}-${createHash("sha1").update(String(Date.now())).digest("hex").slice(0, 8)}.md`;
  let existing = {};
  let sha = "";

  if (existingFilename) {
    const current = await getPost(existingFilename);
    existing = current.data;
    sha = current.sha;
  }

  const content = buildPost(payload, existing);
  const body = {
    message: existingFilename ? `Update post: ${filename}` : `Create post: ${filename}`,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch,
    ...(sha ? { sha } : {}),
  };

  await github(`${postsPath}/${filename}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  return filename;
}

async function deletePost(filename) {
  const current = await getPost(filename);
  await github(`${postsPath}/${current.filename}`, {
    method: "DELETE",
    body: JSON.stringify({
      message: `Delete post: ${current.filename}`,
      sha: current.sha,
      branch,
    }),
  });

  return current.filename;
}

export default async function handler(request, response) {
  try {
    assertConfig();

    const url = new URL(request.url, `https://${request.headers.host || "framefield-notes.vercel.app"}`);
    const action = url.searchParams.get("action") || "session";

    if (request.method === "POST" && action === "login") {
      const body = await readJson(request);
      if (body.password !== process.env.ADMIN_PASSWORD) {
        json(response, 401, { ok: false, error: "密碼不正確" });
        return;
      }

      json(response, 200, { ok: true }, {
        "set-cookie": `framefield_admin=${sessionCookie()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
      });
      return;
    }

    if (!isValidSession(request)) {
      json(response, 401, { ok: false, error: "尚未登入" });
      return;
    }

    if (request.method === "POST" && action === "logout") {
      json(response, 200, { ok: true }, {
        "set-cookie": "framefield_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      });
      return;
    }

    if (request.method === "GET" && action === "session") {
      json(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && action === "list") {
      json(response, 200, { ok: true, posts: await listPosts() });
      return;
    }

    if (request.method === "GET" && action === "post") {
      const post = await getPost(url.searchParams.get("file") || "");
      json(response, 200, { ok: true, post });
      return;
    }

    if (request.method === "POST" && action === "save") {
      const filename = await savePost(await readJson(request));
      json(response, 200, { ok: true, filename });
      return;
    }

    if (request.method === "POST" && action === "delete") {
      const body = await readJson(request);
      const filename = await deletePost(body.filename || "");
      json(response, 200, { ok: true, filename });
      return;
    }

    json(response, 404, { ok: false, error: "Unknown action." });
  } catch (error) {
    json(response, 500, { ok: false, error: String(error.message || error) });
  }
}
