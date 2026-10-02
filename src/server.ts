import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { openDb } from './cache.ts';

const port = Number(process.env.PORT ?? 4000);
const db = openDb(process.env.DB_PATH ?? 'forecast.sqlite');
const app = createApp({ db });

// Per-IP fixed window. In production this belongs at the gateway; this keeps a bare instance safe too.
const LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT ?? 60);
const hits = new Map<string, number>();
setInterval(() => hits.clear(), 60_000).unref();

const server = createServer((req, res) => {
  const ip = req.socket.remoteAddress ?? '';
  hits.set(ip, (hits.get(ip) ?? 0) + 1);
  if (hits.get(ip)! > LIMIT_PER_MINUTE) return void res.writeHead(429, { 'retry-after': '60' }).end();
  app(req, res);
});
server.requestTimeout = 15_000;
server.listen(port, () => console.log(`GraphQL ready at http://localhost:${port}/graphql`));

// Finish in-flight requests, then close SQLite cleanly.
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => db.close()));
