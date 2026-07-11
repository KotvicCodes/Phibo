// Flags selectors in src/dashboard/shared.css that reference a class no
// Svelte component uses. Svelte warns about unused selectors in scoped
// component styles, but shared.css is global, so dead rules would
// accumulate silently without this check.
// Run with: npm run audit:css
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const sharedCssPath = "src/dashboard/shared.css"

function findSvelteFiles(dir) {
  const files = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...findSvelteFiles(path))
    } else if (entry.name.endsWith(".svelte")) {
      files.push(path)
    }
  }

  return files
}

const componentSource = findSvelteFiles("src")
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")

const css = readFileSync(sharedCssPath, "utf8")
// Strip comments and rule bodies, keeping selector lists.
const selectorText = css
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{[^{}]*\}/g, "{}")

const classPattern = /\.([a-zA-Z][\w-]*)/g
const unusedClasses = new Set()

for (const match of selectorText.matchAll(classPattern)) {
  const className = match[1]

  if (!componentSource.includes(className)) {
    unusedClasses.add(className)
  }
}

if (unusedClasses.size === 0) {
  console.log("shared.css: every class selector matches a component.")
  process.exit(0)
}

console.log("shared.css classes not found in any Svelte component:")

for (const className of [...unusedClasses].sort()) {
  console.log(`  - .${className}`)
}

process.exit(1)
