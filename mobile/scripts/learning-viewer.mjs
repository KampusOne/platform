import {getDocument} from 'unpdf/pdfjs';
if(!Promise.withResolvers)Promise.withResolvers=function(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};};
let pdf=null,pageNumber=1,rendering=false;
const label=document.querySelector('#page-label'),canvas=document.querySelector('canvas'),error=document.querySelector('#error');
async function render(){if(!pdf||rendering)return;rendering=true;try{const page=await pdf.getPage(pageNumber),base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(2,Math.max(320,document.body.clientWidth-24)/base.width)});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),canvas,viewport}).promise;label.textContent=`Page ${pageNumber} of ${pdf.numPages}`;page.cleanup();}catch(e){error.textContent=e.message||'This page could not load.';}finally{rendering=false;}}
window.openLearningDocument=async({url,title})=>{try{const target=new URL(url);if(target.protocol!=='https:'||!target.searchParams.has('access'))throw new Error('This private link is invalid. Reopen the material.');document.title=title;pdf=await getDocument({url:target.href,disableAutoFetch:true,disableStream:true,isEvalSupported:false}).promise;await render();}catch(e){error.textContent=e.message||'This document could not load. Reopen it to try again.';}};
document.querySelector('#previous').onclick=()=>{if(pageNumber>1&&!rendering){pageNumber--;void render();}};
document.querySelector('#next').onclick=()=>{if(pdf&&pageNumber<pdf.numPages&&!rendering){pageNumber++;void render();}};
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===window.parent&&event.data?.url)void window.openLearningDocument(event.data);});
if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage('ready');else window.parent.postMessage('ready',location.origin);
