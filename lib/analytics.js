// Calendar dates and hourly buckets use the viewer's local timezone.
export function buildAnalyticsBuckets(startDate, endDate, clicks) {
  const start=new Date(startDate), end=new Date(endDate);
  start.setHours(0,0,0,0);end.setHours(0,0,0,0);end.setDate(end.getDate()+1);
  const days=Math.round((Date.UTC(endDate.getFullYear(),endDate.getMonth(),endDate.getDate())-Date.UTC(startDate.getFullYear(),startDate.getMonth(),startDate.getDate()))/86400000)+1;
  const hourly=days<=2;
  const buckets=[];
  for(let cursor=new Date(start);cursor<end;){
    const next=new Date(cursor);
    if(hourly)next.setTime(cursor.getTime()+3600000);else next.setDate(cursor.getDate()+1);
    const day=cursor.toLocaleDateString('id-ID',{day:'numeric',month:'short'});
    const hour=String(cursor.getHours()).padStart(2,'0');
    buckets.push({iso:cursor.toISOString(),start:cursor.getTime(),end:Math.min(next.getTime(),end.getTime()),hourly,label:hourly?`${day}, ${hour}:00–${hour}:59`:`${day} ${String(cursor.getFullYear()).slice(-2)}`,shortLabel:hourly?(days===2?`${cursor.getDate()}/${cursor.getMonth()+1} ${hour}:00`:`${hour}:00`):day,visitors:0,uniqueSet:new Set(),qr:0,refs:new Map()});
    cursor=next;
  }
  for(const click of clicks){
    const time=new Date(click.clicked_at).getTime();
    const bucket=buckets.find(bucket=>time>=bucket.start&&time<bucket.end);
    if(!bucket)continue;
    bucket.visitors++;bucket.uniqueSet.add(click.visitor_id||click.id||click.user_agent||'unknown');
    if(click.is_qr)bucket.qr++;
    const ref=click.referer||'Direct';bucket.refs.set(ref,(bucket.refs.get(ref)||0)+1);
  }
  return buckets.map(({uniqueSet,refs,...bucket})=>({...bucket,unique:uniqueSet.size,topRef:[...refs].sort((a,b)=>b[1]-a[1])[0]?.[0]||'Direct'}));
}
