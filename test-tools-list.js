const https = require('https');

const options = {
  hostname: 'mcp.neonpanel.com',
  path: '/mcp',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test-token'
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.result && response.result.tools) {
        console.log('Total tools:', response.result.tools.length);
        console.log('\nTool names:');
        response.result.tools.forEach(t => console.log('  -', t.name));
        
        const inventoryTool = response.result.tools.find(t => t.name.includes('inventory_valuation'));
        if (inventoryTool) {
          console.log('\n✅ Found inventory_valuation tool:', inventoryTool.name);
          console.log('Description:', inventoryTool.description);
        } else {
          console.log('\n❌ inventory_valuation tool NOT FOUND');
        }
      } else {
        console.log('Response:', JSON.stringify(response, null, 2));
      }
    } catch (e) {
      console.error('Error parsing response:', e.message);
      console.error('Raw data:', data);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e.message);
});

req.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {}
}));
req.end();
