const https = require('https');

function apiCall(body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-04-04',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY not configured' } }) };

  try {
    const requestBody = JSON.parse(event.body);
    let messages = requestBody.messages || [];
    const hasMCP = requestBody.mcp_servers && requestBody.mcp_servers.length > 0;
    let result = await apiCall(requestBody);
    let data = JSON.parse(result.body);
    if (hasMCP) {
      let turns = 0;
      while (turns < 8 && data.stop_reason === 'tool_use') {
        turns++;
        messages = [...messages, { role: 'assistant', content: data.content }];
        const toolResults = data.content.filter(b => b.type === 'tool_use').map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.input ? JSON.stringify(b.input) : '' }));
        if (toolResults.length === 0) break;
        messages = [...messages, { role: 'user', content: toolResults }];
        result = await apiCall({ ...requestBody, messages });
        data = JSON.parse(result.body);
      }
    }
    return { statusCode: result.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: e.message } }) };
  }
};
