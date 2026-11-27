const puppeteer=require('puppeteer-core');
const DB='https://cjsmartcargo-datebase-default-rtdb.firebaseio.com';
const VEH='-TESTM3'+Date.now();
const api=async(p,o={})=>{const r=await fetch(`${DB}/${p}.json`,{headers:{'Content-Type':'application/json'},...o});const t=await r.text();return t?JSON.parse(t):null;};
const put=(p,v)=>api(p,{method:'PUT',body:JSON.stringify(v)});
const del=(p)=>api(p,{method:'DELETE'});
(async()=>{
  let pass=0,fail=0; const ok=(m,c)=>{console.log((c?'PASS ':'FAIL ')+m);c?pass++:fail++;};
  const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-sandbox']});
  const p=await b.newPage();
  p.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  p.on('dialog',async d=>{console.log(' (dialog) '+d.message().slice(0,50));await d.accept();});
  let partKey=null;
  try{
    await put(`tms/vehicles/${VEH}`,{head:'TEST-M3',trailer:'T3',km:10000,maintaining:true,startTime:Date.now()-7200000,serviceType:'B保 (Repair)'});
    await put('tms/parts_catalog/-TESTPART'+Date.now(),{name:'自动化测试-刹车片',sku:'BP-1',unit:'套',price:300,qty:5,minQty:2});
    const parts=Object.entries(await api('tms/parts_catalog')).map(([k,v])=>({key:k,...v}));
    const part=parts.find(x=>x.name==='自动化测试-刹车片'); partKey=part.key;

    await p.goto('http://127.0.0.1:8899/__boot?to=maintenance.html',{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,1800));
    await p.evaluate(()=>openModule('m3','出厂确认'));
    await new Promise(r=>setTimeout(r,900));

    await p.evaluate(v=>{ document.getElementById('m3_select').value=v;
      document.getElementById('m3_select').dispatchEvent(new Event('change')); },VEH);
    await new Promise(r=>setTimeout(r,400));

    await p.evaluate(()=>addPartRow());
    await new Promise(r=>setTimeout(r,300));
    const rowOk=await p.evaluate(()=>document.querySelectorAll('#m3_partRows .part-row').length);
    ok('m3 可添加配件消耗行', rowOk===1);

    await p.evaluate(()=>{
      const row=document.querySelector('#m3_partRows .part-row');
      const sel=row.querySelector('.pr-part');
      sel.value=Array.from(sel.options).find(o=>o.textContent.includes('刹车片')).value;
      row.querySelector('.pr-qty').value='2';
      document.getElementById('m3_outOdo').value='10500';
      document.getElementById('m3_finalTech').value='测试机修';
      doCheckOut();
    });
    await new Promise(r=>setTimeout(r,4000));

    const v=await api('tms/vehicles/'+VEH);
    ok('出厂后车辆状态复位', v.maintaining===false && v.km===10500 && v.nextServiceOdo===15500);

    const p2=await api('tms/parts_catalog/'+partKey);
    ok('配件库存扣减 5→3', p2.qty===3);

    const moves=Object.values(await api('tms/parts_moves')).filter(m=>m.name==='自动化测试-刹车片'&&m.type==='out');
    ok('写出库流水（关联车牌）', moves.length===1 && moves[0].plate==='TEST-M3' && moves[0].qty===2);

    const logs=Object.values(await api('tms/maintenance_logs')).filter(l=>l.plate==='TEST-M3');
    ok('维修工单含结构化配件与成本', logs.length===1 && logs[0].partsCost===600 && (logs[0].partsUsed||[]).length===1);

    // 报表
    await p.evaluate(()=>{ openModule('m8','维修报表'); });
    await new Promise(r=>setTimeout(r,1200));
    const rp=await p.evaluate(()=>document.getElementById('rpByVehicle').innerText);
    ok('维修报表统计该车辆', rp.includes('TEST-M3'));

    // 清理工单
    const all=await api('tms/maintenance_logs');
    for(const [k,l] of Object.entries(all||{})) if(l.plate==='TEST-M3') await del('tms/maintenance_logs/'+k);
  }catch(e){console.log('异常：'+e.message);fail++;}
  finally{
    await del('tms/vehicles/'+VEH);
    if(partKey) await del('tms/parts_catalog/'+partKey);
    const mv=await api('tms/parts_moves');
    for(const [k,m] of Object.entries(mv||{})) if(m.name==='自动化测试-刹车片') await del('tms/parts_moves/'+k);
    const au=await api('tms/audit_logs');
    for(const [k,a] of Object.entries(au||{})) if(JSON.stringify(a).includes('TEST-M3')||JSON.stringify(a).includes('刹车片')) await del('tms/audit_logs/'+k);
    console.log(`\n清理完成 · 通过 ${pass} 项，失败 ${fail} 项`);
    await b.close();
  }
})();
