import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "js/main.js";
const modules = new Map();

function moduleId(absolutePath) { return path.relative(root, absolutePath).split(path.sep).join("/"); }

function resolveImport(fromPath, request) {
  if (!request.startsWith(".")) throw new Error(`Standalone build only supports local imports: ${request}`);
  return path.resolve(path.dirname(fromPath), request);
}

function importReplacement(clause, dependencyId) {
  const clean = clause.trim();
  if (clean.startsWith("{")) {
    const names = clean.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.replace(/\s+as\s+/g, ": ")).join(", ");
    return `const { ${names} } = require(${JSON.stringify(dependencyId)});`;
  }
  if (clean.startsWith("* as ")) return `const ${clean.slice(5).trim()} = require(${JSON.stringify(dependencyId)});`;
  if (clean.includes(",")) {
    const comma = clean.indexOf(",");
    const defaultName = clean.slice(0, comma).trim();
    const rest = clean.slice(comma + 1).trim();
    const named = rest.slice(1, -1).split(",").map((item) => item.trim().replace(/\s+as\s+/g, ": ")).filter(Boolean).join(", ");
    return `const ${defaultName} = require(${JSON.stringify(dependencyId)}).default; const { ${named} } = require(${JSON.stringify(dependencyId)});`;
  }
  return `const ${clean} = require(${JSON.stringify(dependencyId)}).default;`;
}

function transformModule(absolutePath) {
  const id = moduleId(absolutePath);
  if (modules.has(id)) return;
  let source = fs.readFileSync(absolutePath, "utf8");
  const dependencies = [];
  source = source.replace(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g, (_match, clause, request) => {
    const dependencyPath = resolveImport(absolutePath, request);
    const dependencyId = moduleId(dependencyPath);
    dependencies.push(dependencyPath);
    return importReplacement(clause, dependencyId);
  });
  source = source.replace(/import\s+["']([^"']+)["'];?/g, (_match, request) => {
    const dependencyPath = resolveImport(absolutePath, request);
    const dependencyId = moduleId(dependencyPath);
    dependencies.push(dependencyPath);
    return `require(${JSON.stringify(dependencyId)});`;
  });
  const exported = [];
  source = source.replace(/export\s+async\s+function\s+([A-Za-z_$][\w$]*)/g, (_match, name) => { exported.push({ local: name, exported: name }); return `async function ${name}`; });
  source = source.replace(/export\s+(const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g, (_match, kind, name) => { exported.push({ local: name, exported: name }); return `${kind} ${name}`; });
  source = source.replace(/export\s*\{([^}]+)\};?/g, (_match, names) => {
    for (const item of names.split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      if (parts[0]) exported.push({ local: parts[0], exported: parts[1] || parts[0] });
    }
    return "";
  });
  if (/export\s+default/.test(source)) throw new Error(`Default exports are not supported by the SAMT standalone builder: ${id}`);
  const assignments = [...new Map(exported.map((item) => [item.exported, item])).values()].map((item) => `exports[${JSON.stringify(item.exported)}] = ${item.local};`).join("\n");
  modules.set(id, `${source}\n${assignments}`);
  dependencies.forEach(transformModule);
}

transformModule(path.join(root, entry));

const moduleTable = [...modules.entries()].map(([id, source]) => `${JSON.stringify(id)}: function(module, exports, require) {\n${source}\n}`).join(",\n");
const bundle = `(() => {\n"use strict";\nconst modules = {\n${moduleTable}\n};\nconst cache = Object.create(null);\nfunction require(id) {\n  if (cache[id]) return cache[id].exports;\n  if (!modules[id]) throw new Error("Missing module: " + id);\n  const module = { exports: {} };\n  cache[id] = module;\n  modules[id](module, module.exports, require);\n  return module.exports;\n}\nrequire(${JSON.stringify(entry)});\n})();`;

new vm.Script(bundle, { filename: "samt-standalone-bundle.js" });

const styleFiles = ["reset.css", "tokens.css", "base.css", "layout.css", "components.css", "forms.css", "modal.css", "responsive.css"];
const css = styleFiles.map((name) => fs.readFileSync(path.join(root, "styles", name), "utf8")).join("\n");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(/\s*<link rel="stylesheet" href="\.\/styles\/[^"]+">/g, "");
html = html.replace("</head>", `<style>\n${css}\n</style>\n</head>`);
html = html.replace('<script type="module" src="./js/main.js"></script>', `<script>\n${bundle.replace(/<\/script/gi, "<\\/script")}\n</script>`);
const output = path.join(root, "dist", "samt-app.html");
fs.writeFileSync(output, html);
console.log(`Built ${output} (${Buffer.byteLength(html)} bytes, ${modules.size} modules)`);
