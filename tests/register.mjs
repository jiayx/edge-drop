// Compile source in memory for Node's test runner; no runtime/test dependencies.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
    if (specifier.startsWith('file:') || specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL);
      for (const suffix of ['', '.ts', '.tsx']) {
        const file = fileURLToPath(url) + suffix;
        if (/\.tsx?$/.test(file) && existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.tsx?$/.test(url)) {
      const result = ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        fileName: fileURLToPath(url),
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'hono/jsx' },
      });
      return { format: 'module', source: result.outputText.replaceAll('import.meta.env.PROD', 'false'), shortCircuit: true };
    }
    return next(url, context);
  },
});
