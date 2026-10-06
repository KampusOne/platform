import {View} from 'react-native';
export function TutorialPlayer({url,kind,label}:{url:string;kind:'file'|'embed';label:string}){
 return <View style={{flex:1}}>{kind==='embed'?<iframe title={label} src={url} allow="fullscreen; encrypted-media; picture-in-picture" referrerPolicy="no-referrer" style={{border:0,width:'100%',height:'100%',minHeight:320}}/>:<video aria-label={label} src={url} controls controlsList="nodownload noremoteplayback" disablePictureInPicture onContextMenu={e=>e.preventDefault()} style={{width:'100%',height:'100%',minHeight:320,objectFit:'contain'}}/>}</View>;
}
