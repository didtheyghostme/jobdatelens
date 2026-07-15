import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {renderFixture} from "./fixture.mjs";

const hostname = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const contentScriptPath = fileURLToPath(new URL("../../content.js", import.meta.url));
const contentStylesPath = fileURLToPath(new URL("../../content.css", import.meta.url));

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || hostname}`);

  if (requestUrl.pathname === "/content.js" || requestUrl.pathname === "/content.css") {
    try {
      const isScript = requestUrl.pathname.endsWith(".js");
      const contents = await readFile(isScript ? contentScriptPath : contentStylesPath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": isScript
          ? "text/javascript; charset=utf-8"
          : "text/css; charset=utf-8",
      });
      response.end(contents);
    } catch (error) {
      response.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
      response.end(
        `Could not load the extension asset: ${error instanceof Error ? error.message : error}\n`,
      );
    }
    return;
  }

  if (requestUrl.pathname !== "/" && requestUrl.pathname !== "/job-page.html") {
    response.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"});
    response.end("Not found\n");
    return;
  }

  try {
    const html = await renderFixture();
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(html);
  } catch (error) {
    response.writeHead(500, {"Content-Type": "text/plain; charset=utf-8"});
    response.end(`Could not render the fixture: ${error instanceof Error ? error.message : error}\n`);
  }
});

server.listen(port, hostname, () => {
  console.log(`JobDateLens recording fixture: http://${hostname}:${port}`);
  console.log("Keep this process running while you record Chrome. Press Ctrl+C to stop.");
});
