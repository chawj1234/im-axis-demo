'use client';
import {useEffect,useState} from 'react';
import OperationsWorkspace from './operations-workspace';
import {demoApiUrl} from '../lib/demo-api.mjs';
import {readStudioConfig,type StudioConfig,type StudioRole} from '../lib/studio-screen-types';

export default function ConnectedOperationsWorkspace({role}:{role:StudioRole}) {
  const [config,setConfig]=useState<StudioConfig|null|undefined>(undefined);
  const [error,setError]=useState(false);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    void fetch(demoApiUrl('/api/config'),{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),cache:'no-store'})
      .then(async response=>{if(!response.ok)throw Error('config_unavailable');const next=readStudioConfig(await response.json());if(!controller.signal.aborted){setConfig(next);setError(false);}})
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[attempt]);
  return <OperationsWorkspace key={config ? 'studio' : config === null ? 'legacy' : 'connecting'} role={role} studioConfig={config || undefined} connectionPending={config===undefined && !error} connectionError={config===undefined && error} onRetryConnection={()=>{setError(false);setAttempt(n=>n+1);}}/>;
}
