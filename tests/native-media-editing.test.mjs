import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const cache = path.join(process.env.GRADLE_USER_HOME || path.join(homedir(), '.gradle'), 'caches/modules-2/files-2.1');
const version = readFileSync(path.join(root, 'native-android/build.gradle.kts'), 'utf8').match(/id\("org\.jetbrains\.kotlin\.android"\) version "([^"]+)"/)[1];
function cached(group, module, version, extension) {
  const folder = path.join(cache, group, module, version);
  if (!existsSync(folder)) return null;
  for (const digest of readdirSync(folder)) for (const name of readdirSync(path.join(folder, digest))) {
    if (name.endsWith(extension) && !/-sources\.jar$|-javadoc\.jar$/.test(name)) return path.join(folder, digest, name);
  }
  return null;
}
const compiler = cached('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', version, '.jar');
const pom = cached('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', version, '.pom');
const dependencies = pom ? [...readFileSync(pom, 'utf8').matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)].map(([, body]) =>
  cached(body.match(/<groupId>([^<]+)<\/groupId>/)[1], body.match(/<artifactId>([^<]+)<\/artifactId>/)[1], body.match(/<version>([^<]+)<\/version>/)[1], '.jar')) : [];
const stdlib = cached('org.jetbrains.kotlin', 'kotlin-stdlib', version, '.jar');
const annotationsRoot = path.join(cache, 'org.jetbrains', 'annotations');
const annotations = existsSync(annotationsRoot) ? readdirSync(annotationsRoot).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map(value => cached('org.jetbrains', 'annotations', value, '.jar')).find(Boolean) : null;
const executable = process.platform === 'win32' ? 'java.exe' : 'java';
const candidates = [process.env.JAVA_HOME, path.resolve(root, '../temurin21/jdk-21.0.12.1+1'),
  process.platform === 'win32' ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Android/Android Studio/jbr') : null]
  .filter(Boolean).map(home => path.join(home, 'bin', executable));
const java = candidates.find(existsSync) || 'java';
const ready = compiler && stdlib && annotations && dependencies.length && dependencies.every(Boolean);

test('native crop framing stays inside the source and exported video intervals stay within existing limits', {
  skip: ready ? false : 'Run after the native Kotlin compiler dependencies are cached.', timeout: 120_000,
}, () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'sautilink-media-edit-'));
  try {
    const classes = path.join(temporary, 'classes');
    execFileSync(java, ['-cp', [compiler, ...dependencies, annotations].join(path.delimiter),
      'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17',
      '-classpath', [stdlib, annotations].join(path.delimiter), '-d', classes,
      path.join(root, 'native-android/app/src/main/java/com/sautilink/nativeapp/feature/posts/NativeMediaEditPolicy.kt'),
      path.join(root, 'native-android/validation/NativeMediaEditPolicyCheck.kt')], { encoding: 'utf8', timeout: 90_000 });
    const output = execFileSync(java, ['-cp', [classes, stdlib].join(path.delimiter),
      'com.sautilink.nativeapp.feature.posts.NativeMediaEditPolicyCheckKt'], { encoding: 'utf8', timeout: 10_000 });
    assert.match(output, /Native media edit policy checks passed/);
  } finally {
    const resolved = path.resolve(temporary);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()), 'cleanup must stay directly inside the test temp directory');
    assert.ok(path.basename(resolved).startsWith('sautilink-media-edit-'), 'cleanup must retain the task-specific prefix');
    rmSync(resolved, { recursive: true, force: true });
  }
});
