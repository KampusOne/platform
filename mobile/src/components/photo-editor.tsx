import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useAppearance } from '@/src/lib/appearance';
import { initialCrop, moveCrop, resizeCrop, sourceCrop, type Corner } from '@/src/lib/crop-selection';
import { finishPhotoEdit, getPhotoEdit, getServerPhotoEdit, subscribePhotoEdit, type PhotoEditRequest } from '@/src/lib/photo-edit-session';

const aspects = [['Original', 0], ['1:1', 1], ['4:5', 4/5], ['3:4', 3/4], ['4:3', 4/3], ['3:2', 3/2], ['16:9', 16/9]] as const;
export function PhotoEditorHost() {
  const request = useSyncExternalStore(subscribePhotoEdit, getPhotoEdit, getServerPhotoEdit);
  useEffect(() => () => { const active = getPhotoEdit(); if(active) finishPhotoEdit(active.id,null); }, []);
  return request ? <PhotoEditor key={request.id} request={request}/> : null;
}
function Handle({ corner, onStart, onMove, onEnd }: {corner: Corner; onStart(): void; onMove(dx:number,dy:number):void; onEnd(): void}) {
  const callbacks = useRef({onStart,onMove,onEnd}); callbacks.current = {onStart,onMove,onEnd};
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => callbacks.current.onStart(),
    onPanResponderMove: (_,g) => callbacks.current.onMove(g.dx,g.dy),
    onPanResponderRelease: () => callbacks.current.onEnd(),
    onPanResponderTerminate: () => callbacks.current.onEnd(),
    onPanResponderTerminationRequest: () => false,
  }),[]);
  return <View {...responder.panHandlers} accessibilityLabel={`Drag ${corner} crop corner`} style={{position:'absolute',width:44,height:44,alignItems:'center',justifyContent:'center',...(corner.startsWith('t')?{top:-22}:{bottom:-22}),...(corner.endsWith('l')?{left:-22}:{right:-22})}}><View style={{width:16,height:16,borderRadius:4,backgroundColor:'#FFFFFF',borderWidth:2,borderColor:'#A8462E'}}/></View>;
}
function PhotoEditor({request}:{request:PhotoEditRequest}) {
  const {theme}=useAppearance(); const window=useWindowDimensions();
  const image=request.image, originalAspect=image.width/image.height;
  const fixed=request.kind==='avatar'?1:request.kind==='cover'?3:null;
  const [aspect,setAspect]=useState(fixed??originalAspect);
  const scale=Math.min((Math.min(window.width-40,560))/image.width, Math.max(150,window.height*0.52)/image.height);
  const width=image.width*scale, height=image.height*scale;
  const [box,setBox]=useState(()=>initialCrop(width,height,aspect));
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[dragging,setDragging]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),saving=useRef(false), current=useRef({box,busy,width,height});current.current={box,busy,width,height};
  const origin=useRef(box);
  useEffect(()=>{setBox(initialCrop(width,height,aspect));},[width,height,aspect]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const pan=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:()=>!current.current.busy,onMoveShouldSetPanResponder:()=>!current.current.busy,
    onPanResponderGrant:()=>{origin.current=current.current.box;setDragging(true);},
    onPanResponderMove:(_,g)=>{const c=current.current;if(!c.busy)setBox(moveCrop(origin.current,g.dx,g.dy,c.width,c.height));},
    onPanResponderRelease:()=>setDragging(false),
    onPanResponderTerminate:()=>setDragging(false),
    onPanResponderTerminationRequest:()=>false,
  }),[]);
  const cancel=()=>{if(!saving.current)finishPhotoEdit(request.id,null);};
  async function save(){
    if(saving.current||!ready)return;saving.current=true;setBusy(true);setError('');
    const crop=sourceCrop(box,scale,image.width,image.height),context=ImageManipulator.manipulate(image.uri);
    try{context.crop(crop);context.resize({width:Math.min(crop.width,request.kind==='avatar'?512:request.kind==='cover'?1200:1280)});
      const rendered=await context.renderAsync();try{const result=await rendered.saveAsync({format:SaveFormat.JPEG,compress:0.86});if(alive.current)finishPhotoEdit(request.id,result);}finally{rendered.release();}
    }catch{if(alive.current)setError('Could not save this crop. Try again.');}finally{context.release();saving.current=false;if(alive.current)setBusy(false);}
  }
  const text={color:theme.text,fontFamily:theme.font.body};
  return <Modal visible presentationStyle="fullScreen" onRequestClose={cancel}><SafeAreaView style={{flex:1,backgroundColor:theme.canvas}} accessibilityViewIsModal>
    <View style={styles.header}><Pressable accessibilityRole="button" onPress={cancel} disabled={busy} style={styles.action}><Text style={text}>Cancel</Text></Pressable><Text accessibilityRole="header" style={{...text,fontFamily:theme.font.semibold,fontSize:18}}>{request.kind==='avatar'?'Crop profile photo':request.kind==='cover'?'Crop cover photo':'Crop image'}</Text><Pressable accessibilityRole="button" onPress={()=>void save()} disabled={busy||!ready} style={styles.action}><Text style={{...text,color:theme.deepBrand,fontFamily:theme.font.semibold}}>{busy?'Saving…':'Save'}</Text></Pressable></View>
    <ScrollView contentContainerStyle={{alignItems:'center',padding:20,gap:24}} scrollEnabled={!busy&&!dragging}>
      <Text style={{...text,color:theme.textMuted,textAlign:'center'}}>Drag the corners to crop. Drag the frame to move it.</Text>
      {!fixed?<View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:8}}>{aspects.map(([label,ratio])=><Pressable key={label} accessibilityRole="button" accessibilityState={{selected:aspect===(ratio||originalAspect)}} disabled={busy} onPress={()=>setAspect(ratio||originalAspect)} style={{padding:11,borderRadius:10,borderWidth:1,borderColor:aspect===(ratio||originalAspect)?theme.brand:theme.border}}><Text style={text}>{label}</Text></Pressable>)}</View>:null}
      <View testID="photo-crop-preview" style={{width,height,backgroundColor:'#080808'}}>
        <Image source={{uri:image.uri}} style={{width,height,opacity:0.42}} resizeMode="contain" onLoad={()=>setReady(true)} onError={()=>setError('This photo could not load. Choose another image.')}/>
        <View {...pan.panHandlers} style={{position:'absolute',left:box.x,top:box.y,width:box.width,height:box.height}}>
          <View pointerEvents="none" style={{position:'absolute',left:0,right:0,top:0,bottom:0,overflow:'hidden',borderRadius:request.kind==='avatar'?box.width/2:0,borderWidth:2,borderColor:'#FFFFFF'}}>
            <Image source={{uri:image.uri}} resizeMode="contain" style={{position:'absolute',width,height,left:-box.x-2,top:-box.y-2}}/>
            {request.kind!=='avatar'?[1,2].map(n=><View key={n} style={StyleSheet.absoluteFill}>
              <View style={{position:'absolute',left:`${n*100/3}%`,top:0,bottom:0,width:1,backgroundColor:'rgba(255,255,255,0.7)'}}/>
              <View style={{position:'absolute',top:`${n*100/3}%`,left:0,right:0,height:1,backgroundColor:'rgba(255,255,255,0.7)'}}/>
            </View>):null}
          </View>
          {!busy?(['tl','tr','bl','br'] as Corner[]).map(corner=><Handle key={corner} corner={corner} onStart={()=>{origin.current=current.current.box;setDragging(true);}} onMove={(dx,dy)=>setBox(resizeCrop(origin.current,dx,dy,corner,width,height))} onEnd={()=>setDragging(false)}/>):null}
        </View>
      </View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={()=>setBox(initialCrop(width,height,aspect))} style={styles.action}><Text style={{...text,color:theme.deepBrand}}>Reset crop</Text></Pressable>
      {error?<Text accessibilityRole="alert" style={{...text,color:theme.error}}>{error}</Text>:null}
    </ScrollView>
  </SafeAreaView></Modal>;
}
const styles=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:8},action:{minHeight:48,minWidth:60,padding:12,justifyContent:'center',alignItems:'center'}});
