/** Link only explicit receipt relationships, never equal filenames. */
export function groupReceipts(receipts) {
  const byId=new Map(receipts.map(r=>[r.id,r])), parents=new Map(receipts.map(r=>[r.id,r.id]));
  const root=id=>{const visited=new Set();while(parents.get(id)!==id&&!visited.has(id)){visited.add(id);id=parents.get(id);}return id;};
  for(const r of receipts)for(const id of [r.originalReceiptId,r.routing?.continuedAs])if(byId.has(id))parents.set(root(r.id),root(id));
  const groups=new Map();for(const r of receipts){const key=root(r.id);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  return [...groups.values()].map(items=>{items.sort((a,b)=>(Date.parse(b.receivedAt)||0)-(Date.parse(a.receivedAt)||0));const pending=items.find(r=>r.routing&&!r.routing.continuedAs);const latest=pending||items.find(r=>!r.routing?.continuedAs)||items[0];return {latest,items};}).sort((a,b)=>(Date.parse(b.latest.receivedAt)||0)-(Date.parse(a.latest.receivedAt)||0));
}
