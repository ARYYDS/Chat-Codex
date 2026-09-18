const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(require('../lib/runtime-config').inputResult('results_10_dispatched.json'), 'utf-8'));
data.forEach(d => {
    console.log(`\n======================================================`);
    console.log(`[Q${d.id}] ${d.title} | 耗时: ${d.durationSec}s | 字数: ${d.text.length}`);
    console.log(`------------------------------------------------------`);
    const paragraphs = d.text.split('\n').filter(p => p.trim().length > 0);
    console.log(paragraphs.slice(0, 4).join('\n'));
});
