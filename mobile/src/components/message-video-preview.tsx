import {VideoView,useVideoPlayer} from 'expo-video';
import {View} from 'react-native';

/** A paused first frame; message videos never autoplay while reading a chat. */
export function MessageVideoPreview({url,width}:{url:string;width:number}){
 const player=useVideoPlayer(url,p=>{p.muted=true;p.loop=false;});
 return <View pointerEvents="none" style={{width,aspectRatio:16/9,backgroundColor:'#29231F',borderRadius:14,overflow:'hidden'}}><VideoView player={player} nativeControls={false} contentFit="contain" style={{width:'100%',height:'100%'}}/></View>;
}
