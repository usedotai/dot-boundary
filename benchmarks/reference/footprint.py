"""Measure source bytes and the published archive without installing either package."""
from pathlib import Path
import os,subprocess,json,hashlib,tarfile,tomllib
root=Path(__file__).resolve().parents[2]
reference=Path(os.environ.get('CAMEL_SOURCE',str(root/'.reference/camel')))
archive=Path(os.environ['BOUNDARY_ARCHIVE'])
def git(repo,*args):return subprocess.check_output(['git','-C',str(repo),*args],text=True).strip()
assert git(reference,'rev-parse','HEAD')=='f083b6b396399d3b3c7f2ddaf613a5945eaf32d8'
assert not git(reference,'diff','--name-only','HEAD')
rows=[]
for name,repo,suffix in [('Dot Boundary',root,'.mjs'),('CaMeL',reference,'.py')]:
 files=[p for p in git(repo,'ls-files','src').splitlines() if p.endswith(suffix)]
 manifest={p:{'bytes':(repo/p).stat().st_size,'sha256':hashlib.sha256((repo/p).read_bytes()).hexdigest()} for p in files}
 if name=='Dot Boundary': deps=list(json.loads((repo/'package.json').read_text()).get('dependencies',{}))
 else:deps=tomllib.loads((repo/'pyproject.toml').read_text())['project']['dependencies']
 rows.append({'name':name,'source_bytes':sum(x['bytes'] for x in manifest.values()),'source_files':len(files),'direct_runtime_dependencies':len(deps),'dependency_declarations':deps,'manifest':manifest})
with tarfile.open(archive) as t:
 members=[x for x in t.getmembers() if x.isfile()]
 package={'version':'0.1.0','archive_bytes':archive.stat().st_size,'unpacked_bytes':sum(x.size for x in members),'files':len(members),'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'url':'https://github.com/usedotai/dot-boundary/releases/download/v0.1.0/usedot-boundary-0.1.0.tgz'}
result={'method':'Tracked executable source bytes under src; .mjs for Boundary, .py for CaMeL. Includes comments/docstrings; excludes declarations, dependencies, tests, docs and interpreter binaries. Dependency counts are direct runtime declarations, not installed or transitive package counts.','reference_revision':git(reference,'rev-parse','HEAD'),'rows':rows,'boundary_release':package}
(root/'benchmarks/reference/results/footprint.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'rows':[{k:r[k] for k in ['name','source_bytes','source_files','direct_runtime_dependencies']} for r in rows],'release':package},indent=2))
