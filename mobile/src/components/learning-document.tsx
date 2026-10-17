import {useRef} from 'react';
import {WebView} from 'react-native-webview';
export function LearningDocument({url,title}:{url:string;title:string}){
 const view=useRef<WebView>(null);
 return <WebView ref={view} source={{uri:'https://mobile.kampusone.app/documents/viewer.html'}} style={{flex:1,minHeight:500}} javaScriptEnabled allowFileAccess={false} mixedContentMode="never" originWhitelist={['https://mobile.kampusone.app']} onShouldStartLoadWithRequest={request=>request.url.startsWith('https://mobile.kampusone.app/documents/')} onMessage={event=>{if(event.nativeEvent.data==='ready')view.current?.injectJavaScript(`window.openLearningDocument(${JSON.stringify({url,title})});true;`);}}/>;
}
