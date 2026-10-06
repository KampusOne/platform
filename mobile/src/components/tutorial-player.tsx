import {useEvent} from 'expo';
import {VideoView,useVideoPlayer} from 'expo-video';
import {usePreventScreenCapture} from 'expo-screen-capture';
import {Text,View} from 'react-native';
import {WebView} from 'react-native-webview';

export function TutorialPlayer({url,kind,label}:{url:string;kind:'file'|'embed';label:string}){
 usePreventScreenCapture('tutorial-player');
 return kind==='embed'?<WebView source={{uri:url}} style={{flex:1,backgroundColor:'#111'}} allowsFullscreenVideo allowsInlineMediaPlayback mediaPlaybackRequiresUserAction setSupportMultipleWindows={false} originWhitelist={['https://player.mediadelivery.net']} onShouldStartLoadWithRequest={r=>r.url==='about:blank'||/^https:\/\/player\.mediadelivery\.net\//.test(r.url)}/>:<FilePlayer url={url} label={label}/>;
}
function FilePlayer({url,label}:{url:string;label:string}){
 const player=useVideoPlayer(url,p=>{p.loop=false;p.muted=false;}),event=useEvent(player,'statusChange',{status:player.status});
 const status=event?.status??player.status,error=event?.error;
 return <View style={{flex:1}}><VideoView accessibilityLabel={label} player={player} nativeControls contentFit="contain" style={{flex:1}} allowsPictureInPicture={false}/>{status==='error'?<Text accessibilityRole="alert" style={{color:'#fff',padding:20}}>{error?.message||'The video could not load. Reopen it to refresh access.'}</Text>:null}</View>;
}
