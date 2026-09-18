const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'results_10_dispatched.json'), 'utf-8'));
[0, 1].forEach(i => {
    const d = data[i];
    console.log(`\n======================================================`);
    console.log(`[Q${d.id}] ${d.title} | 耗时: ${d.durationSec}s | 字数: ${d.text.length}`);
    console.log(`------------------------------------------------------`);
    console.log(d.text.slice(0, 1200));
});
