import {useEffect,useRef} from 'react';
export function LearningDocument({url,title}:{url:string;title:string}){
 const frame=useRef<HTMLIFrameElement>(null);
 useEffect(()=>{const receive=(event:MessageEvent)=>{if(event.source===frame.current?.contentWindow&&event.origin===window.location.origin&&event.data==='ready')frame.current.contentWindow?.postMessage({url,title},window.location.origin);};window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[url,title]);
 return <iframe ref={frame} title={title} src="/documents/viewer.html" style={{width:'100%',height:'85vh',border:0}} sandbox="allow-scripts allow-same-origin"/>;
}
