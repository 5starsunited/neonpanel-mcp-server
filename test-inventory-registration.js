const reg = require('./dist/tools/athena_tools/index.js');
const tools = [];
const mockReg = {register: (t) => tools.push(t)};
reg.registerAthenaTools(mockReg);

console.log('Total tools:', tools.length);
console.log('\nAll tool names:');
tools.forEach((t, i) => console.log(`  ${i+1}. ${t.name}`));

const inventory = tools.find(t => t.name && t.name.includes('inventory_valuation'));
if (inventory) {
  console.log('\n✅ Found inventory valuation tool:');
  console.log('  Name:', inventory.name);
  console.log('  Has specJson:', !!inventory.specJson);
  console.log('  Has inputSchema:', !!inventory.inputSchema);
  console.log('  Description:', inventory.description?.substring(0, 100));
} else {
  console.log('\n❌ inventory_valuation tool NOT FOUND');
}
