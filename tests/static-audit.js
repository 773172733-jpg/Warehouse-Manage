const fs = require('fs');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const trackedFiles = childProcess.execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8'
}).split('\0').filter(Boolean);
const errors = [];
const dependencyGraph = new Map();

function resolveRelativeRequire(file, modulePath) {
  const base = path.resolve(root, path.dirname(file), modulePath);
  if (fs.existsSync(base)) {
    return base;
  }
  if (fs.existsSync(`${base}.js`)) {
    return `${base}.js`;
  }
  return '';
}

for (const file of trackedFiles) {
  const absolutePath = path.resolve(root, file);
  const buffer = fs.readFileSync(absolutePath);
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    errors.push(`${file}: contains UTF-8 BOM`);
  }

  if (file.endsWith('.json')) {
    try {
      JSON.parse(buffer.toString('utf8'));
    } catch (error) {
      errors.push(`${file}: invalid JSON`);
    }
  }

  if (!file.endsWith('.js')) {
    continue;
  }

  const source = buffer.toString('utf8');
  try {
    new vm.Script(source, { filename: file });
  } catch (error) {
    errors.push(`${file}: invalid JavaScript syntax`);
  }

  if (file.startsWith('miniprogram/') && /wx\.cloud\.database\s*\(/.test(source)) {
    errors.push(`${file}: frontend direct database access is forbidden`);
  }

  const dependencies = [];
  const requirePattern = /require\s*\(([^)]+)\)/g;
  let match;
  while ((match = requirePattern.exec(source))) {
    const argument = match[1].trim();
    const quote = argument[0];
    const isQuoted = (quote === '"' || quote === "'") && argument[argument.length - 1] === quote;
    if (!isQuoted) {
      errors.push(`${file}: dynamic require is forbidden`);
      continue;
    }

    const modulePath = argument.slice(1, -1);
    if (!modulePath.startsWith('.')) {
      continue;
    }

    if (!modulePath.endsWith('.js')) {
      errors.push(`${file}: relative require omits .js (${modulePath})`);
    }

    const target = resolveRelativeRequire(file, modulePath);
    if (!target) {
      errors.push(`${file}: require target not found (${modulePath})`);
    } else {
      dependencies.push(path.normalize(target));
    }
  }
  dependencyGraph.set(path.normalize(absolutePath), dependencies);
}

const visiting = new Set();
const visited = new Set();

function visit(file, trail) {
  if (visiting.has(file)) {
    const cycle = trail.concat(file).map((item) => path.relative(root, item)).join(' -> ');
    errors.push(`circular dependency: ${cycle}`);
    return;
  }
  if (visited.has(file)) {
    return;
  }

  visiting.add(file);
  const dependencies = dependencyGraph.get(file) || [];
  dependencies.forEach((dependency) => visit(dependency, trail.concat(file)));
  visiting.delete(file);
  visited.add(file);
}

dependencyGraph.forEach((value, file) => visit(file, []));

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`static audit passed: ${trackedFiles.length} tracked files`);
  console.log('relative require omissions: 0');
}
