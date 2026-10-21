import re, os, sys
d=sys.argv[1]
files=[f for f in os.listdir(d) if f.endswith('.ts')]
graph={}
for f in files:
    src=open(os.path.join(d,f)).read()
    src=re.sub(r'/\*.*?\*/','',src,flags=re.S)
    src=re.sub(r'//[^\n]*','',src)
    edges=set()
    for m in re.finditer(r"(?:^|\n)\s*(?:import|export)\s+(.*?)\s+from\s+['\"]([^'\"]+)['\"]", src, re.S):
        clause, target = m.group(1), m.group(2)
        if clause.strip().startswith('type '): continue
        if target.startswith('./'):
            p=os.path.normpath(os.path.join(d,target))
            if p.endswith('.js'): p=p[:-3]+'.ts'
            edges.add(p)
    graph[os.path.join(d,f)]=sorted(edges)
sys.setrecursionlimit(10000); color={}; stack=[]; cycles=[]
def dfs(n):
    color[n]=1; stack.append(n)
    for m in graph.get(n,[]):
        if m not in graph: continue
        if color.get(m,0)==0: dfs(m)
        elif color.get(m)==1:
            i=stack.index(m); cycles.append(stack[i:]+[m])
    stack.pop(); color[n]=2
for f in files:
    p=os.path.join(d,f)
    if color.get(p,0)==0: dfs(p)
seen=set(); print("cycles:",len(cycles))
for c in cycles:
    key=tuple(sorted(c[:-1]))
    if key in seen: continue
    seen.add(key); print(' -> '.join(os.path.basename(x) for x in c))
