import {mkdir, open, readFile, readdir, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

export const validSession = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{8,90}$/.test(value);
const lockProgram = `import sys,fcntl\nf=open(sys.argv[1],'a')\ntry:\n fcntl.flock(f,fcntl.LOCK_EX | (fcntl.LOCK_NB if sys.argv[2]=='try' else 0))\nexcept BlockingIOError:\n print('busy',flush=True);sys.exit(0)\nprint('locked',flush=True)\nsys.stdin.buffer.read()\n`;

// POSIX advisory locks are released by the OS on a crash. A PID file/timeout
// alone cannot safely exclude a paused writer or concurrent stale-lock recovery.
export class RecordStore {
  constructor(root) { this.root = root; }
  async init() {
    await mkdir(join(this.root,'records'),{recursive:true,mode:0o700});
    await mkdir(join(this.root,'locks'),{recursive:true,mode:0o700});
  }
  async lock(key, action, {tryOnly=false, timeout=10000}={}) {
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(key)) throw Error('잘못된 잠금 키입니다.');
    await this.init();
    const child = spawn(process.env.DEMO_PYTHON || 'python3',['-u','-c',lockProgram,join(this.root,'locks',key),tryOnly?'try':'wait'],{stdio:['pipe','pipe','pipe']});
    child.stdin.on('error',()=>{});
    let timer;
    const ready = new Promise((resolve,reject)=>{
      let output='',errors='';
      child.stderr.on('data',chunk=>{errors+=chunk.toString().slice(0,1000);});
      child.on('error',reject);
      child.on('exit',code=>{if(!output.includes('\n'))reject(Error('파일 잠금을 확보하지 못했습니다: '+(errors||code)));});
      child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('\n'))resolve(output.trim()==='locked');});
      timer=setTimeout(()=>{child.kill();reject(Error('다른 저장 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.'));},timeout);
    });
    try {
      const acquired=await ready;clearTimeout(timer);
      if(!acquired)return undefined;
      return await action();
    } finally {
      clearTimeout(timer);
      child.stdin.end();
      // Do not kill a lock guardian before the protected write has completed.
    }
  }
  path(session) { if(!validSession(session))throw Error('유효한 시연 세션이 필요합니다.');return join(this.root,'records',session+'.json'); }
  async read(session) {
    try {
      const value=JSON.parse(await readFile(this.path(session),'utf8'));
      if(value.schema!==1||value.session_id!==session||!Array.isArray(value.jobs)||!Array.isArray(value.notifications)||!Array.isArray(value.reviews))throw Error('저장 기록 형식이 올바르지 않습니다.');
      return value;
    } catch(e) {
      if(e.code==='ENOENT')return {schema:1,session_id:session,jobs:[],notifications:[],reviews:[],contracts:[],ledger:[]};
      throw e; // Never reset a corrupt journal and silently create another job.
    }
  }
  async write(session, value) {
    const path=this.path(session),temp=path+'.'+randomUUID()+'.tmp';
    await this.init();
    const handle=await open(temp,'wx',0o600);
    try {await handle.writeFile(JSON.stringify(value));await handle.sync();} finally {await handle.close();}
    try {
      await rename(temp,path);
      const dir=await open(join(this.root,'records'),'r');
      try {await dir.sync();} finally {await dir.close();}
    } finally {await rm(temp,{force:true});}
  }
  async update(session, action) {
    return this.lock('session-'+session,async()=>{
      const record=await this.read(session);
      const result=await action(record);
      await this.write(session,record);
      return result;
    });
  }
  async sessions() {
    await this.init();
    return (await readdir(join(this.root,'records'))).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5)).filter(validSession);
  }
}
