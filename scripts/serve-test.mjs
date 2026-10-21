import fs from "node:fs";
import https from "node:https";
import next from "next";
import selfsigned from "selfsigned";
const url = new URL(process.env.TEST_DATABASE_URL ?? "http://invalid");
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  !/(?:^|_)test(?:_|$)/i.test(url.pathname.slice(1))
)
  throw Error("Only a named local test database is allowed");
if (
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL ||
  process.env.DIRECT_URL !== process.env.TEST_DATABASE_URL
)
  throw Error(
    "Runtime and migration database URLs must both be the isolated test URL",
  );
const port = Number(process.env.TEST_PORT ?? 3445);
const keys = await selfsigned.generate(
  [{ name: "commonName", value: "localhost" }],
  {
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 7, ip: "127.0.0.1" },
        ],
      },
    ],
  },
);
const app = next({ dev: false, hostname: "localhost", port });
await app.prepare();
const handler = app.getRequestHandler();
const server = https.createServer(
  { key: keys.private, cert: keys.cert },
  (req, res) => {
    req.headers["x-forwarded-proto"] = "https";
    handler(req, res);
  },
);
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
fs.mkdirSync("tmp/portal-test", { recursive: true });
console.log("ISOLATED_TEST_READY");
async function stop() {
  server.close();
  await app.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
