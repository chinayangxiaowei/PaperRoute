// 用 CDP 真实时间截图（Node 24 内置 WebSocket，无额外依赖）
// 用法: node shot.mjs <url> <out.png> <waitMs>
const [url, out, waitMs = '12000'] = process.argv.slice(2);
const { spawn } = await import('node:child_process');
const { writeFileSync } = await import('node:fs');

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-port=9777', '--window-size=1280,800',
  '--user-data-dir=/tmp/cdp-profile', 'about:blank',
], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));

try {
  const list = await (await fetch('http://127.0.0.1:9777/json')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === mid) { ws.removeEventListener('message', onMsg); resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const logs = [];
  await new Promise((r) => { ws.onopen = r; });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, parseInt(waitMs)));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
  console.log('--- console ---');
  for (const l of logs) console.log(l);
  ws.close();
} finally {
  chrome.kill();
}
