"""Read-only identity/packaging gate for a signed Android release bundle."""
import json,re,struct,sys,xml.etree.ElementTree as ET,zipfile
from pathlib import Path
bundle,manifest,config,code,version=sys.argv[1:]
ns='{http://schemas.android.com/apk/res/android}'
root=ET.parse(manifest).getroot()
assert root.get('package')=='com.sautilink.app'
assert root.get(ns+'versionCode')==code and root.get(ns+'versionName')==version
sdk=root.find('uses-sdk');assert sdk is not None and sdk.get(ns+'minSdkVersion')=='26' and sdk.get(ns+'targetSdkVersion')=='36'
app=root.find('application');assert app is not None
assert app.get(ns+'debuggable','false')=='false'
assert app.get(ns+'allowBackup')=='false' and app.get(ns+'usesCleartextTraffic')=='false'
assert app.get(ns+'extractNativeLibs')=='false'
assert not any(x.get(ns+'shell')=='true' for x in app.findall('profileable'))
configuration=json.loads(Path(config).read_text(encoding='utf-8'))
def has_16k(value):
    if isinstance(value,dict):return value.get('alignment')=='PAGE_ALIGNMENT_16K' or any(has_16k(v) for v in value.values())
    if isinstance(value,list):return any(map(has_16k,value))
    return False
assert has_16k(configuration),'Bundle must request 16 KB native zip alignment'
checked=[]
with zipfile.ZipFile(bundle) as archive:
    for name in archive.namelist():
        assert not re.search(r'(^|/)(google-services\.json|local\.properties|[^/]*\.(jks|keystore)|\.env[^/]*)$',name,re.I),'Private build input in bundle'
        if not re.fullmatch(r'base/lib/(arm64-v8a|x86_64)/[^/]+\.so',name):continue
        data=archive.read(name);assert data[:6]==b'\x7fELF\x02\x01'
        phoff=struct.unpack_from('<Q',data,32)[0]
        entsize,count=struct.unpack_from('<HH',data,54)
        assert entsize>=56 and phoff+entsize*count<=len(data)
        loads=0
        for index in range(count):
            kind,flags,offset,vaddr,paddr,filesz,memsz,alignment=struct.unpack_from('<IIQQQQQQ',data,phoff+index*entsize)
            if kind!=1:continue
            assert alignment>=16384 and alignment&(alignment-1)==0, 'Unaligned ELF LOAD segment: '+name
            assert offset%16384==vaddr%16384, 'Incongruent ELF LOAD segment: '+name
            loads+=1
        assert loads;checked.append(name)
print(json.dumps(dict(package='com.sautilink.app',versionCode=int(code),versionName=version,debuggable=False,profileableByShell=False,nativeZipAlignment='PAGE_ALIGNMENT_16K',checked64BitLibraries=checked)))
