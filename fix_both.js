const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'db', 'schema.js');
let content = fs.readFileSync(filePath, 'utf8');

// Заменяем все $ на $$ для PostgreSQL dollar-quoted строк
content = content.split('AS $').join('AS $$');
content = content.split('END $ LANGUAGE').join('END $$ LANGUAGE');

fs.writeFileSync(filePath, content);
console.log('Fixed!');
