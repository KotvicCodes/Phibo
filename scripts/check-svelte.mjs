// Compiles every Svelte component with svelte-preprocess and reports
// compiler warnings and errors. This catches template-level mistakes that
// tsc cannot see, since tsc does not type-check Svelte markup.
// Run with: npm run check:svelte
import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { compile, preprocess } from "svelte/compiler"
import sveltePreprocess from "svelte-preprocess"

// Interaction a11y warnings are accepted product-wide; everything else
// counts as a failure.
const ignoredWarnings = new Set([
  "a11y-click-events-have-key-events",
  "a11y-no-static-element-interactions",
  "a11y-no-noninteractive-element-interactions"
])

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

let failed = false

for (const file of findSvelteFiles("src")) {
  const source = readFileSync(file, "utf8")

  try {
    const { code } = await preprocess(source, sveltePreprocess(), {
      filename: file
    })
    const result = compile(code, { filename: file })
    const warnings = result.warnings.filter(
      (warning) => !ignoredWarnings.has(warning.code)
    )

    if (warnings.length > 0) {
      failed = true
      console.log(`${file}: ${warnings.length} warnings`)

      for (const warning of warnings) {
        console.log(
          `  - ${warning.code} @ line ${warning.start?.line}: ${warning.message}`
        )
      }
    } else {
      console.log(`${file}: ok`)
    }
  } catch (error) {
    failed = true
    console.log(`${file}: COMPILE ERROR: ${error.message}`)
  }
}

process.exit(failed ? 1 : 0)
