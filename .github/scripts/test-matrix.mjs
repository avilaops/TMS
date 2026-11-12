import { readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const validFile = (file) => typeof file === "string" && file.startsWith("tests/") &&
  /\.test\.tsx?$/.test(file) && !/[*?{}[\]\\]/.test(file) && !file.split("/").includes("..");

/** @param {string | undefined} value @returns {string[] | undefined} */
export function ciTestFiles(value) {
  if (value === undefined) return undefined;
  const files = JSON.parse(value);
  if (!Array.isArray(files) || files.length === 0 || !files.every(validFile) || new Set(files).size !== files.length) {
    throw new Error("A CI exige uma lista não vazia de arquivos de teste exatos e sem repetição.");
  }
  return files;
}

/** @param {{file: string, size: number}[]} files */
export function planTestGroups(files) {
  ciTestFiles(JSON.stringify(files.map((file) => file.file)));
  if (files.some((file) => !Number.isFinite(file.size) || file.size < 0)) throw new Error("Tamanho inválido.");
  const ordered = [...files].sort((a, b) => b.size - a.size || a.file.localeCompare(b.file, "en"));
  const include = [];
  for (let left = 0, right = ordered.length - 1; left <= right; left++, right--) {
    const group = [ordered[left].file];
    if (left < right) group.push(ordered[right].file);
    include.push({ id: String(include.length + 1), files: group });
  }
  if (include.length > 256) throw new Error("A matriz ultrapassa o limite de 256 jobs do GitHub.");
  return { include };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const discovered = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
  if (!Array.isArray(discovered)) throw new Error("Lista do Vitest inválida.");
  const files = discovered.map((spec) => {
    if (typeof spec.file !== "string") throw new Error("Arquivo do Vitest ausente.");
    const file = relative(process.cwd(), resolve(spec.file)).split(sep).join("/");
    return { file, size: statSync(spec.file).size };
  });
  process.stdout.write("matrix=" + JSON.stringify(planTestGroups(files)) + "\n");
}
