// Which plots are saved on this server, and their status:  node scripts/plots-status.js
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const dir = process.env.DATA_DIR ? path.resolve(__dirname, '..', process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const file = path.join(dir, 'app-data.json');
if (!fs.existsSync(file)) throw new Error(`No data file at ${file}`);
const plots = JSON.parse(fs.readFileSync(file, 'utf8')).Plot || [];
console.log(`Data file: ${file}`);
console.log(`Plots saved: ${plots.length}`);
for (const p of plots.slice(-15)) {
  console.log(`  ${p.plotId}  ${p.status}  ${p.title}  | owner ${String(p.ownerName || '').split(' ')[0]} ${String(p.ownerPhone || '').slice(-4).padStart(10, '*')}  | ${p.photos?.length || 0} photos, ${p.documents?.length || 0} docs  | ${p.createdAt}`);
}
