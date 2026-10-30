const fs=require('node:fs');
const rows=require('./club-wording-candidates.json');
const humanAttributes=new Set(['aria-label','aria-description','title','alt','placeholder','label','description','content','heading','summary','message','caption','emptyLabel']);
const word=/(?<![\w./#_:?&=\-])venues?(?![\w/_.=])/gi;
const renamed=value=>value===value.toUpperCase()?(value.length===6?'CLUBS':'CLUB'):value[0]==='V'?(value.length===6?'Clubs':'Club'):(value.length===6?'clubs':'club');
function replaceCopy(raw) { return raw.replace(word,renamed); }
function replaceMarkup(raw) {
  // Attribute names, selectors, URL/query values and role tokens remain stable.
  return raw.replace(word,(value,offset)=>{
    const prefix=raw.slice(0,offset);
    const lastOpen=prefix.lastIndexOf('<'),lastClose=prefix.lastIndexOf('>');
    const lastQuote=prefix.lastIndexOf('"');
    const inTag=lastOpen>lastClose;
    if(inTag) {
      const tagPrefix=prefix.slice(lastOpen);
      const attrs=[...tagPrefix.matchAll(/([\w-]+)\s*=\s*\\?["']/g)];
      const attr=attrs.at(-1)?.[1];
      if(!humanAttributes.has(attr)) return value;
    } else if(lastClose<0 && lastOpen<0 && /(?:class|data-[\w-]+|id|href|role)\s*=/.test(prefix)) return value;
    // A template continuation may begin inside a class attribute.
    if(lastClose<0 && /(?:class=|className=)/.test(prefix.slice(0,lastQuote+1))) return value;
    return renamed(value);
  });
}
const changes=[];
for(const [i,row] of rows.entries()) {
  if(row.text.includes('document.getElementById(') || row.text.includes('font-family:')) continue;
  if(row.attribute && !humanAttributes.has(row.attribute)) continue;
  const countLabel=(row.file==='app/vip/VipDashboard.tsx'||row.file==='app/admin/AdminClient.tsx')&&row.parent==='ConditionalExpression'&&/\.length === 1/.test(row.context);
  const templateCount=/^Template/.test(row.kind)&&/^\s+venues?\s*$/.test(row.text);
  if(/^(venues?)$/.test(row.text.trim()) && !countLabel && !templateCount && row.kind!=='JsxText' && row.property!=='label') continue;
  if(/^[?&./#\[]/.test(row.text.trim()) && !/^<\//.test(row.text.trim())) continue;
  if(/\bvenues[(!]/.test(row.text)) continue; // Database relation/select expressions.
  if(row.text==='venue pending') continue; // CSS class names.
  if(row.text==='venue home-discovery-feed-slide home-venue-discovery-slide club-brand-card') continue;
  if(row.text.startsWith('" class="card venue ') || row.text.startsWith('" data-analytics-source=')) continue;
  const source=fs.readFileSync(row.file,'utf8');
  const old=source.slice(row.start,row.end);
  const next=row.text.includes('<')||row.text.includes('="')?replaceMarkup(old):replaceCopy(old);
  if(old!==next) changes.push({...row,old,next,index:i});
}
const files=[...new Set(changes.map(c=>c.file))];
for(const file of files) {
  let source=fs.readFileSync(file,'utf8');
  for(const change of changes.filter(c=>c.file===file).sort((a,b)=>b.start-a.start)) source=source.slice(0,change.start)+change.next+source.slice(change.end);
  fs.writeFileSync(file,source);
}
const file='src/live-shell/shell.html';
const source=fs.readFileSync(file,'utf8');
const next=source.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]+>|[^<]+/gi,(part)=>{
  if(/^<!--|^<(script|style)\b/i.test(part)) return part;
  if(part.startsWith('<')) return part.replace(/([\w-]+)=("[^"]*"|'[^']*')/g,(attribute,name,value)=>humanAttributes.has(name)?name+'='+replaceCopy(value):attribute);
  return replaceCopy(part);
});
if(next!==source) {fs.writeFileSync(file,next);files.push(file);}
fs.writeFileSync('work/club-wording-changes.json',JSON.stringify(changes,null,2));
fs.writeFileSync('work/club-wording-files.json',JSON.stringify(files,null,2));
console.log('Changed '+changes.length+' text nodes across '+files.length+' files.');
