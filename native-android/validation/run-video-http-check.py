"""Offline portable check of the actual video range adapter against cached Media3 APIs.

Uses synthetic JVM URI/HTTP fixtures, never an Android account or provider request.
"""
from pathlib import Path
import argparse
import os
import re
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--java-path', required=True)
    parser.add_argument('--android-jar', required=True)
    parser.add_argument('--output-directory', required=True)
    parser.add_argument('--gradle-module-cache', default=str(Path.home()/'.gradle/caches/modules-2/files-2.1'))
    args = parser.parse_args()
    java = Path(args.java_path).resolve()
    javac = java.with_name('javac.exe' if java.suffix == '.exe' else 'javac')
    cache = Path(args.gradle_module_cache).resolve()
    output = Path(args.output_directory).resolve()
    classes = output/'classes'
    classes.mkdir(parents=True, exist_ok=True)
    fixture = Path(__file__).resolve().parent/'video-http'

    def cached(group, artifact, version, extension='jar'):
        files = list((cache/group/artifact/version).glob('*/'+artifact+'-'+version+'.'+extension))
        assert len(files) == 1, 'Expected one cached dependency: '+artifact
        return files[0]

    def command(arguments):
        process = subprocess.run(list(map(str, arguments)), capture_output=True, text=True, timeout=180)
        if process.returncode:
            raise RuntimeError(process.stdout+'\n'+process.stderr)
        return process.stdout

    libraries = []
    for group, artifact, version in (
        ('androidx.media3', 'media3-common', '1.11.1'),
        ('androidx.media3', 'media3-datasource', '1.11.1'),
        ('androidx.annotation', 'annotation-experimental', '1.4.1'),
    ):
        destination = output/(artifact+'.jar')
        with zipfile.ZipFile(cached(group, artifact, version, 'aar')) as archive:
            destination.write_bytes(archive.read('classes.jar'))
        libraries.append(destination)
    stdlib = cached('org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.20')
    compiler = [
        cached('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.2.20'), stdlib,
        cached('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.2.20'),
        cached('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
        cached('org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.2.20'),
        cached('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'),
        cached('org.jetbrains', 'annotations', '23.0.0'),
    ]
    classpath = [classes, stdlib, Path(args.android_jar),
                 cached('com.google.guava', 'guava', '33.3.1-android')] + libraries
    joined = lambda paths: os.pathsep.join(map(str, paths))
    command([javac, '-d', classes, fixture/'Uri.java', fixture/'TextUtils.java'])
    source = fixture.parent.parent/'app/src/main/java/com/sautilink/nativeapp/ui/components/NativeVideoDataSource.kt'
    command([java, '-cp', joined(compiler), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
             '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', joined(classpath),
             '-d', classes, source, fixture/'VideoDataSourceCheck.kt'])
    result = command([java, '-cp', joined(classpath), 'com.sautilink.nativeapp.ui.components.VideoDataSourceCheckKt'])
    matches = re.findall(r'^PASS ([0-9]+) native video transport checks .*$', result, re.MULTILINE)
    assert len(matches) == 1 and int(matches[0]) >= 43
    print(result.strip())


if __name__ == '__main__':
    main()
