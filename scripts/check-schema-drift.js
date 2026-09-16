/**
 * Compara `prisma/schema.prisma` deste serviço com o schema do serviço
 * backend, que é a fonte da verdade (ver prisma/README.md).
 *
 * Os dois serviços são repositórios independentes, mas falam com o MESMO
 * banco. Um campo presente nesta cópia e ausente no banco derruba a query em
 * runtime — este script existe para que a divergência apareça no CI, e não em
 * produção.
 *
 * Caminho do schema do backend, em ordem de precedência:
 *   1. argumento de linha de comando
 *   2. variável de ambiente BACKEND_SCHEMA_PATH
 *   3. ../backend/prisma/schema.prisma (repos lado a lado)
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SOURCE = path.resolve(__dirname, '../../backend/prisma/schema.prisma');
const LOCAL_SCHEMA = path.resolve(__dirname, '../prisma/schema.prisma');

const sourcePath = path.resolve(
  process.argv[2] || process.env.BACKEND_SCHEMA_PATH || DEFAULT_SOURCE,
);

if (!fs.existsSync(sourcePath)) {
  console.error(`[schema:check] schema do backend nao encontrado em: ${sourcePath}`);
  console.error('[schema:check] passe o caminho como argumento ou em BACKEND_SCHEMA_PATH.');
  process.exit(2);
}

const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const digest = (text) => createHash('sha256').update(text).digest('hex');

const source = read(sourcePath);
const local = read(LOCAL_SCHEMA);

if (digest(source) === digest(local)) {
  console.log(`[schema:check] OK — identico a ${sourcePath}`);
  process.exit(0);
}

const sourceLines = source.split('\n');
const localLines = local.split('\n');
const divergences = [];

for (let i = 0; i < Math.max(sourceLines.length, localLines.length); i += 1) {
  if (sourceLines[i] !== localLines[i]) {
    divergences.push({ line: i + 1, backend: sourceLines[i], engine: localLines[i] });
    if (divergences.length === 10) break;
  }
}

console.error(`[schema:check] DIVERGENCIA com ${sourcePath}`);
for (const d of divergences) {
  console.error(`  linha ${d.line}:`);
  console.error(`    backend: ${d.backend ?? '(ausente)'}`);
  console.error(`    engine : ${d.engine ?? '(ausente)'}`);
}
console.error('');
console.error('[schema:check] para sincronizar:');
console.error(`  cp "${sourcePath}" prisma/schema.prisma && npm run prisma:generate`);
process.exit(1);
