
const fs=require('fs');const cov=JSON.parse(fs.readFileSync('.covtmp/coverage-final.json','utf8'))
const rels=['classify.ts','globs.ts','panel.ts','parse.ts','scan.ts','state.ts','token-count.ts','tool-read-rules.ts','workspace.ts','client/group.ts','client/styles.ts']
for (const f of Object.keys(cov).sort()){ const rel=f.replace(/\\/g,'/').replace(/.*\/dsh-rules-manager\//,'')
 if(!rels.some(r=>rel.endsWith(r))) continue
 const d=cov[f]; const lines=fs.readFileSync(f,'utf8').split(/\r?\n/); const z=[]
 for(const [sid,s] of Object.entries(d.statementMap)) if(d.s[sid]===0) z.push('S'+s.start.line)
 for(const [bid,b] of Object.entries(d.branchMap)) b.locations.forEach((loc,i)=>{ if((d.b[bid]||[])[i]===0) z.push('B'+loc.start.line+'c'+loc.start.column) })
 console.log(rel+' :: '+(z.length?z.join(' '):'no zeros'))
}