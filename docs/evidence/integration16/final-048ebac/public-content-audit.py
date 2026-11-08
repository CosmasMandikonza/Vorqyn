import subprocess,re,json,hashlib,datetime,urllib.parse
origin="https://vorqynweb-production.up.railway.app"
routes=["/","/demo","/demo/mission","/workspace/create"]
patterns={"private-key-block":r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----","github-token":r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b","provider-secret-token":r"\b(?:sk_live_[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_-]{40,}|AKIA[A-Z0-9]{16})\b"}
report={"origin":origin,"recordedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"remoteDeploymentSha":None,"scope":"Anonymous HTML and same-origin JS linked by four public routes; TLS verified, inherited curl session proxy; heuristic only, not a security guarantee","resources":[],"findings":[]}
def get(path):
 r=subprocess.run(["curl","--fail","--silent","--show-error","--max-time","30",origin+path],capture_output=True)
 if r.returncode: raise RuntimeError("HTTPS fetch failed for "+path+"; credential/error values omitted")
 b=r.stdout;s=b.decode("utf-8",errors="replace")
 report["resources"].append({"path":path,"bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()})
 for label,pattern in patterns.items():
  if re.search(pattern,s): report["findings"].append({"path":path,"kind":label})
 return s
chunks=set()
for route in routes:
 html=get(route)
 for src in re.findall(r'<script[^>]+src="([^"]+)"',html):
  u=urllib.parse.urlparse(src)
  if not u.netloc or u.netloc==urllib.parse.urlparse(origin).netloc: chunks.add(u.path)
for chunk in sorted(chunks):get(chunk)
report["status"]="FAIL" if report["findings"] else "PASS"
report["claimsReview"]="Separate manual screenshot/source-label review; string scanning cannot establish claim truth. No transactions, AI decisions, verifier verdicts or physical measurements proven by this audit."
print(json.dumps(report,indent=2))
