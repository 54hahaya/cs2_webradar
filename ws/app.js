import { WebSocketServer } from "ws";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

console.log("web_server started");

const port = 22006;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(ROOT, "..", "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

/*
 * 一个端口同时干两件事：
 *   1) 托管 dist/       -> 页面（外网隧道只要开这一条，页面和 WS 同源）
 *   2) /cs2_webradar    -> WebSocket 中继（纯转发）
 * 这样 cloudflared/ngrok 只需暴露 22006 一个端口。
 */
const server = http.createServer((req, res) => {
  let urlPath = "/";
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("bad request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";

  // 同源探测：前端靠它判断"当前页面是不是中继自己发的"
  // （隧道下 location.port 为空，用端口判断不可靠）
  if (urlPath === "/__relay") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("cs2_webradar-relay");
    return;
  }

  const file = path.resolve(DIST, "." + urlPath);

  // 目录穿越防护
  if (file !== DIST && !file.startsWith(DIST + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("forbidden");
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 回退：只有"没有扩展名"的路径才回落 index.html，资源一律 404
      const isAsset = path.extname(urlPath) !== "";
      const index = path.join(DIST, "index.html");
      if (!isAsset && fs.existsSync(index)) {
        res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" });
        fs.createReadStream(index).pipe(res);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(
          fs.existsSync(index)
            ? "404 not found: " + urlPath
            : "dist/ 不存在：先执行 `npm run build`（或改用开发服务器 http://localhost:5173）"
        );
      }
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control":
        path.basename(file) === "index.html" ? "no-cache" : "public, max-age=3600",
    });
    fs.createReadStream(file).pipe(res);
  });
});

const web_socket_server = new WebSocketServer({ server, path: "/cs2_webradar" });

web_socket_server.on("connection", (web_socket, request) => {
  const client_address = request.socket.remoteAddress.replace("::ffff:", "");
  console.info(`${client_address} connected`);

  web_socket.on("message", (message) => {
    web_socket_server.clients.forEach((client) => {
      if (client.readyState === client.OPEN) client.send(message);
    });
  });

  web_socket.on("close", () => {
    console.info(`${client_address} disconnected \n`);
  });

  web_socket.on("error", (error) => {
    console.error(error);
  });
});

server.listen(port, () => {
  console.info(`listening on port '${port}'`);
  console.info(`  页面 + 中继 : http://localhost:${port}`);
  console.info(`  WebSocket   : ws://localhost:${port}/cs2_webradar`);
  console.info(
    fs.existsSync(DIST)
      ? `  静态目录    : ${DIST}`
      : `  静态目录    : 未构建（npm run build 后生效；现在只有 WS 中继在工作）`
  );
});
