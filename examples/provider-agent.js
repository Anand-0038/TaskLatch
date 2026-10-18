// Submit one real structured result supplied by the caller as a JSON file.
// The service evaluates it and may settle an eligible result from the testnet cap.
import { readFile } from 'node:fs/promises';
const base=process.env.PROOFPAY_URL||'http://127.0.0.1:8787';
const inputPath=process.argv[2];
if(!inputPath)throw Error('Usage: node examples/provider-agent.js <result.json>');
const payload=JSON.parse(await readFile(inputPath,'utf8'));
const response=await fetch(base+'/api/v1/jobs/job-demo-001/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
const result=await response.json();
if(!response.ok&&response.status!==202)throw Error(result.error||response.statusText);
console.log(JSON.stringify(result,null,2));
