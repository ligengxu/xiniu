const https = require('https');

const API_KEY = 'sk-onrPrxFEzLYFqfFVUdsfaFapWCPSWnVUsLa2Nf0A7HOiwe0a';
const HOST = 'api.qingyuntop.top';

const PROMPT = 'A charismatic young Chinese woman in a modern bright studio, looking directly into camera with a warm confident smile, she is speaking passionately and gesturing with her hands about technology trends, medium close-up shot slowly pushing in, professional ring light creating soft flattering illumination on her face, clean minimal white background with subtle warm gradient, she wears a smart casual blazer, her expressions are animated and engaging, cinematic broadcast quality, vertical 9:16 portrait format optimized for Douyin short video';

function api(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const headers = { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({ hostname: HOST, port: 443, path: urlPath, method, headers }, res => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function ts() { return new Date().toLocaleTimeString('en-US', { hour12: false }); }

async function main() {
  console.log(`[${ts()}] sora-2-pro-all continuous retry started`);
  console.log('Will keep trying every 20s until task is accepted...\n');

  let taskId = null;
  let attempt = 0;

  while (!taskId) {
    attempt++;
    process.stdout.write(`[${ts()}] Attempt #${attempt} ... `);

    try {
      const r = await api('POST', '/v1/video/create', {
        model: 'sora-2-pro-all',
        prompt: PROMPT,
        duration: 15,
        aspect_ratio: '9:16',
      });

      if (r.status < 400) {
        const d = JSON.parse(r.body);
        taskId = d.id || d.task_id;
        if (taskId) {
          console.log(`SUCCESS! Task ID: ${taskId}`);
          console.log(`Full response: ${r.body.substring(0, 500)}\n`);
        } else {
          console.log(`200 but no task ID: ${r.body.substring(0, 200)}`);
        }
      } else if (r.status === 500 && r.body.includes('负载已饱和')) {
        console.log('overloaded, retry in 20s');
      } else if (r.status === 503) {
        console.log(`no channel (503), retry in 20s`);
      } else {
        console.log(`HTTP ${r.status}: ${r.body.substring(0, 150)}`);
      }
    } catch (e) {
      console.log(`network error: ${e.message}`);
    }

    if (!taskId) {
      await new Promise(r => setTimeout(r, 20000));
    }
  }

  console.log(`\n[${ts()}] Task accepted after ${attempt} attempts. Now polling for video...\n`);

  for (let i = 0; i < 60; i++) {
    const wait = i < 3 ? 10000 : i < 8 ? 15000 : i < 15 ? 20000 : 30000;
    await new Promise(r => setTimeout(r, wait));

    try {
      const qr = await api('GET', '/v1/video/query?id=' + encodeURIComponent(taskId));
      const qd = JSON.parse(qr.body);

      const status = (qd.status || qd.data?.status || '').toLowerCase();
      const videoUrl = qd.video_url || qd.data?.video_url || qd.data?.url || qd.data?.result_urls?.[0] || '';
      const progress = qd.data?.progress || '';
      const failReason = qd.data?.fail_reason || qd.error?.message || '';

      console.log(`[${ts()}] Poll #${i+1}: ${status.toUpperCase()} ${progress ? '| ' + progress : ''}`);

      if (['completed', 'success', 'succeeded'].includes(status)) {
        console.log('\n============ VIDEO GENERATED ============');
        console.log(JSON.stringify(qd, null, 2).substring(0, 3000));
        if (videoUrl) console.log('\n>>> VIDEO URL:', videoUrl);
        console.log('==========================================');
        return;
      }
      if (['failed', 'failure', 'error', 'cancelled'].includes(status)) {
        console.log('\nFAILED:', failReason);
        console.log(JSON.stringify(qd, null, 2).substring(0, 1500));
        return;
      }
    } catch (e) {
      console.log(`[${ts()}] Poll #${i+1}: query error: ${e.message}`);
    }
  }
  console.log('\nTimed out waiting for video completion.');
}

main().catch(e => console.error(e));
