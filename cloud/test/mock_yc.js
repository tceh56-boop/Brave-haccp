// Имитация Yandex Object Storage и Postbox для тестов: проверяет подпись SigV4 каждого запроса.
// Запуск: node cloud/test/mock_yc.js <порт> — печатает «ready» и обслуживает до остановки процесса.
const http = require('http');
const { sign } = require('../src/sigv4');

const KEY_ID = 'test-key-id', SECRET = 'test-secret';
const objects = new Map(), emails = [];

function verify(req, body) {
  const auth = req.headers.authorization || '';
  const m = /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/.exec(auth);
  if (!m || m[1] !== KEY_ID) return false;
  const [, , , region, service, signedList] = m;
  const headers = {};
  signedList.split(';').forEach(h => { if (['host', 'x-amz-date', 'x-amz-content-sha256'].indexOf(h) === -1) headers[h] = req.headers[h]; });
  const d = req.headers['x-amz-date'];
  const date = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15)));
  const expected = sign({ method: req.method, url: 'http://' + req.headers.host + req.url, region, service, headers, body, accessKeyId: KEY_ID, secretAccessKey: SECRET, date });
  return expected.headers.authorization === auth;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url === '/__state') { res.end(JSON.stringify({ objects: [...objects.keys()], emails })); return; }
    if (!verify(req, body)) { res.writeHead(403); res.end('SignatureDoesNotMatch'); return; }
    if (req.url === '/v2/email/outbound-emails' && req.method === 'POST') {
      const j = JSON.parse(body.toString('utf8'));
      if (j.Destination.ToAddresses.some(a => /^fail@/.test(a))) { res.writeHead(500); res.end('{"message":"mailbox unavailable"}'); return; }
      emails.push(j); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"MessageId":"m-' + emails.length + '"}'); return;
    }
    const key = decodeURIComponent(req.url);
    if (req.method === 'PUT') { objects.set(key, body); res.writeHead(200); res.end(); return; }
    if (req.method === 'GET') { if (!objects.has(key)) { res.writeHead(404); res.end(); return; } res.writeHead(200); res.end(objects.get(key)); return; }
    res.writeHead(405); res.end();
  });
});
server.listen(Number(process.argv[2] || 0), '127.0.0.1', () => console.log('ready ' + server.address().port));
