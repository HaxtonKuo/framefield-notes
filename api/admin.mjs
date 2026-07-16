import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const owner = process.env.GITHUB_OWNER || "HaxtonKuo";
const repo = process.env.GITHUB_REPO || "framefield-notes";
const branch = process.env.GITHUB_BRANCH || "main";
const postsPath = "src/content/posts";
const defaultModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

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

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function getMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }

  return "";
}

function getArticleText(html) {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] || "";
  const source = article || html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
  return stripTags(source).slice(0, 8000);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function titleFromUrl(url) {
  const { hostname, pathname } = new URL(url);
  const lastPath = pathname.split("/").filter(Boolean).pop();
  if (!lastPath) return hostname;

  return decodeURIComponent(lastPath)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJson(value) {
  const cleaned = String(value || "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response did not contain JSON.");
  return JSON.parse(cleaned.slice(start, end + 1));
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

function assertAiConfig() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY.");
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

async function existingSourceUrls() {
  const files = await github(postsPath, { method: "GET" });
  const sources = new Set();

  await Promise.all(
    files
      .filter((file) => file.name.endsWith(".md"))
      .map(async (file) => {
        const item = await github(`${postsPath}/${file.name}`, { method: "GET" });
        const { data } = parseFrontmatter(decodeContent(item));
        if (data.sourceUrl) sources.add(normalizeUrl(data.sourceUrl));
      }),
  );

  return sources;
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

async function fetchSource(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "kouhanBot/1.0 (+https://framefield-notes.vercel.app)",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  return {
    title: getMeta(html, "og:title") || stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") || new URL(url).hostname,
    description: getMeta(html, "og:description") || getMeta(html, "description"),
    articleText: getArticleText(html),
  };
}

function fallbackSource(url, reason) {
  return {
    title: titleFromUrl(url),
    description: `來源頁面無法自動讀取（${reason}），此草稿先依網址主題建立，需人工補充與校對。`,
    articleText: "",
  };
}

async function generateDraft({ url, title, description, articleText }) {
  assertAiConfig();

  const prompt = [
    "你是「悟飯老師｜kouhan」的中文內容編輯。",
    "根據來源資訊，產生一篇繁體中文原創草稿，但不要寫成原文摘要。",
    "請把來源文章當成選題靈感，改寫成 2026 年視角的趨勢觀察、內容策略或設計工作流文章。",
    "可以使用 2026 作為標題年份，但只能寫趨勢、方法、選題角度與可執行建議；不要編造 2026 真實新品、品牌排名、價格或實際上市資訊。",
    "不要翻譯或複製原文全文；不要照抄原文產品清單。",
    "如果來源是舊文章，請明確轉化為『從舊選題延伸出的 2026 內容方向』。",
    "保留來源連結，語氣專業、清楚、適合 AI 設計/創作工具內容站。",
    "請只輸出 JSON，格式如下：",
    "{",
    '  "title": "中文 SEO 標題，28 字內，可含 2026",',
    '  "description": "SEO 摘要，80 字內",',
    '  "categories": ["2026 趨勢", "AI 設計"],',
    '  "body": "Markdown 正文，包含 ## 2026 選題角度、## 設計與內容趨勢、## 可以怎麼用、## 發佈前校對、## 來源",',
    '  "coverPrompt": "英文封面圖生成提示詞，無品牌、無文字、適合 16:9 editorial cover"',
    "}",
    "",
    `來源網址：${url}`,
    `來源標題：${title}`,
    `來源摘要：${description || "無"}`,
    `來源文字節錄：${articleText || "無"}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: defaultModel,
      input: prompt,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${response.status}: ${errorText.slice(0, 240)}`);
  }

  const json = await response.json();
  const text = json.output_text || json.output?.flatMap((item) => item.content || []).map((part) => part.text || "").join("\n");
  if (!text) throw new Error("OpenAI response was empty.");

  const draft = extractJson(text);

  return {
    title: String(draft.title || title),
    description: String(draft.description || description || ""),
    categories: Array.isArray(draft.categories) && draft.categories.length ? draft.categories.map(String) : ["2026 趨勢", "AI 設計"],
    body: String(draft.body || ""),
    coverPrompt: String(draft.coverPrompt || ""),
  };
}

async function importAiPosts(urls) {
  const links = [...new Set(urls.map(normalizeUrl).filter(Boolean))];
  if (!links.length) throw new Error("請至少貼上一個有效連結。");

  const existing = await existingSourceUrls();
  const results = [];

  for (const url of links) {
    if (existing.has(url)) {
      results.push({ url, skipped: true, message: "已存在，略過" });
      continue;
    }

    let source;
    let warning = "";

    try {
      source = await fetchSource(url);
    } catch (error) {
      warning = String(error.message || error);
      source = fallbackSource(url, warning);
    }

    const draft = await generateDraft({ url, ...source });
    const body = `${draft.body.trim()}\n\n## 封面圖提示詞\n\n\`\`\`text\n${draft.coverPrompt.trim()}\n\`\`\`\n`;
    const filename = await savePost({
      title: draft.title,
      description: draft.description,
      pubDate: new Date().toISOString().slice(0, 10),
      author: "郭豪",
      authorInitials: "KH",
      categories: draft.categories.join(", "),
      sourceUrl: url,
      featured: false,
      body,
    });

    results.push({ url, filename, warning });
  }

  return results;
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

    if (request.method === "POST" && action === "import-ai") {
      const body = await readJson(request);
      const urls = String(body.urls || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const results = await importAiPosts(urls);
      json(response, 200, { ok: true, results });
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
