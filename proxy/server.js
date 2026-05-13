'use strict';
const net = require('net');
const WebSocket = require('ws');
const http = require('http');

const AMI_HOST   = process.env.AMI_HOST   || '127.0.0.1';
const AMI_PORT   = parseInt(process.env.AMI_PORT   || '5038', 10);
const AMI_USER   = process.env.AMI_USER   || 'admin';
const AMI_SECRET = process.env.AMI_SECRET || 'admin';
const WS_PORT    = parseInt(process.env.WS_PORT    || '3000', 10);
const PING_MS    = 20000;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size }));
  } else {
    res.writeHead(404); res.end();
  }
});

const wss = new WebSocket.Server({ server });
console.log(`[proxy] Starting — AMI: ${AMI_HOST}:${AMI_PORT}  WS: :${WS_PORT}`);

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[proxy] Browser connected from ${ip}`);
  let sock = null, buf = '', ready = false, authenticated = false;
  const ping = setInterval(() => {
    if (sock && ready) sock.write('Action: Ping\r\n\r\n');
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, PING_MS);

  function send(obj) { ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj)); }

  function parse(block) {
    const o = {};
    for (const line of block.split('\r\n')) {
      const i = line.indexOf(': ');
      if (i >= 0) o[line.slice(0,i).trim()] = line.slice(i+2).trim();
    }
    return o;
  }

  sock = net.createConnection({ host: AMI_HOST, port: AMI_PORT });
  sock.on('connect', () => console.log(`[proxy] TCP → AMI connected`));
  sock.on('data', chunk => {
    buf += chunk.toString('utf8');

    // Handle AMI banner — sent as a single line ending in \r\n (not \r\n\r\n)
    if (!ready) {
      const nl = buf.indexOf('\r\n');
      if (nl !== -1) {
        const banner = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        console.log(`[proxy] AMI banner: "${banner}"`);
        ready = true;
        sock.write(`Action: Login\r\nUsername: ${AMI_USER}\r\nSecret: ${AMI_SECRET}\r\nEvents: on\r\n\r\n`);
        send({ _type:'proxy', status:'connected', banner: banner.trim() });
      }
      // Don't try to parse events until banner consumed
      if (!ready) return;
    }

    // Parse subsequent \r\n\r\n-delimited AMI event blocks
    let b;
    while ((b = buf.indexOf('\r\n\r\n')) !== -1) {
      const block = buf.slice(0, b); buf = buf.slice(b+4);
      if (!block.trim()) continue;
      const evt = parse(block);
      if (!evt.Response && !evt.Event) continue;
      // Only treat the very first Success response (login) as authenticated
      if (!authenticated && evt.Response === 'Success' && !evt.Event && !evt.EventList) {
        authenticated = true;
        send({ _type:'proxy', status:'authenticated' });
        continue;
      }
      // Forward everything else — errors, list responses, events — to the browser
      send(evt);
    }
  });
  sock.on('error', err => { console.error(`[proxy] AMI error: ${err.message}`); send({ _type:'proxy', status:'error', message:err.message }); });
  sock.on('close', () => { ready=false; send({ _type:'proxy', status:'disconnected' }); });

  ws.on('message', msg => {
    try {
      const cmd = JSON.parse(msg);
      if (cmd.action && sock && ready) {
        let r = `Action: ${cmd.action}\r\n`;
        for (const [k,v] of Object.entries(cmd)) { if (k!=='action') r += `${k}: ${v}\r\n`; }
        sock.write(r+'\r\n');
      }
    } catch(_) {}
  });
  ws.on('close', () => { console.log(`[proxy] Browser disconnected ${ip}`); clearInterval(ping); sock.destroy(); });
  ws.on('error', err => console.error(`[proxy] WS error: ${err.message}`));
});

server.listen(WS_PORT, '0.0.0.0', () => console.log(`[proxy] Listening :${WS_PORT}`));
process.on('SIGTERM', () => wss.close(() => server.close(() => process.exit(0))));
