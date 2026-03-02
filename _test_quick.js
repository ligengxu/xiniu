const https = require('https');

function api(method, path, data) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const headers = { 'Authorization': 'Bearer sk-VWJLvqJJGbWzxxgijoJBjEgblBbdwKR2Vgyruwk8OJhlRap0' };
    if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request({ hostname: 'api.apimart.ai', port: 443, path, method, headers }, res => {
      let buf = ''; res.on('data', c => buf += c); res.on('end', () => resolve({ s: res.statusCode, d: buf }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('Submitting sora-2-pro task (safe prompt, duration=10)...');
  const r = await api('POST', '/v1/videos/generations', {
    model: 'sora-2-pro',
    prompt: 'An animated cartoon character in a modern studio environment, talking to the camera with friendly gestures. The character has a professional look with glasses, standing in front of a whiteboard with colorful diagrams about AI technology. Smooth camera push-in, warm studio lighting, clean minimalist background, vertical 9:16 composition, high quality animation style.',
    duration: 10,
    aspect_ratio: '9:16'
  });

  console.log('Status:', r.s);
  const data = JSON.parse(r.d);
  console.log('Response:', JSON.stringify(data, null, 2));

  let taskId;
  if (Array.isArray(data.data)) taskId = data.data[0]?.task_id;
  else taskId = data.id || data.task_id;

  if (!taskId) { console.log('No task ID!'); return; }
  console.log('\nTask ID:', taskId);
  console.log('Polling...\n');

  for (let i = 0; i < 30; i++) {
    const wait = i < 2 ? 15000 : i < 5 ? 30000 : 45000;
    console.log(`[${i+1}] Waiting ${wait/1000}s...`);
    await new Promise(r => setTimeout(r, wait));

    const p = await api('GET', '/v1/videos/generations/' + taskId);
    const pd = JSON.parse(p.d);
    const inner = pd.data || pd;
    const status = (inner.status || '').toUpperCase();
    const progress = inner.progress || '';
    const failReason = inner.fail_reason || '';

    console.log(`  Status: ${status} ${progress ? '| Progress: ' + progress : ''}`);

    if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCEEDED') {
      const url = inner.video_url || inner.url || (inner.result_urls && inner.result_urls[0]) ||
                  (inner.output && inner.output.video_url) || '';
      console.log('\n========== VIDEO READY ==========');
      console.log('Video URL:', url || '(check full response)');
      console.log('\nFull response:');
      console.log(JSON.stringify(pd, null, 2).substring(0, 3000));
      return;
    }
    if (status === 'FAILURE' || status === 'FAILED' || status === 'CANCELLED') {
      console.log('\n========== TASK FAILED ==========');
      console.log('Reason:', failReason);
      console.log(JSON.stringify(pd, null, 2).substring(0, 2000));
      return;
    }
  }
  console.log('\nTimed out. Task ID:', taskId);
}

main().catch(e => console.error(e));
