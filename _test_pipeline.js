const https = require('https');

function apiCall(hostname, urlPath, method, data, apiKey) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : null;
    const headers = { 'Authorization': 'Bearer ' + apiKey };
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request({
      hostname, port: 443, path: urlPath, method, headers
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const QWEN_KEY = 'sk-b121d7a1020f4c4e9740ec130f359333';
  const VIDEO_KEY = 'sk-VWJLvqJJGbWzxxgijoJBjEgblBbdwKR2Vgyruwk8OJhlRap0';

  // Step 1: AI generate narration script
  console.log('[1/3] Generating narration script via Qwen...');
  const scriptResp = await apiCall(
    'dashscope.aliyuncs.com',
    '/compatible-mode/v1/chat/completions',
    'POST',
    {
      model: 'qwen-plus',
      messages: [
        {
          role: 'system',
          content: 'You are a Douyin short video director. Output ONLY raw JSON (no markdown). Generate a single-segment narration script. JSON format: {"title":"...", "segments":[{"index":0, "text":"Chinese narration text", "duration":8, "expression":"facial expression", "action":"body action", "videoPrompt":"Detailed English cinematic prompt for AI video generation, include person appearance, expression, action, camera angle, lighting, background"}]}'
        },
        {
          role: 'user',
          content: 'Topic: AI is changing our daily life. Make it casual and engaging for Douyin. Just 1 segment, 8 seconds.'
        }
      ],
      temperature: 0.7,
      max_tokens: 800,
    },
    QWEN_KEY
  );

  const scriptData = JSON.parse(scriptResp.body);
  const raw = scriptData.choices[0].message.content;
  console.log('Raw script output:', raw.substring(0, 600));

  let script;
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    script = JSON.parse(cleaned);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) script = JSON.parse(m[0]);
    else throw new Error('Cannot parse script JSON');
  }

  const seg = script.segments[0];
  console.log('\n--- Script ---');
  console.log('Title:', script.title);
  console.log('Narration:', seg.text);
  console.log('Expression:', seg.expression);
  console.log('Action:', seg.action);
  console.log('Video Prompt:', seg.videoPrompt);
  console.log('Duration:', seg.duration, 'seconds');

  // Step 2: Submit video generation task
  console.log('\n[2/3] Submitting video task (sora-2-pro)...');
  const videoResp = await apiCall(
    'api.apimart.ai',
    '/v1/videos/generations',
    'POST',
    {
      model: 'sora-2-pro',
      prompt: seg.videoPrompt,
      duration: Math.min(seg.duration || 8, 10),
      aspect_ratio: '9:16'
    },
    VIDEO_KEY
  );

  console.log('Video API status:', videoResp.status);
  const videoData = JSON.parse(videoResp.body);
  console.log('Video response:', JSON.stringify(videoData, null, 2));

  let taskId;
  if (Array.isArray(videoData.data) && videoData.data.length > 0) {
    taskId = videoData.data[0].task_id;
  } else if (videoData.id) {
    taskId = videoData.id;
  } else if (videoData.task_id) {
    taskId = videoData.task_id;
  }

  if (!taskId) {
    console.error('No task ID returned!');
    return;
  }

  console.log('\nTask ID:', taskId);

  // Step 3: Poll for completion
  console.log('\n[3/3] Polling for video completion...');
  const intervals = [10000, 15000, 20000, 30000, 30000, 30000, 60000, 60000, 60000, 60000];
  for (let i = 0; i < intervals.length; i++) {
    console.log('  Waiting', intervals[i] / 1000, 'seconds...');
    await sleep(intervals[i]);

    const pollResp = await apiCall(
      'api.apimart.ai',
      '/v1/videos/generations/' + taskId,
      'GET',
      null,
      VIDEO_KEY
    );

    const pollData = JSON.parse(pollResp.body);
    const inner = pollData.data || pollData;
    const status = (inner.status || pollData.status || '').toUpperCase();
    const progress = inner.progress || '';

    console.log('  Status:', status, progress ? ('Progress: ' + progress) : '');

    if (status === 'SUCCESS' || status === 'COMPLETED' || status === 'SUCCEEDED') {
      // extract video URL
      const url = inner.video_url || inner.url || inner.result_urls?.[0] ||
                  inner.output?.video_url || inner.result?.video_url || '';
      console.log('\n=== VIDEO READY ===');
      console.log('Video URL:', url || 'Check full response below');
      console.log('Full response:', JSON.stringify(pollData, null, 2).substring(0, 2000));
      return;
    }
    if (status === 'FAILED' || status === 'CANCELLED') {
      console.error('Task failed:', inner.fail_reason || 'unknown');
      return;
    }
  }
  console.log('Timed out waiting. Use task ID to check later:', taskId);
}

main().catch(e => console.error('Fatal error:', e.message));
