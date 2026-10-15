import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { insertPostFormatting, parsePostFormatting } from '../src/post-text-formatting.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(process.env.GRADLE_USER_HOME || path.join(homedir(), '.gradle'), 'caches/modules-2/files-2.1');
const kotlinVersion = readFileSync(path.join(root, 'native-android/build.gradle.kts'), 'utf8')
  .match(/id\("org\.jetbrains\.kotlin\.android"\) version "([^"]+)"/)[1];

function cachedFile(group, module, version, suffix) {
  const directory = path.join(cache, group, module, version);
  if (!existsSync(directory)) return null;
  for (const digest of readdirSync(directory)) {
    const folder = path.join(directory, digest);
    for (const name of readdirSync(folder)) {
      if (name.endsWith(suffix) && !name.endsWith('-sources.jar') && !name.endsWith('-javadoc.jar')) return path.join(folder, name);
    }
  }
  return null;
}

const compiler = cachedFile('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', kotlinVersion, '.jar');
const compilerPom = cachedFile('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', kotlinVersion, '.pom');
const dependencies = compilerPom ? [...readFileSync(compilerPom, 'utf8').matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)]
  .map(([, body]) => cachedFile(body.match(/<groupId>([^<]+)<\/groupId>/)[1],
    body.match(/<artifactId>([^<]+)<\/artifactId>/)[1], body.match(/<version>([^<]+)<\/version>/)[1], '.jar')) : [];
const stdlib = cachedFile('org.jetbrains.kotlin', 'kotlin-stdlib', kotlinVersion, '.jar');
const annotationRoot = path.join(cache, 'org.jetbrains', 'annotations');
const annotations = existsSync(annotationRoot) ? readdirSync(annotationRoot)
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map((version) => cachedFile('org.jetbrains', 'annotations', version, '.jar')).find(Boolean) : null;
const javaHome = process.env.JAVA_HOME || path.resolve(root, '../temurin21/jdk-21.0.12.1+1');
const java = existsSync(path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'))
  ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const ready = compiler && compilerPom && stdlib && annotations && dependencies.length && dependencies.every(Boolean);

test('native Kotlin post formatting and selections match the existing web implementation', {
  skip: ready ? false : 'Native compiler dependencies are not cached; run after the Android Gradle dependencies are available.',
  timeout: 120_000,
}, () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'sautilink-post-format-'));
  try {
    const classes = path.join(temporary, 'classes');
    execFileSync(java, ['-Dfile.encoding=UTF-8', '-cp', [compiler, ...dependencies, annotations].join(path.delimiter),
      'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
      '-classpath', [stdlib, annotations].join(path.delimiter), '-d', classes,
      path.join(root, 'native-android/app/src/main/java/com/sautilink/nativeapp/ui/text/PostTextFormatting.kt'),
      path.join(root, 'native-android/tests/PostTextFormattingCheck.kt')], { encoding: 'utf8', timeout: 90_000 });
    const native = (mode, text, ...args) => JSON.parse(execFileSync(java, ['-Dfile.encoding=UTF-8', '-cp', [classes, stdlib].join(path.delimiter),
      'com.sautilink.nativeapp.ui.text.PostTextFormattingCheckKt', mode, Buffer.from(text).toString('base64'), ...args.map(String)],
    { encoding: 'utf8', timeout: 10_000 }));
    const cases = ['', 'Plain Kiswahili 🌍 @cloud_engine #Sauti', '**Bold** *Italic* __Underline__ ~~Strike~~',
      '**One *nested* style**', '__Both ~~decorations~~__', '**Unclosed', '*one\ntwo*', '**a**\n__b__',
      '**** ____ ~~~~ ** **', '***triple***', '\\*no escape grammar*', '**<script>alert(1)</script>**',
      'a\r*b*\tc', '**first** then **second**', '*a**b**c*', '😀__sauti~~link~~__😀'];
    for (const text of cases) assert.deepEqual(native('parse', text), parsePostFormatting(text), text);
    assert.deepEqual(native('parse', '**literal at depth five**', 5), parsePostFormatting('**literal at depth five**', 5));
    const insertions = [['Hello Sauti', 6, 11], ['Hello', 5, 5], ['🌍 Sauti', 0, 2], ['Sauti', 5, 0],
      ['x'.repeat(1996), 0, 1996], ['x'.repeat(1997), 0, 1997], ['x'.repeat(1992), 1992, 1992],
      ['x'.repeat(1993), 1993, 1993]];
    for (const format of ['bold', 'italic', 'underline', 'strikethrough']) {
      for (const [text, first, second] of insertions) {
        const textarea = { value: text, selectionStart: Math.min(first, second), selectionEnd: Math.max(first, second),
          setRangeText(value, start, end) { this.value = this.value.slice(0, start) + value + this.value.slice(end); },
          setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
          dispatchEvent() {}, focus() {} };
        const changed = insertPostFormatting(textarea, format);
        const expected = changed ? { text: textarea.value, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd } : null;
        assert.deepEqual(native('insert', text, first, second, format.toUpperCase()), expected,
          `${format}: length ${text.length}, selection ${first}:${second}`);
      }
    }
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(tmpdir()));
    rmSync(temporary, { recursive: true, force: true });
  }
});
