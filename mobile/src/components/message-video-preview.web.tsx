export function MessageVideoPreview({url,width}:{url:string;width:number}){
 return <video src={url+'#t=0.01'} muted playsInline preload="metadata" aria-label="Video preview" style={{width,aspectRatio:'16/9',objectFit:'contain',background:'#29231F',borderRadius:14,pointerEvents:'none'}}/>;
}
