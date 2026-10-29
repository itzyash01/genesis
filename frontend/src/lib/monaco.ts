// Load editor contributions and their services before the first editor is created.
// Loading only editor.api allows lazy language features to register contributions
// after Monaco's singleton service collection has already been initialized.
import "monaco-editor/editor/editor.main.js";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { loader } from "@guolao/vue-monaco-editor";
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";
import jsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import cssWorker from "monaco-editor/language/css/css.worker.js?worker";
import htmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import typescriptWorker from "monaco-editor/language/typescript/ts.worker.js?worker";
import "monaco-editor/languages/definitions/css/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/features/css/register.js";
import "monaco-editor/languages/features/html/register.js";
import "monaco-editor/languages/features/json/register.js";

Object.assign(self, {
  MonacoEnvironment: {
    getWorker(_workerId: string, label: string) {
      if (label === "json") return new jsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new cssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
      if (label === "typescript" || label === "javascript") return new typescriptWorker();
      return new editorWorker();
    },
  },
});

loader.config({ monaco });
