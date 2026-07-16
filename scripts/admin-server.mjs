import { createServer } from "node:http";
import { Buffer } from "node:buffer";
import { extname, join } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url).pathname;
const postsDir = join(root, "src/content/posts");
const imagesDir = join(root, "public/assets/images");
const port = Number(process.env.ADMIN_PORT || 8787);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

    if (raw === "true") {
      data[key] = true;
    } else if (raw === "false") {
      data[key] = false;
    } else if (raw.startsWith("[") || raw.startsWith("\"")) {
      data[key] = JSON.parse(raw);
    } else {
      data[key] = raw;
    }
  }

  return { data, body: match[2].trimEnd() };
}

function safePostFilename(value) {
  const filename = String(value ?? "");
  if (!filename.endsWith(".md") || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Invalid post filename.");
  }
  return filename;
}

async function readPost(filename) {
  const safeName = safePostFilename(filename);
  const content = await readFile(join(postsDir, safeName), "utf8");
  const parsed = parseFrontmatter(content);
  return { filename: safeName, ...parsed };
}

async function listPosts() {
  const files = await readdir(postsDir).catch(() => []);
  const posts = await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => {
        const post = await readPost(file);
        return {
          filename: file,
          title: post.data.title || file,
          pubDate: post.data.pubDate || "",
          author: post.data.author || "",
          featured: post.data.featured === true,
        };
      }),
  );

  return posts.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));
}

function renderPostList(posts) {
  if (!posts.length) {
    return `<p class="empty">目前還沒有文章。</p>`;
  }

  return `<div class="post-list">
    ${posts
      .map(
        (post) => `<article class="post-row">
          <div>
            <strong>${escapeHtml(post.title)}</strong>
            <small>${escapeHtml(post.pubDate)} · ${escapeHtml(post.author)}${post.featured ? " · 首頁主打" : ""}</small>
          </div>
          <div class="post-actions">
            <a class="button-link" href="/admin/edit?file=${encodeURIComponent(post.filename)}">編輯</a>
            <a class="button-link danger-link" href="/admin/delete?file=${encodeURIComponent(post.filename)}">刪除</a>
          </div>
        </article>`,
      )
      .join("")}
  </div>`;
}

function renderPostForm({ action, buttonLabel, post = {}, body = "", isEdit = false }) {
  const data = post.data || {};
  const categories = Array.isArray(data.categories) ? data.categories.join(", ") : "";

  return `<form action="${action}" method="post" enctype="multipart/form-data">
    <div class="grid">
      <label>
        文章標題
        <input name="title" required value="${escapeHtml(data.title)}" placeholder="例如：一週視覺筆記" />
      </label>
      <label>
        網址代稱
        <input name="slug" ${isEdit ? "disabled" : ""} placeholder="留空會自動產生，例如 weekly-visual-notes" />
        ${isEdit ? "<small>編輯既有文章時網址不會變，避免已分享連結失效。</small>" : ""}
      </label>
    </div>
    <label>
      摘要
      <input name="description" required value="${escapeHtml(data.description)}" placeholder="會出現在首頁、文章列表與 SEO 描述" />
    </label>
    <div class="grid">
      <label>
        作者
        <input name="author" required value="${escapeHtml(data.author || "郭豪")}" />
      </label>
      <label>
        作者縮寫
        <input name="authorInitials" value="${escapeHtml(data.authorInitials || "KH")}" />
      </label>
    </div>
    <div class="grid">
      <label>
        發布日期
        <input name="pubDate" type="date" value="${escapeHtml(data.pubDate || new Date().toISOString().slice(0, 10))}" />
      </label>
      <label>
        閱讀時間
        <input name="readingTime" value="${escapeHtml(data.readingTime)}" placeholder="留空會自動估算" />
      </label>
    </div>
    <label>
      分類標籤
      <input name="categories" required value="${escapeHtml(categories)}" placeholder="用逗號分隔，例如 影像生成, 工作流, 評測" />
    </label>
    <div class="grid">
      <label>
        封面圖片
        <input name="cover" type="file" accept="image/*" />
        <small>${data.cover ? `目前封面：${escapeHtml(data.cover)}` : "可不放。請上傳壓縮後網頁圖；原始大圖請放外部雲端。"}</small>
      </label>
      <label>
        封面描述
        <input name="coverAlt" value="${escapeHtml(data.coverAlt)}" placeholder="給搜尋與無障礙使用" />
      </label>
    </div>
    <label class="checkbox">
      <input name="featured" type="checkbox" value="true" ${data.featured === true ? "checked" : ""} />
      設為首頁主打文章
    </label>
    <label>
      文章正文
      <textarea name="body" required placeholder="可直接貼 Markdown。小標用 ##，圖片可用 ![說明](/assets/images/file.jpg)">${escapeHtml(body)}</textarea>
    </label>
    <button type="submit">${buttonLabel}</button>
  </form>`;
}

function layout({ title = "悟飯老師後台", subtitle = "新增文章、封面圖與文章資料。", message = "", content = "" }) {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>悟飯老師後台</title>
    <style>
      :root {
        --ink: #101010;
        --muted: #6f6f6f;
        --line: #dedede;
        --paper: #f7f7f5;
        --accent: #ff4b1f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: var(--ink);
        background: #fff;
        font-family: Inter, "Noto Sans TC", "PingFang TC", system-ui, sans-serif;
        line-height: 1.55;
      }
      header, main {
        width: min(980px, calc(100% - 32px));
        margin-inline: auto;
      }
      header {
        min-height: 96px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 18px;
        border-bottom: 1px solid var(--line);
      }
      h1 {
        margin: 0;
        font-size: clamp(32px, 5vw, 56px);
        line-height: 1;
      }
      header a {
        color: var(--muted);
        text-decoration: none;
      }
      main {
        padding-block: 42px 76px;
      }
      section + section {
        margin-top: 44px;
        padding-top: 36px;
        border-top: 1px solid var(--line);
      }
      h2 {
        margin: 0 0 18px;
        font-size: 28px;
      }
      .notice {
        margin-bottom: 24px;
        border-left: 4px solid var(--accent);
        background: var(--paper);
        padding: 14px 16px;
      }
      form {
        display: grid;
        gap: 22px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      label {
        display: grid;
        gap: 8px;
        font-weight: 700;
      }
      small {
        color: var(--muted);
        font-weight: 400;
      }
      input, textarea {
        width: 100%;
        min-height: 48px;
        border: 1px solid var(--line);
        border-radius: 0;
        padding: 12px 14px;
        font: inherit;
      }
      textarea {
        min-height: 320px;
        resize: vertical;
      }
      .checkbox {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .checkbox input {
        width: 18px;
        min-height: 18px;
      }
      button {
        width: fit-content;
        min-height: 52px;
        border: 1px solid var(--ink);
        background: var(--ink);
        color: #fff;
        padding: 0 22px;
        font: inherit;
        cursor: pointer;
      }
      .post-list {
        display: grid;
        border-top: 1px solid var(--line);
      }
      .post-row {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 18px;
        align-items: center;
        padding: 18px 0;
        border-bottom: 1px solid var(--line);
      }
      .post-row strong,
      .post-row small {
        display: block;
      }
      .post-row small,
      .empty {
        color: var(--muted);
      }
      .button-link {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--ink);
        padding: 0 16px;
        color: var(--ink);
        text-decoration: none;
      }
      .post-actions,
      .form-actions {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .danger-link,
      .danger-button {
        border-color: #ba1a1a;
        color: #ba1a1a;
        background: #fff;
      }
      .danger-button {
        min-height: 52px;
      }
      @media (max-width: 720px) {
        .grid { grid-template-columns: 1fr; }
        .post-row { grid-template-columns: 1fr; }
        header { align-items: flex-start; flex-direction: column; justify-content: center; }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
      </div>
      <nav>
        <a href="/admin">回後台</a>
        ·
        <a href="http://127.0.0.1:4321/" target="_blank" rel="noreferrer">開啟網站</a>
      </nav>
    </header>
    <main>
      ${message ? `<div class="notice">${message}</div>` : ""}
      ${content}
    </main>
  </body>
</html>`;
}

async function htmlPage(message = "") {
  const posts = await listPosts();
  return layout({
    message,
    content: `<section>
      <h2>文章列表</h2>
      ${renderPostList(posts)}
    </section>
    <section>
      <h2>新增文章</h2>
      ${renderPostForm({ action: "/admin/posts", buttonLabel: "發布文章" })}
    </section>`,
  });
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] ?? contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error("Missing multipart boundary.");

  const marker = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(marker);

  while (start !== -1) {
    start += marker.length;
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;

    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), start);
    if (headerEnd === -1) break;

    const headers = buffer.slice(start, headerEnd).toString("utf8");
    let bodyStart = headerEnd + 4;
    let next = buffer.indexOf(marker, bodyStart);
    if (next === -1) break;
    let bodyEnd = next;
    if (buffer[bodyEnd - 2] === 13 && buffer[bodyEnd - 1] === 10) bodyEnd -= 2;

    parts.push({ headers, data: buffer.slice(bodyStart, bodyEnd) });
    start = next;
  }

  const fields = {};
  const files = {};

  for (const part of parts) {
    const disposition = part.headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const filename = disposition.match(/filename="([^"]*)"/)?.[1];
    const mime = part.headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();

    if (!name) continue;
    if (filename) {
      files[name] = { filename, mime, data: part.data };
    } else {
      fields[name] = part.data.toString("utf8").trim();
    }
  }

  return { fields, files };
}

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || `post-${Date.now()}`;
}

function quoteYaml(value) {
  return JSON.stringify(String(value ?? ""));
}

function estimateReadingTime(body) {
  const compact = body.replace(/\s+/g, "");
  const minutes = Math.max(1, Math.ceil(compact.length / 600));
  return `${minutes} 分鐘閱讀`;
}

function parseCategories(value) {
  return (value || "")
    .split(/[,，]/)
    .map((category) => category.trim())
    .filter(Boolean);
}

async function ensureUniqueFile(baseDir, baseName, extension) {
  let filename = `${baseName}${extension}`;
  let count = 2;
  const existing = new Set(await readdir(baseDir).catch(() => []));

  while (existing.has(filename)) {
    filename = `${baseName}-${count}${extension}`;
    count += 1;
  }

  return filename;
}

async function unsetOtherFeaturedPosts() {
  const files = await readdir(postsDir).catch(() => []);

  await Promise.all(
    files
      .filter((file) => file.endsWith(".md"))
      .map(async (file) => {
        const path = join(postsDir, file);
        const content = await readFile(path, "utf8");
        const next = content.replace(/^featured:\s*true\s*$/m, "featured: false");
        if (next !== content) await writeFile(path, next);
      }),
  );
}

async function postFrontmatter(fields, files, { filename = "", existing = {} } = {}) {
  await mkdir(imagesDir, { recursive: true });

  const title = fields.title || "未命名文章";
  const body = fields.body || "";
  const categories = parseCategories(fields.categories);
  const featured = fields.featured === "true";
  const postSlug = filename ? filename.replace(/\.md$/, "") : slugify(fields.slug || title);
  let cover = existing.cover || "";
  let coverAlt = fields.coverAlt || existing.coverAlt || "";

  if (files.cover?.data?.length) {
    const extension = extname(files.cover.filename).toLowerCase() || ".jpg";
    const imageName = await ensureUniqueFile(imagesDir, postSlug, extension);
    await writeFile(join(imagesDir, imageName), files.cover.data);
    cover = `/assets/images/${imageName}`;
    coverAlt = fields.coverAlt || title;
  }

  if (featured) await unsetOtherFeaturedPosts();

  return [
    "---",
    `title: ${quoteYaml(title)}`,
    `description: ${quoteYaml(fields.description || "")}`,
    `pubDate: ${fields.pubDate || new Date().toISOString().slice(0, 10)}`,
    `author: ${quoteYaml(fields.author || "作者")}`,
    `authorInitials: ${quoteYaml(fields.authorInitials || (fields.author || "作者").slice(0, 2).toUpperCase())}`,
    `readingTime: ${quoteYaml(fields.readingTime || estimateReadingTime(body))}`,
    `categories: [${categories.map(quoteYaml).join(", ")}]`,
    cover ? `cover: ${quoteYaml(cover)}` : "",
    coverAlt ? `coverAlt: ${quoteYaml(coverAlt)}` : "",
    existing.sourceUrl ? `sourceUrl: ${quoteYaml(existing.sourceUrl)}` : "",
    `featured: ${featured ? "true" : "false"}`,
    "---",
    "",
  ].filter(Boolean);
}

async function createPost(fields, files) {
  await mkdir(postsDir, { recursive: true });

  const title = fields.title || "未命名文章";
  const slug = slugify(fields.slug || title);
  const filename = await ensureUniqueFile(postsDir, slug, ".md");
  const postSlug = filename.replace(/\.md$/, "");
  const body = fields.body || "";
  const frontmatter = await postFrontmatter(fields, files, { filename });

  await writeFile(join(postsDir, filename), `${frontmatter.join("\n")}${body.trim()}\n`);

  return { filename, postSlug };
}

async function updatePost(filename, fields, files) {
  await mkdir(postsDir, { recursive: true });

  const safeName = safePostFilename(filename);
  const current = await readPost(safeName);
  const body = fields.body || "";
  const frontmatter = await postFrontmatter(fields, files, {
    filename: safeName,
    existing: current.data,
  });

  await writeFile(join(postsDir, safeName), `${frontmatter.join("\n")}${body.trim()}\n`);

  return { filename: safeName, postSlug: safeName.replace(/\.md$/, "") };
}

async function deletePost(filename) {
  const safeName = safePostFilename(filename);
  await rm(join(postsDir, safeName));
  return safeName;
}

async function editPage(filename, message = "") {
  const post = await readPost(filename);
  return layout({
    title: "編輯文章",
    subtitle: post.filename,
    message,
    content: `${renderPostForm({
      action: `/admin/posts/${encodeURIComponent(post.filename)}`,
      buttonLabel: "儲存修改",
      post,
      body: post.body,
      isEdit: true,
    })}
    <section>
      <h2>刪除文章</h2>
      <p class="empty">刪除後會移除這篇 Markdown 文章。已上傳圖片不會自動刪除，避免影響其他文章。</p>
      <a class="button-link danger-link" href="/admin/delete?file=${encodeURIComponent(post.filename)}">前往刪除確認</a>
    </section>`,
  });
}

async function deletePage(filename) {
  const post = await readPost(filename);
  return layout({
    title: "刪除文章",
    subtitle: post.filename,
    content: `<section>
      <h2>${escapeHtml(post.data.title || post.filename)}</h2>
      <p class="empty">這個動作會刪除文章檔案，不能從後台復原。若只是暫時不想發布，建議先回編輯頁修改內容。</p>
      <form class="form-actions" action="/admin/delete/${encodeURIComponent(post.filename)}" method="post">
        <button class="danger-button" type="submit">確認刪除</button>
        <a class="button-link" href="/admin/edit?file=${encodeURIComponent(post.filename)}">取消</a>
      </form>
    </section>`,
  });
}

function collectRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/admin")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await htmlPage());
      return;
    }

    if (request.method === "GET" && url.pathname === "/admin/edit") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await editPage(url.searchParams.get("file") || ""));
      return;
    }

    if (request.method === "GET" && url.pathname === "/admin/delete") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await deletePage(url.searchParams.get("file") || ""));
      return;
    }

    if (request.method === "POST" && url.pathname === "/admin/posts") {
      const body = await collectRequestBody(request);
      const { fields, files } = parseMultipart(body, request.headers["content-type"] || "");
      const post = await createPost(fields, files);
      const message = `已建立文章：<strong>${post.filename}</strong>。<a href="http://127.0.0.1:4321/articles/${post.postSlug}/" target="_blank" rel="noreferrer">開啟文章</a>`;

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await htmlPage(message));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/admin/posts/")) {
      const filename = decodeURIComponent(url.pathname.replace("/admin/posts/", ""));
      const body = await collectRequestBody(request);
      const { fields, files } = parseMultipart(body, request.headers["content-type"] || "");
      const post = await updatePost(filename, fields, files);
      const message = `已儲存修改：<strong>${post.filename}</strong>。<a href="http://127.0.0.1:4321/articles/${post.postSlug}/" target="_blank" rel="noreferrer">開啟文章</a>`;

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await editPage(post.filename, message));
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/admin/delete/")) {
      const filename = decodeURIComponent(url.pathname.replace("/admin/delete/", ""));
      const deleted = await deletePost(filename);
      const message = `已刪除文章：<strong>${deleted}</strong>`;

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await htmlPage(message));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
    response.end(layout({ message: `發生錯誤：${String(error.message || error)}` }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`悟飯老師後台 is running at http://127.0.0.1:${port}/admin`);
});
